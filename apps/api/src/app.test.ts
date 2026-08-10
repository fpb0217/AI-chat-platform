import { resolve } from "node:path";
import {
  MAX_AUTOMATIC_TITLE_LENGTH,
  REASONING_LEVELS,
  truncateGraphemes,
  type ChatResponse,
  type ReasoningLevel,
} from "@ai-chat/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { findWorkspaceRoot, loadConfig } from "./config.js";
import type { ModelMessage } from "./db/repository.js";
import {
  ProviderError,
  type ChatGenerationOptions,
  type ChatProvider,
  type ProviderEvent,
} from "./provider/types.js";

type StreamFactory = (
  messages: ModelMessage[],
  options: ChatGenerationOptions,
) => AsyncIterable<ProviderEvent>;

class FakeProvider implements ChatProvider {
  public readonly configured = true;
  public readonly model = "deepseek-v4-flash";
  public readonly reasoningLevels: readonly ReasoningLevel[];
  public capturedMessages: ModelMessage[] = [];
  public capturedReasoningLevel: ReasoningLevel | null = null;
  public titleCalls: Array<{ question: string; answer: string }> = [];

  public constructor(
    private readonly factory: StreamFactory,
    reasoningLevels: readonly ReasoningLevel[] = REASONING_LEVELS,
    private readonly titleFactory?: (
      question: string,
      answer: string,
    ) => Promise<string> | string,
  ) {
    this.reasoningLevels = reasoningLevels;
  }

  streamChat(
    messages: ModelMessage[],
    options: ChatGenerationOptions,
  ): AsyncIterable<ProviderEvent> {
    this.capturedMessages = messages;
    this.capturedReasoningLevel = options.reasoningLevel;
    return this.factory(messages, options);
  }

  async generateTitle(question: string, answer: string): Promise<string> {
    this.titleCalls.push({ question, answer });
    return (
      this.titleFactory?.(question, answer) ??
      truncateGraphemes(question, MAX_AUTOMATIC_TITLE_LENGTH)
    );
  }
}

interface NamedEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseEvents(body: string): NamedEvent[] {
  return body
    .split(/\r?\n\r?\n/u)
    .map((block) => block.trim())
    .filter((block) => block.startsWith("event:"))
    .map((block) => {
      const lines = block.split(/\r?\n/u);
      const event = lines[0]?.slice("event:".length).trim() ?? "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

async function createTestServer(provider: ChatProvider) {
  const config = loadConfig();
  const app = await buildApp({
    config,
    databasePath: ":memory:",
    migrationsFolder: resolve(findWorkspaceRoot(), "apps/api/drizzle"),
    provider,
    logger: false,
    serveFrontend: false,
  });
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, url };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error("Condition was not met before timeout");
}

describe("chat API", () => {
  const openApps: Array<Awaited<ReturnType<typeof createTestServer>>["app"]> = [];

  afterEach(async () => {
    await Promise.all(openApps.splice(0).map((app) => app.close()));
  });

  it("streams named SSE events and persists the completed assistant message", async () => {
    const provider = new FakeProvider(async function* () {
      yield { type: "phase", phase: "reasoning" };
      yield { type: "reasoning_delta", text: "先分析，" };
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      yield { type: "reasoning_delta", text: "再组织答案。" };
      yield { type: "phase", phase: "answer" };
      yield { type: "delta", text: "你好，" };
      yield { type: "delta", text: "世界" };
      yield {
        type: "done",
        finishReason: "stop",
        usage: {
          promptTokens: 8,
          completionTokens: 3,
          totalTokens: 11,
          reasoningTokens: 1,
        },
      };
    });
    const { app, url } = await createTestServer(provider);
    openApps.push(app);

    const response = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "打个招呼", reasoningLevel: "high" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = parseEvents(await response.text());
    expect(events.map((event) => event.event)).toEqual([
      "meta",
      "phase",
      "reasoning_delta",
      "reasoning_delta",
      "phase",
      "delta",
      "delta",
      "done",
    ]);
    expect(events[0]?.data).toMatchObject({
      model: "deepseek-v4-flash",
      reasoningLevel: "high",
    });
    expect(events[1]?.data).toMatchObject({ phase: "reasoning" });
    expect(events[2]?.data).toMatchObject({ text: "先分析，" });
    expect(events[4]?.data).toMatchObject({
      phase: "answer",
      reasoningDurationMs: expect.any(Number),
    });
    expect(events[5]?.data).toMatchObject({ text: "你好，" });
    expect(events.at(-1)?.data).toMatchObject({
      reasoningDurationMs: expect.any(Number),
    });

    const chat = (await (
      await fetch(`${url}/api/chat`)
    ).json()) as ChatResponse;
    expect(chat.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "你好，世界",
      reasoningContent: "先分析，再组织答案。",
      reasoningDurationMs: expect.any(Number),
      status: "completed",
      reasoningLevel: "high",
      usage: {
        promptTokens: 8,
        completionTokens: 3,
        totalTokens: 11,
        reasoningTokens: 1,
      },
    });
    expect(provider.capturedMessages).toEqual([
      { role: "user", content: "打个招呼" },
    ]);
    expect(provider.capturedReasoningLevel).toBe("high");
  });

  it("creates, isolates, renames, auto-titles, and deletes multiple conversations", async () => {
    const provider = new FakeProvider(
      async function* (messages) {
        yield { type: "delta", text: `回答：${messages.at(-1)?.content ?? ""}` };
        yield { type: "done", finishReason: "stop", usage: null };
      },
      REASONING_LEVELS,
      async () => "跨会话标题",
    );
    const { app, url } = await createTestServer(provider);
    openApps.push(app);

    const initialList = (await (await fetch(`${url}/api/conversations`)).json()) as {
      conversations: Array<{ id: string }>;
    };
    expect(initialList.conversations).toEqual([]);

    const firstResponse = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: null,
        content: "第一个会话的问题",
        reasoningLevel: "off",
      }),
    });
    const firstEvents = parseEvents(await firstResponse.text());
    const firstMeta = firstEvents[0]?.data as { conversationId: string; turnId: string };
    expect(firstMeta.conversationId).toMatch(/^[0-9a-f-]{36}$/u);

    const secondResponse = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: null,
        content: "第二个会话的问题",
        reasoningLevel: "off",
      }),
    });
    const secondEvents = parseEvents(await secondResponse.text());
    const secondMeta = secondEvents[0]?.data as { conversationId: string; turnId: string };
    expect(secondMeta.conversationId).not.toBe(firstMeta.conversationId);
    expect(provider.capturedMessages).toEqual([
      { role: "user", content: "第二个会话的问题" },
    ]);

    const continueResponse = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: firstMeta.conversationId,
        content: "继续第一个会话",
        reasoningLevel: "off",
      }),
    });
    expect(continueResponse.status).toBe(200);
    const continueEvents = parseEvents(await continueResponse.text());
    const continueMeta = continueEvents[0]?.data as { turnId: string };
    expect(provider.capturedMessages).toEqual([
      { role: "user", content: "第一个会话的问题" },
      { role: "assistant", content: "回答：第一个会话的问题" },
      { role: "user", content: "继续第一个会话" },
    ]);

    const titleResponse = await fetch(
      `${url}/api/conversations/${firstMeta.conversationId}/auto-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId: continueMeta.turnId }),
      },
    );
    expect(await titleResponse.json()).toMatchObject({
      title: "跨会话标题",
      titleSource: "auto",
    });
    const repeatedTitleResponse = await fetch(
      `${url}/api/conversations/${firstMeta.conversationId}/auto-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId: continueMeta.turnId }),
      },
    );
    expect(await repeatedTitleResponse.json()).toMatchObject({
      title: "跨会话标题",
    });
    expect(provider.titleCalls).toHaveLength(1);

    const renameResponse = await fetch(
      `${url}/api/conversations/${firstMeta.conversationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "手动会话" }),
      },
    );
    expect(await renameResponse.json()).toMatchObject({
      title: "手动会话",
      titleSource: "manual",
    });

    const deleteResponse = await fetch(
      `${url}/api/conversations/${secondMeta.conversationId}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);
    expect(
      (
        (await (await fetch(`${url}/api/conversations`)).json()) as {
          conversations: Array<{ id: string; title: string }>;
        }
      ).conversations,
    ).toMatchObject([{ id: firstMeta.conversationId, title: "手动会话" }]);
    expect(
      (await fetch(`${url}/api/conversations/${secondMeta.conversationId}`)).status,
    ).toBe(404);
  });

  it("rejects invalid input before creating a turn", async () => {
    const provider = new FakeProvider(async function* () {
      yield { type: "done", finishReason: "stop", usage: null };
    });
    const { app, url } = await createTestServer(provider);
    openApps.push(app);

    const response = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });
    expect(response.status).toBe(400);
    const chat = (await (
      await fetch(`${url}/api/chat`)
    ).json()) as ChatResponse;
    expect(chat.messages).toHaveLength(0);
  });

  it("rejects invalid and unsupported reasoning levels before creating a turn", async () => {
    const provider = new FakeProvider(
      async function* () {
        yield { type: "done", finishReason: "stop", usage: null };
      },
      ["off", "high"],
    );
    const { app, url } = await createTestServer(provider);
    openApps.push(app);

    const invalid = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "测试", reasoningLevel: "turbo" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "INVALID_REASONING_LEVEL" },
    });

    const unsupported = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "测试", reasoningLevel: "low" }),
    });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({
      error: { code: "UNSUPPORTED_REASONING_LEVEL" },
    });

    const chat = (await (
      await fetch(`${url}/api/chat`)
    ).json()) as ChatResponse;
    expect(chat.messages).toHaveLength(0);
  });

  it("normalizes provider errors and persists the failed assistant", async () => {
    const provider = new FakeProvider(async function* () {
      yield { type: "phase", phase: "reasoning" };
      yield { type: "reasoning_delta", text: "部分思考" };
      yield { type: "delta", text: "部分" };
      throw new ProviderError("RATE_LIMITED", "请求频率过高", true, 429);
    });
    const { app, url } = await createTestServer(provider);
    openApps.push(app);

    const response = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "触发错误" }),
    });
    const events = parseEvents(await response.text());
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: {
        code: "RATE_LIMITED",
        retryable: true,
        reasoningDurationMs: expect.any(Number),
      },
    });
    const chat = (await (
      await fetch(`${url}/api/chat`)
    ).json()) as ChatResponse;
    expect(chat.messages.at(-1)).toMatchObject({
      content: "部分",
      reasoningContent: "部分思考",
      reasoningDurationMs: expect.any(Number),
      status: "error",
      errorCode: "RATE_LIMITED",
    });
  });

  it("rejects concurrent generations and marks a disconnected stream stopped", async () => {
    const provider = new FakeProvider(async function* (_messages, options) {
      yield { type: "delta", text: "已经生成的部分" };
      await new Promise<void>((_resolve, reject) => {
        const abort = () =>
          reject(options.signal.reason ?? new Error("aborted"));
        if (options.signal.aborted) {
          abort();
        } else {
          options.signal.addEventListener("abort", abort, { once: true });
        }
      });
    });
    const { app, url } = await createTestServer(provider);
    openApps.push(app);
    const controller = new AbortController();

    const first = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "慢回答" }),
      signal: controller.signal,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "并发回答" }),
    });
    expect(second.status).toBe(409);

    controller.abort();
    await waitFor(async () => {
      const chat = (await (
        await fetch(`${url}/api/chat`)
      ).json()) as ChatResponse;
      return chat.messages.at(-1)?.status === "stopped";
    });

    const chat = (await (
      await fetch(`${url}/api/chat`)
    ).json()) as ChatResponse;
    expect(chat.messages.at(-1)).toMatchObject({
      status: "stopped",
      content: "已经生成的部分",
    });
  });

  it("persists partial reasoning when the client disconnects before the answer", async () => {
    const provider = new FakeProvider(async function* (_messages, options) {
      yield { type: "phase", phase: "reasoning" };
      yield { type: "reasoning_delta", text: "已经生成的部分思考" };
      await new Promise<void>((_resolve, reject) => {
        const abort = () =>
          reject(options.signal.reason ?? new Error("aborted"));
        if (options.signal.aborted) {
          abort();
        } else {
          options.signal.addEventListener("abort", abort, { once: true });
        }
      });
    });
    const { app, url } = await createTestServer(provider);
    openApps.push(app);
    const controller = new AbortController();

    const response = await fetch(`${url}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "慢思考", reasoningLevel: "high" }),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("event: reasoning_delta")) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) {
        break;
      }
      received += decoder.decode(chunk.value, { stream: true });
    }
    expect(received).toContain("已经生成的部分思考");

    controller.abort();
    await waitFor(async () => {
      const chat = (await (
        await fetch(`${url}/api/chat`)
      ).json()) as ChatResponse;
      return chat.messages.at(-1)?.status === "stopped";
    });

    const chat = (await (
      await fetch(`${url}/api/chat`)
    ).json()) as ChatResponse;
    expect(chat.messages.at(-1)).toMatchObject({
      status: "stopped",
      content: "",
      reasoningContent: "已经生成的部分思考",
      reasoningDurationMs: expect.any(Number),
    });
  });
});
