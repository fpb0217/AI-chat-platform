import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type {
  RenderedChatMessage,
  StreamState,
} from "../composables/use_chat";
import { createLongConversation } from "../test/long_conversation";
import VirtualMessageList from "./VirtualMessageList.vue";
import {
  BOTTOM_THRESHOLD,
  MESSAGE_LIST_OVERSCAN,
  estimateMessageSize,
} from "./virtual_message_list";

const virtualizerMock = vi.hoisted(() => ({
  options: undefined as { value: { count: number; getItemKey: (index: number) => string } } | undefined,
  measureElement: vi.fn(),
  measure: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: (options: typeof virtualizerMock.options) => {
    virtualizerMock.options = options;
    return {
      value: {
        getVirtualItems: () => {
          const count = options?.value.count ?? 0;
          const renderedCount = Math.min(count, MESSAGE_LIST_OVERSCAN * 2);
          return Array.from({ length: renderedCount }, (_, index) => ({
            key: options?.value.getItemKey(index) ?? index,
            index,
            start: index * 100,
            end: index * 100 + 90,
            size: 90,
            lane: 0,
          }));
        },
        getTotalSize: () => (options?.value.count ?? 0) * 100,
        measureElement: virtualizerMock.measureElement,
        measure: virtualizerMock.measure,
        scrollToIndex: virtualizerMock.scrollToIndex,
      },
    };
  },
}));

function mountList(
  messages: RenderedChatMessage[],
  streamState: StreamState = "idle",
) {
  return mount(VirtualMessageList, {
    props: {
      messages,
      streamState,
      conversationKey: "test-conversation",
    },
  });
}

describe("VirtualMessageList", () => {
  it.each([100, 300, 500])(
    "keeps the mounted row count bounded for %i messages",
    async (count) => {
      const wrapper = mountList(createLongConversation(count));
      await nextTick();

      expect(wrapper.findAll(".message-row")).toHaveLength(
        MESSAGE_LIST_OVERSCAN * 2,
      );
      expect(wrapper.find(".message-list").attributes("aria-setsize")).toBe(
        String(count),
      );
      expect(wrapper.find(".message-row").attributes("aria-posinset")).toBe(
        "1",
      );
      expect(wrapper.find(".message-row").attributes("aria-setsize")).toBe(
        String(count),
      );
      wrapper.unmount();
    },
  );

  it("does not mount message rows for an empty conversation", () => {
    const wrapper = mountList([]);

    expect(wrapper.find(".message-list").exists()).toBe(false);
    expect(wrapper.findAll(".message-row")).toHaveLength(0);
    wrapper.unmount();
  });

  it("uses stable render keys when the message id changes", async () => {
    const messages = createLongConversation(1);
    const wrapper = mountList(messages);
    await nextTick();
    const renderKey = wrapper.find(".virtual-message-row").attributes(
      "data-render-key",
    );

    const original = messages[0];
    if (!original) {
      throw new Error("Expected one test message");
    }
    messages[0] = { ...original, id: "server-id-after-meta" };
    await wrapper.setProps({ messages });

    expect(
      wrapper.find(".virtual-message-row").attributes("data-render-key"),
    ).toBe(renderKey);
    expect(virtualizerMock.options?.value.getItemKey(0)).toBe(renderKey);
    wrapper.unmount();
  });

  it("projects final token usage to the matching user and assistant rows", async () => {
    const messages = createLongConversation(2);
    const user = messages[0];
    const assistant = messages[1];
    if (!user || !assistant) {
      throw new Error("Expected a complete test turn");
    }
    messages[0] = { ...user, turnId: "usage-turn" };
    messages[1] = {
      ...assistant,
      turnId: "usage-turn",
      reasoningLevel: "off",
      usage: {
        promptTokens: 1_234,
        completionTokens: 568,
        totalTokens: 1_802,
        reasoningTokens: null,
      },
    };

    const wrapper = mountList(messages);
    await nextTick();

    const rows = wrapper.findAll(".message-row");
    expect(rows[0]?.find(".message-token-usage").text()).toContain(
      "实际输入 1,234",
    );
    expect(rows[1]?.find(".message-token-usage").text()).toContain("正文 568");
    expect(rows[1]?.find(".message-token-usage").text()).not.toContain("思考");
    wrapper.unmount();
  });

  it("updates pending thinking usage to its final split and remeasures the row", async () => {
    const messages = createLongConversation(2);
    const user = messages[0];
    const assistant = messages[1];
    if (!user || !assistant) {
      throw new Error("Expected a complete test turn");
    }
    messages[0] = { ...user, turnId: "thinking-usage-turn" };
    messages[1] = {
      ...assistant,
      turnId: "thinking-usage-turn",
      status: "streaming",
      reasoningLevel: "high",
      usage: null,
    };

    const wrapper = mountList(messages, "reasoning");
    await nextTick();
    const pendingRows = wrapper.findAll(".message-row");
    expect(pendingRows[0]?.find(".message-token-usage").text()).toContain(
      "实际输入 计算中…",
    );
    expect(pendingRows[1]?.find(".message-token-usage").text()).toContain(
      "思考 计算中…",
    );

    virtualizerMock.measureElement.mockClear();
    const finalized = messages.map((message, index) =>
      index === 1
        ? {
            ...message,
            status: "completed" as const,
            usage: {
              promptTokens: 6,
              completionTokens: 12,
              totalTokens: 18,
              reasoningTokens: 5,
            },
          }
        : message,
    );
    await wrapper.setProps({ messages: finalized, streamState: "idle" });
    await nextTick();
    await nextTick();

    const finalRows = wrapper.findAll(".message-row");
    expect(finalRows[0]?.find(".message-token-usage").text()).toContain(
      "实际输入 6",
    );
    expect(finalRows[1]?.find(".message-token-usage").text()).toContain(
      "思考 5",
    );
    expect(finalRows[1]?.find(".message-token-usage").text()).toContain("正文 7");
    expect(virtualizerMock.measureElement).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps historical rows free of the new-message animation", async () => {
    const wrapper = mountList(createLongConversation(4));
    await nextTick();

    expect(wrapper.find(".message-row").classes()).not.toContain(
      "message-row-new",
    );
    wrapper.unmount();
  });

  it("estimates larger rows for reasoning and markdown content", () => {
    const short = createLongConversation(2)[1];
    if (!short) {
      throw new Error("Expected an assistant test message");
    }
    const long = {
      ...short,
      content: short.content.repeat(8),
      reasoningContent: short.reasoningContent?.repeat(8) ?? "思考".repeat(8),
    };

    expect(estimateMessageSize(long)).toBeGreaterThan(
      estimateMessageSize(short),
    );
    expect(BOTTOM_THRESHOLD).toBe(96);
  });

  it("navigates to a user query through the virtualizer", async () => {
    virtualizerMock.scrollToIndex.mockClear();
    const wrapper = mountList(createLongConversation(12));
    await nextTick();

    await wrapper.find('[data-query-index="2"]').trigger("click");
    await nextTick();

    expect(virtualizerMock.scrollToIndex).toHaveBeenCalledWith(4, {
      align: "start",
      behavior: "auto",
    });
    expect(wrapper.emitted("follow-change")).toContainEqual([false]);
    wrapper.unmount();
  });
});
