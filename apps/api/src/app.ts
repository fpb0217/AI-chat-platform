import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, DEEPSEEK_MODEL, type AppConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { ChatRepository } from "./db/repository.js";
import { DeepSeekProvider } from "./provider/deepseek.js";
import type { ChatProvider } from "./provider/types.js";
import { registerChatRoutes } from "./routes/chat.js";

export interface BuildAppOptions {
  config?: AppConfig;
  databasePath?: string;
  migrationsFolder?: string;
  provider?: ChatProvider;
  logger?: boolean;
  serveFrontend?: boolean;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const database = createDatabase(
    options.databasePath ?? config.databasePath,
    options.migrationsFolder ?? config.migrationsFolder,
  );
  const repository = new ChatRepository(database);
  repository.ensureDefaultConversation();
  repository.markInterruptedMessages();

  const provider =
    options.provider ??
    new DeepSeekProvider({
      apiKey: config.deepSeekApiKey,
      baseUrl: config.deepSeekBaseUrl,
      model: DEEPSEEK_MODEL,
    });

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: "info",
            redact: {
              paths: ["req.headers.authorization", "headers.authorization"],
              censor: "[REDACTED]",
            },
          },
    bodyLimit: 64 * 1024,
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
  });

  app.addHook("onClose", async () => {
    database.close();
  });

  registerChatRoutes(app, {
    repository,
    provider,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  const shouldServeFrontend = options.serveFrontend !== false;
  if (
    shouldServeFrontend &&
    existsSync(join(config.webDistPath, "index.html"))
  ) {
    await app.register(fastifyStatic, {
      root: config.webDistPath,
      prefix: "/",
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply
        .status(404)
        .send({ error: { code: "NOT_FOUND", message: "接口不存在" } });
    });
  }

  app.setErrorHandler(async (error, request, reply) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    request.log.error(
      { errorName, statusCode },
      "Unhandled request error",
    );
    if (!reply.sent) {
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "服务器内部错误" },
      });
    }
    return undefined;
  });

  return app;
}
