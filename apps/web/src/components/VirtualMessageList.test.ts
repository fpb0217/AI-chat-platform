import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { RenderedChatMessage } from "../composables/use_chat";
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
      },
    };
  },
}));

function mountList(messages: RenderedChatMessage[]) {
  return mount(VirtualMessageList, {
    props: {
      messages,
      streamState: "idle",
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
});
