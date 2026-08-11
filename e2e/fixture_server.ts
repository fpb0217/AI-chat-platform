import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildApp } from "../apps/api/src/app.js";
import { findWorkspaceRoot, loadConfig } from "../apps/api/src/config.js";
import { createDatabase } from "../apps/api/src/db/client.js";
import {
  ChatRepository,
  type TurnMessages,
} from "../apps/api/src/db/repository.js";
import type { ModelMessage } from "../apps/api/src/db/repository.js";
import {
  ProviderError,
  type ChatGenerationOptions,
  type ChatProvider,
  type ProviderEvent,
} from "../apps/api/src/provider/types.js";

const E2E_API_PORT = 3100;

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };

    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

class E2eProvider implements ChatProvider {
  public readonly configured = true;
  public readonly model = "deepseek-v4-flash";
  public readonly reasoningLevels = ["off", "low", "high", "max"] as const;

  async *streamChat(
    messages: ModelMessage[],
    options: ChatGenerationOptions,
  ): AsyncIterable<ProviderEvent> {
    const prompt = messages.at(-1)?.content ?? "";
    const { signal } = options;

    if (options.reasoningLevel !== "off") {
      yield { type: "phase", phase: "reasoning" };
      if (prompt.includes("长思考滚动")) {
        for (let index = 1; index <= 48; index += 1) {
          yield {
            type: "reasoning_delta",
            text: `分析步骤 ${index}：逐项检查问题中的条件与约束。\n\n`,
          };
          await wait(20, signal);
        }
        await wait(5_000, signal);
      } else {
        yield { type: "reasoning_delta", text: "我会先分析问题，" };
        await wait(225, signal);
        yield { type: "reasoning_delta", text: "再组织最终答案。" };
        await wait(prompt.includes("慢思考") ? 5_000 : 225, signal);
      }
    }
    yield { type: "phase", phase: "answer" };

    if (prompt.includes("触发错误")) {
      yield { type: "delta", text: "已经收到部分内容。" };
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "模型服务暂时不可用",
        true,
        503,
      );
    }

    if (prompt.includes("长度截断 Token")) {
      yield { type: "delta", text: "这是一个因长度限制而结束的回答。" };
      yield {
        type: "done",
        finishReason: "length",
        usage: {
          promptTokens: 6,
          completionTokens: 12,
          totalTokens: 18,
          reasoningTokens: options.reasoningLevel === "off" ? null : 5,
        },
      };
      return;
    }

    if (prompt.includes("慢回答")) {
      yield { type: "delta", text: "这是一段可以停止并保留的内容，" };
      await wait(5_000, signal);
      yield { type: "delta", text: "如果没有停止才会看到这里。" };
      yield { type: "done", finishReason: "stop", usage: null };
      return;
    }

    if (prompt.includes("代码块滚动")) {
      const lineDelay = prompt.includes("保留阅读位置") ? 50 : 12;
      yield { type: "delta", text: "下面是一个逐步生成的代码块：\n\n```ts\n" };
      for (let index = 0; index < 80; index += 1) {
        yield {
          type: "delta",
          text: `const value${index} = "streaming line ${index}";\n`,
        };
        await wait(lineDelay, signal);
      }
      yield { type: "delta", text: "```\n\n代码块生成完毕。" };
      yield { type: "done", finishReason: "stop", usage: null };
      return;
    }

    yield { type: "delta", text: "这是一个" };
    await wait(700, signal);
    yield { type: "delta", text: "逐字出现的流式回答。" };
    yield {
      type: "done",
      finishReason: "stop",
      usage: {
        promptTokens: 6,
        completionTokens: 12,
        totalTokens: 18,
        reasoningTokens: options.reasoningLevel === "off" ? null : 5,
      },
    };
  }
}

const config = loadConfig();
const migrationsFolder = resolve(findWorkspaceRoot(), "apps/api/drizzle");
const e2eDatabasePath = join(
  tmpdir(),
  `ai-chat-platform-e2e-${process.pid}.db`,
);

function seedLongConversation(): void {
  const database = createDatabase(e2eDatabasePath, migrationsFolder);
  const repository = new ChatRepository(database);
  repository.ensureDefaultConversation();

  let longConversationId: string | null = null;
  for (let turnIndex = 0; turnIndex < 250; turnIndex += 1) {
    const reasoningLevel = turnIndex % 5 === 0 ? "high" : "off";
    const turn: TurnMessages = repository.beginTurn(
      longConversationId,
      `长会话问题 ${turnIndex + 1}：请继续分析这个历史主题。`,
      "deepseek-v4-flash",
      reasoningLevel,
    );
    longConversationId = turn.userMessage.conversationId;
    const status =
      turnIndex % 37 === 0
        ? "error"
        : turnIndex % 29 === 0
          ? "stopped"
          : "completed";
    const reasoningContent =
      reasoningLevel === "high"
        ? `思考过程 ${turnIndex + 1}：先拆分约束，再检查上下文中的历史消息。`
        : null;
    const content =
      turnIndex === 249
        ? "长会话消息 500：这是最后一条消息，用于验证初始定位到底部。"
        : turnIndex % 11 === 0
          ? [
              `## 历史回答 ${turnIndex + 1}`,
              "",
              "这是一段包含列表、引用和行内 `virtualizer` 的长回答。",
              "",
              "- 保留滚动锚点",
              "- 测量动态高度",
              "",
              "> 历史消息离开视口后可以安全卸载。",
              "",
              "```ts",
              `const messageIndex = ${turnIndex};`,
              "console.log(messageIndex);",
              "```",
            ].join("\n")
          : `回答 ${turnIndex + 1}：这是用于虚拟列表回归的历史内容。`.repeat(
              turnIndex % 7 === 0 ? 3 : 1,
            );

    repository.finalizeAssistant(turn.assistantMessage.id, {
      content,
      reasoningContent,
      reasoningDurationMs: reasoningContent ? 1_200 : null,
      status,
      finishReason: status === "completed" ? "stop" : null,
      usage: null,
      errorCode: status === "error" ? "UPSTREAM_UNAVAILABLE" : null,
    });
  }

  if (!longConversationId) {
    throw new Error("Long E2E conversation was not created");
  }
  repository.renameConversation(longConversationId, "长会话测试");

  const defaultTurn = repository.beginTurn(
    "default",
    "E2E 默认会话消息",
    "deepseek-v4-flash",
    "off",
  );
  repository.finalizeAssistant(defaultTurn.assistantMessage.id, {
    content: "E2E 默认回答。",
    reasoningContent: null,
    reasoningDurationMs: null,
    status: "completed",
    finishReason: "stop",
    usage: null,
    errorCode: null,
  });
  database.close();
}

seedLongConversation();
const app = await buildApp({
  config: { ...config, port: E2E_API_PORT },
  databasePath: e2eDatabasePath,
  migrationsFolder,
  provider: new E2eProvider(),
  logger: false,
  serveFrontend: false,
});

await app.listen({ host: "127.0.0.1", port: E2E_API_PORT });

async function shutdown(): Promise<void> {
  await app.close();
  rmSync(e2eDatabasePath, { force: true });
  rmSync(`${e2eDatabasePath}-wal`, { force: true });
  rmSync(`${e2eDatabasePath}-shm`, { force: true });
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
