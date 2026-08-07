import type {
  GenerationPhase,
  ReasoningLevel,
  StreamErrorCode,
  TokenUsage,
} from "@ai-chat/shared";
import type { ModelMessage } from "../db/repository.js";

export type ProviderEvent =
  | { type: "phase"; phase: GenerationPhase }
  | { type: "delta"; text: string }
  | {
      type: "done";
      finishReason: string | null;
      usage: TokenUsage | null;
    };

export interface ChatGenerationOptions {
  signal: AbortSignal;
  reasoningLevel: ReasoningLevel;
}

export interface ChatProvider {
  readonly configured: boolean;
  readonly model: string;
  readonly reasoningLevels: readonly ReasoningLevel[];
  streamChat(
    messages: ModelMessage[],
    options: ChatGenerationOptions,
  ): AsyncIterable<ProviderEvent>;
}

export class ProviderError extends Error {
  public constructor(
    public readonly code: StreamErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
