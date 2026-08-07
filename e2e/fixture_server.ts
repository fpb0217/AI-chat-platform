import { resolve } from "node:path";
import { buildApp } from "../apps/api/src/app.js";
import { findWorkspaceRoot, loadConfig } from "../apps/api/src/config.js";
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
const app = await buildApp({
  config: { ...config, port: E2E_API_PORT },
  databasePath: ":memory:",
  migrationsFolder: resolve(findWorkspaceRoot(), "apps/api/drizzle"),
  provider: new E2eProvider(),
  logger: false,
  serveFrontend: false,
});

await app.listen({ host: "127.0.0.1", port: E2E_API_PORT });

async function shutdown(): Promise<void> {
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
