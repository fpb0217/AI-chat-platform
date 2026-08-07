import type { TokenUsage } from "@ai-chat/shared";
import type { ModelMessage } from "../db/repository.js";
import { SseDataParser } from "./sse_data_parser.js";
import {
  ProviderError,
  type ChatProvider,
  type ProviderEvent,
} from "./types.js";

interface DeepSeekChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

export interface DeepSeekProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImplementation?: typeof fetch;
}

function mapHttpError(status: number): ProviderError {
  switch (status) {
    case 400:
    case 422:
      return new ProviderError(
        "UPSTREAM_INVALID_REQUEST",
        "模型请求参数无效",
        false,
        status,
      );
    case 401:
      return new ProviderError(
        "INVALID_API_KEY",
        "DeepSeek API Key 无效",
        false,
        status,
      );
    case 402:
      return new ProviderError(
        "INSUFFICIENT_BALANCE",
        "DeepSeek 账户余额不足",
        false,
        status,
      );
    case 429:
      return new ProviderError(
        "RATE_LIMITED",
        "模型请求过于频繁，请稍后再试",
        true,
        status,
      );
    default:
      return new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "模型服务暂时不可用",
        status >= 500,
        status,
      );
  }
}

function parseUsage(chunk: DeepSeekChunk): TokenUsage | null {
  const usage = chunk.usage;
  if (
    !usage ||
    typeof usage.prompt_tokens !== "number" ||
    typeof usage.completion_tokens !== "number" ||
    typeof usage.total_tokens !== "number"
  ) {
    return null;
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export class DeepSeekProvider implements ChatProvider {
  public readonly configured: boolean;
  public readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;

  public constructor(private readonly options: DeepSeekProviderOptions) {
    this.configured = options.apiKey.trim().length > 0;
    this.model = options.model;
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async *streamChat(
    messages: ModelMessage[],
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          thinking: { type: "disabled" },
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "无法连接模型服务",
        true,
      );
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw mapHttpError(response.status);
    }
    if (!response.body) {
      throw new ProviderError(
        "UPSTREAM_STREAM_INTERRUPTED",
        "模型服务未返回数据流",
        true,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseDataParser();
    let finishReason: string | null = null;
    let usage: TokenUsage | null = null;

    const consumeData = (data: string): DeepSeekChunk | "done" => {
      if (data.trim() === "[DONE]") {
        return "done";
      }
      try {
        return JSON.parse(data) as DeepSeekChunk;
      } catch {
        throw new ProviderError(
          "UPSTREAM_STREAM_INTERRUPTED",
          "模型流包含无法解析的数据",
          true,
        );
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        const dataEvents = done
          ? [...parser.feed(decoder.decode()), ...parser.end()]
          : parser.feed(decoder.decode(value, { stream: true }));

        for (const data of dataEvents) {
          const parsed = consumeData(data);
          if (parsed === "done") {
            yield { type: "done", finishReason, usage };
            return;
          }

          usage = parseUsage(parsed) ?? usage;
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
            finishReason = choice.finish_reason;
          }
          const text = choice?.delta?.content;
          if (typeof text === "string" && text.length > 0) {
            yield { type: "delta", text };
          }
        }

        if (done) {
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    throw new ProviderError(
      "UPSTREAM_STREAM_INTERRUPTED",
      "模型数据流意外结束",
      true,
    );
  }
}

