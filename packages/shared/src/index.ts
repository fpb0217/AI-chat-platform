import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 20_000;
export const MAX_CONVERSATION_ID_LENGTH = 128;
export const MAX_AUTOMATIC_TITLE_LENGTH = 48;
export const MAX_MANUAL_TITLE_LENGTH = 60;
export const REASONING_LEVELS = ["off", "low", "high", "max"] as const;
export const DEFAULT_REASONING_LEVEL = "off" as const;

export const messageRoleSchema = z.enum(["user", "assistant"]);
export const messageStatusSchema = z.enum([
  "streaming",
  "completed",
  "stopped",
  "error",
]);
export const reasoningLevelSchema = z.enum(REASONING_LEVELS);
export const generationPhaseSchema = z.enum(["reasoning", "answer"]);

export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageStatus = z.infer<typeof messageStatusSchema>;
export type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;
export type GenerationPhase = z.infer<typeof generationPhaseSchema>;

export const conversationTitleSourceSchema = z.enum(["auto", "manual"]);
export type ConversationTitleSource = z.infer<
  typeof conversationTitleSourceSchema
>;

function isControlCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(isControlCharacter);
}

export function stripControlCharacters(value: string): string {
  return Array.from(value).filter((item) => !isControlCharacter(item)).join("");
}

function graphemeSegments(value: string): string[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity: "grapheme" },
      ) => { segment: (input: string) => Iterable<{ segment: string }> };
    }
  ).Segmenter;

  if (Segmenter) {
    return [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(
      (item) => item.segment,
    );
  }
  return Array.from(value);
}

export function graphemeCount(value: string): number {
  return graphemeSegments(value).length;
}

export function truncateGraphemes(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }
  return graphemeSegments(value).slice(0, maxLength).join("");
}

export function takeLastGraphemes(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }
  return graphemeSegments(value).slice(-maxLength).join("");
}

export function normalizeTitleText(value: string): string {
  let normalized = value.trim().replace(/\s+/gu, " ");
  normalized = normalized.replace(/^#{1,6}\s+/u, "");
  normalized = normalized.replace(/\s+#{1,6}$/u, "");

  const wrappers: ReadonlyArray<readonly [string, string]> = [
    ["\"", "\""],
    ["'", "'"],
    ["“", "”"],
    ["「", "」"],
    ["《", "》"],
    ["`", "`"],
  ];
  for (const [opening, closing] of wrappers) {
    if (
      normalized.length >= opening.length + closing.length &&
      normalized.startsWith(opening) &&
      normalized.endsWith(closing)
    ) {
      normalized = normalized.slice(
        opening.length,
        normalized.length - closing.length,
      ).trim();
      break;
    }
  }
  return normalized;
}

export const conversationIdSchema = z
  .string()
  .trim()
  .min(1, "会话 ID 不能为空")
  .max(
    MAX_CONVERSATION_ID_LENGTH,
    `会话 ID 不能超过 ${MAX_CONVERSATION_ID_LENGTH} 个字符`,
  )
  .refine(
    (value) => !hasControlCharacters(value),
    "会话 ID 不能包含控制字符",
  );

const manualTitleSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "标题不能为空")
  .refine(
    (value) => !hasControlCharacters(value),
    "标题不能包含控制字符",
  )
  .refine(
    (value) => graphemeCount(value) <= MAX_MANUAL_TITLE_LENGTH,
    `标题不能超过 ${MAX_MANUAL_TITLE_LENGTH} 个字符`,
  );

export const renameConversationRequestSchema = z.object({
  title: manualTitleSchema,
});

export const autoTitleRequestSchema = z.object({
  turnId: z
    .string()
    .trim()
    .min(1, "turn ID 不能为空")
    .max(MAX_CONVERSATION_ID_LENGTH, "turn ID 无效"),
});

export const sendMessageRequestSchema = z.object({
  conversationId: conversationIdSchema.nullable().default(null),
  content: z
    .string()
    .trim()
    .min(1, "请输入消息")
    .max(MAX_MESSAGE_LENGTH, `消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符`),
  reasoningLevel: reasoningLevelSchema.default(DEFAULT_REASONING_LEVEL),
});

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number | null;
}

export interface Conversation {
  id: string;
  title: string;
  titleSource: ConversationTitleSource;
  createdAt: string;
  updatedAt: string;
}

export type ConversationSummary = Conversation;

export interface ConversationListResponse {
  conversations: ConversationSummary[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  turnId: string;
  position: number;
  role: MessageRole;
  content: string;
  reasoningContent: string | null;
  reasoningDurationMs: number | null;
  status: MessageStatus;
  model: string | null;
  reasoningLevel: ReasoningLevel | null;
  finishReason: string | null;
  usage: TokenUsage | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatResponse {
  conversation: Conversation;
  messages: ChatMessage[];
}

export interface HealthResponse {
  status: "ok";
  database: "ready";
  providerConfigured: boolean;
  model: string;
  reasoningCapabilities: {
    levels: ReasoningLevel[];
    defaultLevel: ReasoningLevel;
  };
}

export type StreamErrorCode =
  | "INVALID_API_KEY"
  | "INSUFFICIENT_BALANCE"
  | "RATE_LIMITED"
  | "UPSTREAM_INVALID_REQUEST"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_STREAM_INTERRUPTED"
  | "INTERNAL_ERROR";

export interface StreamMetaData {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  turnId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
}

export interface StreamPhaseData {
  assistantMessageId: string;
  phase: GenerationPhase;
  reasoningDurationMs: number | null;
}

export interface StreamReasoningDeltaData {
  assistantMessageId: string;
  text: string;
}

export interface StreamDeltaData {
  assistantMessageId: string;
  text: string;
}

export interface StreamDoneData {
  assistantMessageId: string;
  finishReason: string | null;
  usage: TokenUsage | null;
  reasoningDurationMs: number | null;
}

export interface StreamErrorData {
  assistantMessageId: string;
  code: StreamErrorCode;
  message: string;
  retryable: boolean;
  reasoningDurationMs: number | null;
}

export type StreamEvent =
  | { event: "meta"; data: StreamMetaData }
  | { event: "phase"; data: StreamPhaseData }
  | { event: "reasoning_delta"; data: StreamReasoningDeltaData }
  | { event: "delta"; data: StreamDeltaData }
  | { event: "done"; data: StreamDoneData }
  | { event: "error"; data: StreamErrorData };

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
