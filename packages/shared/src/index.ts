import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 20_000;

export const messageRoleSchema = z.enum(["user", "assistant"]);
export const messageStatusSchema = z.enum([
  "streaming",
  "completed",
  "stopped",
  "error",
]);

export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const sendMessageRequestSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "请输入消息")
    .max(MAX_MESSAGE_LENGTH, `消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符`),
});

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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
  status: MessageStatus;
  model: string | null;
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
}

export interface StreamDeltaData {
  assistantMessageId: string;
  text: string;
}

export interface StreamDoneData {
  assistantMessageId: string;
  finishReason: string | null;
  usage: TokenUsage | null;
}

export interface StreamErrorData {
  assistantMessageId: string;
  code: StreamErrorCode;
  message: string;
  retryable: boolean;
}

export type StreamEvent =
  | { event: "meta"; data: StreamMetaData }
  | { event: "delta"; data: StreamDeltaData }
  | { event: "done"; data: StreamDoneData }
  | { event: "error"; data: StreamErrorData };

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
