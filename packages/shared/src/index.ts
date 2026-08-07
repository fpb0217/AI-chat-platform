import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 20_000;
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

export const sendMessageRequestSchema = z.object({
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
  createdAt: string;
  updatedAt: string;
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
