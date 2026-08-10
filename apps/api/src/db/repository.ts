import { randomUUID } from "node:crypto";
import {
  MAX_AUTOMATIC_TITLE_LENGTH,
  stripControlCharacters,
  normalizeTitleText,
  truncateGraphemes,
  type ChatMessage,
  type ChatResponse,
  type ConversationSummary,
  type MessageStatus,
  type ReasoningLevel,
  type TokenUsage,
} from "@ai-chat/shared";
import { and, asc, desc, eq, max } from "drizzle-orm";
import type { DatabaseHandle } from "./client.js";
import { conversations, messages } from "./schema.js";

export const DEFAULT_CONVERSATION_ID = "default";

type MessageRow = typeof messages.$inferSelect;

export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TurnMessages {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export interface FinalizeAssistantInput {
  content: string;
  reasoningContent: string | null;
  reasoningDurationMs: number | null;
  status: Extract<MessageStatus, "completed" | "stopped" | "error">;
  finishReason: string | null;
  usage: TokenUsage | null;
  errorCode: string | null;
}

export interface LatestTitleTurn {
  turnId: string;
  question: string;
  answer: string;
  assistantStatus: MessageStatus;
  title: string;
  titleSource: "auto" | "manual";
  titleTurnId: string | null;
}

export class ConversationNotFoundError extends Error {
  public constructor(public readonly conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export class ActiveConversationGenerationError extends Error {
  public constructor(public readonly conversationId: string) {
    super(`Conversation is generating: ${conversationId}`);
    this.name = "ActiveConversationGenerationError";
  }
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toSummary(
  row: typeof conversations.$inferSelect,
): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    titleSource: row.titleSource,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toChatMessage(row: MessageRow): ChatMessage {
  const hasUsage =
    row.promptTokens !== null &&
    row.completionTokens !== null &&
    row.totalTokens !== null;

  return {
    id: row.id,
    conversationId: row.conversationId,
    turnId: row.turnId,
    position: row.position,
    role: row.role,
    content: row.content,
    reasoningContent: row.reasoningContent,
    reasoningDurationMs: row.reasoningDurationMs,
    status: row.status,
    model: row.model,
    reasoningLevel: row.reasoningLevel,
    finishReason: row.finishReason,
    usage: hasUsage
      ? {
          promptTokens: row.promptTokens as number,
          completionTokens: row.completionTokens as number,
          totalTokens: row.totalTokens as number,
          reasoningTokens: row.reasoningTokens,
        }
      : null,
    errorCode: row.errorCode,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export class ChatRepository {
  public constructor(private readonly database: DatabaseHandle) {}

  ensureDefaultConversation(): void {
    const now = new Date();
    this.database.db
      .insert(conversations)
      .values({
        id: DEFAULT_CONVERSATION_ID,
        title: "本地对话",
        titleSource: "auto",
        titleTurnId: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  markInterruptedMessages(): void {
    this.database.db.transaction((transaction) => {
      const interrupted = transaction
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.status, "streaming"))
        .all();
      if (interrupted.length === 0) {
        return;
      }

      const now = new Date();
      transaction
        .update(messages)
        .set({
          status: "stopped",
          errorCode: "UPSTREAM_STREAM_INTERRUPTED",
          updatedAt: now,
        })
        .where(eq(messages.status, "streaming"))
        .run();

      for (const conversationId of new Set(
        interrupted.map((row) => row.conversationId),
      )) {
        transaction
          .update(conversations)
          .set({ updatedAt: now })
          .where(eq(conversations.id, conversationId))
          .run();
      }
    });
  }

  listConversations(): ConversationSummary[] {
    const rows = this.database.db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt))
      .all();
    const nonEmptyIds = new Set(
      this.database.db
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .groupBy(messages.conversationId)
        .all()
        .map((row) => row.conversationId),
    );

    return rows
      .filter((row) => nonEmptyIds.has(row.id))
      .map(toSummary);
  }

  getConversationSummary(
    conversationId: string,
  ): ConversationSummary | null {
    const row = this.database.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
    return row ? toSummary(row) : null;
  }

  getConversation(conversationId: string): ChatResponse | null {
    const conversation = this.database.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
    if (!conversation) {
      return null;
    }

    const messageRows = this.database.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.position))
      .all();

    return {
      conversation: toSummary(conversation),
      messages: messageRows.map(toChatMessage),
    };
  }

  getChat(): ChatResponse {
    this.ensureDefaultConversation();
    const chat = this.getConversation(DEFAULT_CONVERSATION_ID);
    if (!chat) {
      throw new Error("Default conversation could not be created");
    }
    return chat;
  }

  beginTurn(
    conversationId: string | null,
    content: string,
    model: string,
    reasoningLevel: ReasoningLevel,
  ): TurnMessages;
  beginTurn(
    content: string,
    model: string,
    reasoningLevel: ReasoningLevel,
  ): TurnMessages;
  beginTurn(
    first: string | null,
    second: string,
    third: string | ReasoningLevel,
    fourth?: ReasoningLevel,
  ): TurnMessages {
    const hasConversationId = fourth !== undefined;
    const conversationId = hasConversationId ? first : DEFAULT_CONVERSATION_ID;
    const content = hasConversationId ? second : (first as string);
    const model = hasConversationId ? (third as string) : second;
    const reasoningLevel = hasConversationId
      ? (fourth as ReasoningLevel)
      : (third as ReasoningLevel);

    return this.database.db.transaction((transaction) => {
      const now = new Date();
      const targetConversationId = conversationId ?? randomUUID();
      const existingConversation = transaction
        .select()
        .from(conversations)
        .where(eq(conversations.id, targetConversationId))
        .get();

      if (!existingConversation) {
        if (conversationId !== null) {
          throw new ConversationNotFoundError(targetConversationId);
        }
        transaction
          .insert(conversations)
          .values({
            id: targetConversationId,
            title: "新对话",
            titleSource: "auto",
            titleTurnId: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      const currentMaximum = transaction
        .select({ value: max(messages.position) })
        .from(messages)
        .where(eq(messages.conversationId, targetConversationId))
        .get();
      const firstPosition = (currentMaximum?.value ?? -1) + 1;
      const turnId = randomUUID();

      const userRow: MessageRow = {
        id: randomUUID(),
        conversationId: targetConversationId,
        turnId,
        position: firstPosition,
        role: "user",
        content,
        reasoningContent: null,
        reasoningDurationMs: null,
        status: "completed",
        model: null,
        reasoningLevel: null,
        finishReason: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        reasoningTokens: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      const assistantRow: MessageRow = {
        id: randomUUID(),
        conversationId: targetConversationId,
        turnId,
        position: firstPosition + 1,
        role: "assistant",
        content: "",
        reasoningContent: null,
        reasoningDurationMs: null,
        status: "streaming",
        model,
        reasoningLevel,
        finishReason: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        reasoningTokens: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      };

      transaction.insert(messages).values([userRow, assistantRow]).run();
      transaction
        .update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, targetConversationId))
        .run();

      return {
        userMessage: toChatMessage(userRow),
        assistantMessage: toChatMessage(assistantRow),
      };
    });
  }

  finalizeAssistant(id: string, input: FinalizeAssistantInput): void {
    this.database.db.transaction((transaction) => {
      const target = transaction
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.id, id))
        .get();
      if (!target) {
        return;
      }

      const now = new Date();
      transaction
        .update(messages)
        .set({
          content: input.content,
          reasoningContent: input.reasoningContent,
          reasoningDurationMs: input.reasoningDurationMs,
          status: input.status,
          finishReason: input.finishReason,
          promptTokens: input.usage?.promptTokens ?? null,
          completionTokens: input.usage?.completionTokens ?? null,
          totalTokens: input.usage?.totalTokens ?? null,
          reasoningTokens: input.usage?.reasoningTokens ?? null,
          errorCode: input.errorCode,
          updatedAt: now,
        })
        .where(and(eq(messages.id, id), eq(messages.status, "streaming")))
        .run();

      transaction
        .update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, target.conversationId))
        .run();
    });
  }

  getModelHistory(
    conversationId: string = DEFAULT_CONVERSATION_ID,
  ): ModelMessage[] {
    const rows = this.database.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.position))
      .all();

    const turns = new Map<string, MessageRow[]>();
    for (const row of rows) {
      const turn = turns.get(row.turnId) ?? [];
      turn.push(row);
      turns.set(row.turnId, turn);
    }

    const history: ModelMessage[] = [];
    for (const turn of turns.values()) {
      const user = turn.find((message) => message.role === "user");
      const assistant = turn.find((message) => message.role === "assistant");
      if (!user || !assistant) {
        continue;
      }

      if (assistant.status === "streaming") {
        history.push({ role: "user", content: user.content });
        continue;
      }

      const hasUsableAnswer =
        assistant.status === "completed" || assistant.content.length > 0;
      if (!hasUsableAnswer) {
        continue;
      }

      history.push(
        { role: "user", content: user.content },
        { role: "assistant", content: assistant.content },
      );
    }

    return history;
  }

  getLatestTitleTurn(
    conversationId: string,
    requestedTurnId?: string,
  ): LatestTitleTurn | null {
    const conversation = this.database.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
    if (!conversation) {
      return null;
    }

    const rows = this.database.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.position))
      .all();
    const latestTurnId = rows.at(-1)?.turnId;
    if (!latestTurnId || (requestedTurnId && requestedTurnId !== latestTurnId)) {
      return null;
    }

    const turnRows = rows.filter((row) => row.turnId === latestTurnId);
    const user = turnRows.find((row) => row.role === "user");
    const assistant = turnRows.find((row) => row.role === "assistant");
    if (!user || !assistant) {
      return null;
    }

    return {
      turnId: latestTurnId,
      question: user.content,
      answer: assistant.content,
      assistantStatus: assistant.status,
      title: conversation.title,
      titleSource: conversation.titleSource,
      titleTurnId: conversation.titleTurnId,
    };
  }

  applyAutomaticTitle(
    conversationId: string,
    turnId: string,
    title: string,
  ): ConversationSummary | null {
    return this.database.db.transaction((transaction) => {
      const conversation = transaction
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get();
      if (!conversation) {
        return null;
      }

      if (conversation.titleSource === "manual" || conversation.titleTurnId === turnId) {
        return toSummary(conversation);
      }

      const latestMessage = transaction
        .select({ turnId: messages.turnId })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.position))
        .get();
      if (!latestMessage || latestMessage.turnId !== turnId) {
        return toSummary(conversation);
      }

      const safeTitle = truncateGraphemes(
        stripControlCharacters(normalizeTitleText(title)),
        MAX_AUTOMATIC_TITLE_LENGTH,
      );
      if (!safeTitle) {
        return toSummary(conversation);
      }

      transaction
        .update(conversations)
        .set({
          title: safeTitle,
          titleSource: "auto",
          titleTurnId: turnId,
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.titleSource, "auto"),
          ),
        )
        .run();

      const updated = transaction
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get();
      return updated ? toSummary(updated) : null;
    });
  }

  renameConversation(
    conversationId: string,
    title: string,
  ): ConversationSummary | null {
    const changed = this.database.db
      .update(conversations)
      .set({ title, titleSource: "manual", titleTurnId: null })
      .where(eq(conversations.id, conversationId))
      .run();
    if (changed.changes === 0) {
      return null;
    }
    return this.getConversationSummary(conversationId);
  }

  deleteConversation(conversationId: string): void {
    this.database.db.transaction((transaction) => {
      const conversation = transaction
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get();
      if (!conversation) {
        throw new ConversationNotFoundError(conversationId);
      }

      const activeMessage = transaction
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.status, "streaming"),
          ),
        )
        .get();
      if (activeMessage) {
        throw new ActiveConversationGenerationError(conversationId);
      }

      transaction
        .delete(conversations)
        .where(eq(conversations.id, conversationId))
        .run();
    });
  }
}
