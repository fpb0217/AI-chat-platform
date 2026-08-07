import type { ServerResponse } from "node:http";
import {
  sendMessageRequestSchema,
  type ApiErrorResponse,
  type StreamDeltaData,
  type StreamDoneData,
  type StreamErrorCode,
  type StreamErrorData,
  type StreamMetaData,
  type TokenUsage,
} from "@ai-chat/shared";
import type { FastifyInstance } from "fastify";
import type { ChatRepository } from "../db/repository.js";
import { ProviderError, type ChatProvider } from "../provider/types.js";

interface ChatRouteOptions {
  repository: ChatRepository;
  provider: ChatProvider;
  requestTimeoutMs: number;
}

interface SafeStreamError {
  code: StreamErrorCode;
  message: string;
  retryable: boolean;
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function writeSse(
  response: ServerResponse,
  event: string,
  data: unknown,
): boolean {
  if (response.destroyed || response.writableEnded) {
    return false;
  }
  response.write(formatSse(event, data));
  return true;
}

function safeError(
  error: unknown,
  timedOut: boolean,
): SafeStreamError {
  if (timedOut) {
    return {
      code: "UPSTREAM_TIMEOUT",
      message: "模型响应超时，请稍后再试",
      retryable: true,
    };
  }
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: "UPSTREAM_STREAM_INTERRUPTED",
    message: "模型响应意外中断",
    retryable: true,
  };
}

function jsonError(code: string, message: string): ApiErrorResponse {
  return { error: { code, message } };
}

export function registerChatRoutes(
  app: FastifyInstance,
  options: ChatRouteOptions,
): void {
  let generationActive = false;

  app.get("/api/health", async () => ({
    status: "ok" as const,
    database: "ready" as const,
    providerConfigured: options.provider.configured,
    model: options.provider.model,
  }));

  app.get("/api/chat", async () => options.repository.getChat());

  app.post("/api/chat/messages", async (request, reply) => {
    const parsed = sendMessageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(
        jsonError(
          "INVALID_MESSAGE",
          parsed.error.issues[0]?.message ?? "消息格式无效",
        ),
      );
    }
    if (!options.provider.configured) {
      return reply
        .status(503)
        .send(jsonError("PROVIDER_NOT_CONFIGURED", "尚未配置 DeepSeek API Key"));
    }
    if (generationActive) {
      return reply
        .status(409)
        .send(jsonError("GENERATION_IN_PROGRESS", "当前已有回答正在生成"));
    }

    generationActive = true;
    let turn;
    try {
      turn = options.repository.beginTurn(
        parsed.data.content,
        options.provider.model,
      );
    } catch (error) {
      generationActive = false;
      throw error;
    }

    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const meta: StreamMetaData = {
      userMessageId: turn.userMessage.id,
      assistantMessageId: turn.assistantMessage.id,
      turnId: turn.userMessage.turnId,
    };
    writeSse(response, "meta", meta);

    const upstreamController = new AbortController();
    let clientDisconnected = false;
    let timedOut = false;
    let finalized = false;
    let assistantContent = "";
    let finishReason: string | null = null;
    let usage: TokenUsage | null = null;

    const disconnect = () => {
      if (!finalized && !response.writableEnded) {
        clientDisconnected = true;
        upstreamController.abort(new Error("client disconnected"));
      }
    };
    request.raw.once("aborted", disconnect);
    response.once("close", disconnect);

    const timeout = setTimeout(() => {
      if (!finalized) {
        timedOut = true;
        upstreamController.abort(new Error("provider timeout"));
      }
    }, options.requestTimeoutMs);
    timeout.unref();

    const keepAlive = setInterval(() => {
      if (!response.destroyed && !response.writableEnded) {
        response.write(": keep-alive\n\n");
      }
    }, 15_000);
    keepAlive.unref();

    try {
      const history = options.repository.getModelHistory();
      for await (const providerEvent of options.provider.streamChat(
        history,
        upstreamController.signal,
      )) {
        if (providerEvent.type === "delta") {
          assistantContent += providerEvent.text;
          const delta: StreamDeltaData = {
            assistantMessageId: turn.assistantMessage.id,
            text: providerEvent.text,
          };
          if (!writeSse(response, "delta", delta)) {
            disconnect();
          }
          continue;
        }

        finishReason = providerEvent.finishReason;
        usage = providerEvent.usage;
      }

      if (clientDisconnected) {
        options.repository.finalizeAssistant(turn.assistantMessage.id, {
          content: assistantContent,
          status: "stopped",
          finishReason,
          usage,
          errorCode: null,
        });
      } else {
        options.repository.finalizeAssistant(turn.assistantMessage.id, {
          content: assistantContent,
          status: "completed",
          finishReason,
          usage,
          errorCode: null,
        });
        const done: StreamDoneData = {
          assistantMessageId: turn.assistantMessage.id,
          finishReason,
          usage,
        };
        writeSse(response, "done", done);
      }
    } catch (error) {
      if (clientDisconnected) {
        options.repository.finalizeAssistant(turn.assistantMessage.id, {
          content: assistantContent,
          status: "stopped",
          finishReason,
          usage,
          errorCode: null,
        });
      } else {
        const mapped = safeError(error, timedOut);
        options.repository.finalizeAssistant(turn.assistantMessage.id, {
          content: assistantContent,
          status: "error",
          finishReason,
          usage,
          errorCode: mapped.code,
        });
        const streamError: StreamErrorData = {
          assistantMessageId: turn.assistantMessage.id,
          ...mapped,
        };
        writeSse(response, "error", streamError);
        request.log.warn(
          {
            code: mapped.code,
            retryable: mapped.retryable,
            providerStatus:
              error instanceof ProviderError ? error.statusCode : undefined,
          },
          "Chat generation ended with an error",
        );
      }
    } finally {
      finalized = true;
      generationActive = false;
      clearTimeout(timeout);
      clearInterval(keepAlive);
      request.raw.off("aborted", disconnect);
      response.off("close", disconnect);
      if (!response.destroyed && !response.writableEnded) {
        response.end();
      }
    }

    return undefined;
  });
}

