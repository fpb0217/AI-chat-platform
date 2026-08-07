import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ChatResponse,
  MessageStatus,
  ReasoningLevel,
  TokenUsage,
} from "@ai-chat/shared";
import { and, asc, eq, max } from "drizzle-orm";
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

function toIso(value: Date): string {
  return value.toISOString();
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
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  markInterruptedMessages(): void {
    this.database.db
      .update(messages)
      .set({
        status: "stopped",
        errorCode: "UPSTREAM_STREAM_INTERRUPTED",
        updatedAt: new Date(),
      })
      .where(eq(messages.status, "streaming"))
      .run();
  }

  getChat(): ChatResponse {
    this.ensureDefaultConversation();
    const conversation = this.database.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, DEFAULT_CONVERSATION_ID))
      .get();

    if (!conversation) {
      throw new Error("Default conversation could not be created");
    }

    const messageRows = this.database.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, DEFAULT_CONVERSATION_ID))
      .orderBy(asc(messages.position))
      .all();

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: toIso(conversation.createdAt),
        updatedAt: toIso(conversation.updatedAt),
      },
      messages: messageRows.map(toChatMessage),
    };
  }

  beginTurn(
    content: string,
    model: string,
    reasoningLevel: ReasoningLevel,
  ): TurnMessages {
    this.ensureDefaultConversation();

    return this.database.db.transaction((transaction) => {
      const currentMaximum = transaction
        .select({ value: max(messages.position) })
        .from(messages)
        .where(eq(messages.conversationId, DEFAULT_CONVERSATION_ID))
        .get();
      const firstPosition = (currentMaximum?.value ?? -1) + 1;
      const now = new Date();
      const turnId = randomUUID();

      const userRow: MessageRow = {
        id: randomUUID(),
        conversationId: DEFAULT_CONVERSATION_ID,
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
        conversationId: DEFAULT_CONVERSATION_ID,
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
        .where(eq(conversations.id, DEFAULT_CONVERSATION_ID))
        .run();

      return {
        userMessage: toChatMessage(userRow),
        assistantMessage: toChatMessage(assistantRow),
      };
    });
  }

  finalizeAssistant(id: string, input: FinalizeAssistantInput): void {
    this.database.db.transaction((transaction) => {
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
        .where(
          and(eq(messages.id, id), eq(messages.status, "streaming")),
        )
        .run();

      transaction
        .update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, DEFAULT_CONVERSATION_ID))
        .run();
    });
  }

  getModelHistory(): ModelMessage[] {
    const rows = this.database.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, DEFAULT_CONVERSATION_ID))
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
}
