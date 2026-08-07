import { defineComponent, h, type ComponentPublicInstance } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import type { ChatResponse } from "@ai-chat/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./use_chat";

const emptyChat: ChatResponse = {
  conversation: {
    id: "default",
    title: "本地对话",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  messages: [],
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useChat", () => {
  it("moves a successful SSE response through streaming to completed", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/chat")) {
        return Response.json(emptyChat);
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'event: meta\ndata: {"userMessageId":"u1","assistantMessageId":"a1","turnId":"t1"}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: delta\ndata: {"assistantMessageId":"a1","text":"你好"}\n\n',
              ),
            );
            window.setTimeout(() => {
              controller.enqueue(
                encoder.encode(
                  'event: delta\ndata: {"assistantMessageId":"a1","text":"，世界"}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: done\ndata: {"assistantMessageId":"a1","finishReason":"stop","usage":null}\n\n',
                ),
              );
              controller.close();
            }, 100);
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { chat, wrapper } = mountChat();

    await chat.loadChat();
    await chat.sendMessage("问候");

    expect(chat.streamState.value).toBe("idle");
    expect(chat.messages.value).toHaveLength(2);
    expect(chat.messages.value[1]).toMatchObject({
      id: "a1",
      content: "你好，世界",
      status: "completed",
      finishReason: "stop",
    });
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
                  'event: meta\ndata: {"userMessageId":"u2","assistantMessageId":"a2","turnId":"t2"}\n\nevent: delta\ndata: {"assistantMessageId":"a2","text":"保留这些内容"}\n\n',
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
});
