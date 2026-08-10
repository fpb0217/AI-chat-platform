import { defineComponent, h, type ComponentPublicInstance } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import type { ChatResponse, HealthResponse } from "@ai-chat/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./use_chat";

const emptyChat: ChatResponse = {
  conversation: {
    id: "default",
    title: "本地对话",
    titleSource: "auto",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  messages: [],
};

const health: HealthResponse = {
  status: "ok",
  database: "ready",
  providerConfigured: true,
  model: "deepseek-v4-flash",
  reasoningCapabilities: {
    levels: ["off", "low", "high", "max"],
    defaultLevel: "off",
  },
};

type ChatController = ReturnType<typeof useChat>;

function mountChat(): {
  chat: ChatController;
  wrapper: VueWrapper<ComponentPublicInstance>;
} {
  let chat: ChatController | undefined;
  const component = defineComponent({
    setup() {
      chat = useChat();
      return () => h("div");
    },
  });
  const wrapper = mount(component);
  if (!chat) {
    throw new Error("Chat composable did not initialize");
  }
  return { chat, wrapper };
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useChat", () => {
  it("moves a successful SSE response through streaming to completed", async () => {
    const encoder = new TextEncoder();
    let messageRequestBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/health")) {
          return Response.json(health);
        }
        if (String(input).endsWith("/api/chat")) {
          return Response.json(emptyChat);
        }
        messageRequestBody = JSON.parse(init?.body as string) as Record<
          string,
          unknown
        >;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: meta\ndata: {"userMessageId":"u1","assistantMessageId":"a1","turnId":"t1","model":"deepseek-v4-flash","reasoningLevel":"high"}\n\nevent: phase\ndata: {"assistantMessageId":"a1","phase":"reasoning","reasoningDurationMs":null}\n\nevent: reasoning_delta\ndata: {"assistantMessageId":"a1","text":"先分析问题。"}\n\n',
                ),
              );
              window.setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    'event: phase\ndata: {"assistantMessageId":"a1","phase":"answer","reasoningDurationMs":1250}\n\nevent: delta\ndata: {"assistantMessageId":"a1","text":"你好"}\n\nevent: delta\ndata: {"assistantMessageId":"a1","text":"，世界"}\n\n',
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    'event: done\ndata: {"assistantMessageId":"a1","finishReason":"stop","usage":null,"reasoningDurationMs":1250}\n\n',
                  ),
                );
                controller.close();
              }, 100);
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { chat, wrapper } = mountChat();

    await chat.loadChat();
    const sending = chat.sendMessage("问候", "high");
    await flushPromises();
    expect(chat.streamState.value).toBe("reasoning");
    expect(chat.messages.value[1]).toMatchObject({
      reasoningContent: "先分析问题。",
      reasoningDurationMs: null,
    });
    await sending;

    expect(chat.streamState.value).toBe("idle");
    expect(messageRequestBody).toEqual({
      conversationId: null,
      content: "问候",
      reasoningLevel: "high",
    });
    expect(chat.messages.value).toHaveLength(2);
    expect(chat.messages.value[1]).toMatchObject({
      id: "a1",
      content: "你好，世界",
      reasoningContent: "先分析问题。",
      reasoningDurationMs: 1_250,
      status: "completed",
      model: "deepseek-v4-flash",
      reasoningLevel: "high",
      finishReason: "stop",
    });
    wrapper.unmount();
  });

  it("restores only a supported reasoning preference", async () => {
    window.localStorage.setItem("ai-chat.reasoning-level.v1", "max");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          String(input).endsWith("/api/health") ? health : emptyChat,
        ),
      ),
    );
    const { chat, wrapper } = mountChat();

    await chat.loadChat();
    expect(chat.reasoningLevel.value).toBe("max");
    chat.setReasoningLevel("low");
    expect(chat.reasoningLevel.value).toBe("low");
    expect(window.localStorage.getItem("ai-chat.reasoning-level.v1")).toBe(
      "low",
    );
    wrapper.unmount();
  });

  it("aborts an active request, flushes buffered content and marks it stopped", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: meta\ndata: {"userMessageId":"u2","assistantMessageId":"a2","turnId":"t2","model":"deepseek-v4-flash","reasoningLevel":"off"}\n\nevent: phase\ndata: {"assistantMessageId":"a2","phase":"answer","reasoningDurationMs":null}\n\nevent: delta\ndata: {"assistantMessageId":"a2","text":"保留这些内容"}\n\n',
                ),
              );
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { chat, wrapper } = mountChat();

    const sending = chat.sendMessage("慢一点");
    await flushPromises();
    expect(chat.isGenerating.value).toBe(true);
    chat.stopGeneration();
    await sending;

    expect(chat.messages.value[1]).toMatchObject({
      id: "a2",
      content: "保留这些内容",
      status: "stopped",
    });
    expect(chat.streamState.value).toBe("idle");
    wrapper.unmount();
  });

  it("keeps partial reasoning when generation is stopped before the answer", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: meta\ndata: {"userMessageId":"u3","assistantMessageId":"a3","turnId":"t3","model":"deepseek-v4-flash","reasoningLevel":"high"}\n\nevent: phase\ndata: {"assistantMessageId":"a3","phase":"reasoning","reasoningDurationMs":null}\n\nevent: reasoning_delta\ndata: {"assistantMessageId":"a3","text":"已经生成的部分思考"}\n\n',
                ),
              );
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { chat, wrapper } = mountChat();

    const sending = chat.sendMessage("请深入分析");
    await flushPromises();
    expect(chat.streamState.value).toBe("reasoning");
    chat.stopGeneration();
    await sending;

    expect(chat.messages.value[1]).toMatchObject({
      id: "a3",
      content: "",
      reasoningContent: "已经生成的部分思考",
      status: "stopped",
    });
    expect(chat.streamState.value).toBe("idle");
    wrapper.unmount();
  });
});
