import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import { createLongConversation } from "../test/long_conversation";
import QueryScrollNavigator from "./QueryScrollNavigator.vue";
import {
  QUERY_NAVIGATOR_WHEEL_THRESHOLD,
  activeQueryIndexForMessage,
  answerPreview,
  createCenteredQueryWindow,
  createQueryNavigationItems,
  isQueryIndexInCenteredWindow,
  normalizePreviewText,
} from "./query_scroll_navigator";

const messages = createLongConversation(12, "query-navigator");
const items = createQueryNavigationItems(messages);

function mountNavigator(
  activeIndex: number | null = 0,
  navigatorItems = items,
) {
  return mount(QueryScrollNavigator, {
    props: {
      items: navigatorItems,
      activeIndex,
      streamState: "idle",
      navigationKey: "query-navigator-conversation",
    },
  });
}

function visibleIndices(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll("[data-query-visible-index]")
    .map((item) => item.attributes("data-query-index") ?? "");
}

describe("query scroll navigator helpers", () => {
  it("projects user messages and pairs assistants by turn ID", () => {
    expect(items).toHaveLength(6);
    expect(items[0]).toMatchObject({
      key: "query-navigator-render-0",
      messageIndex: 0,
      turnId: "query-navigator-turn-0",
      assistantMessage: {
        renderKey: "query-navigator-render-1",
      },
    });
    expect(items[3]?.messageIndex).toBe(6);
    expect(items[3]?.assistantMessage?.renderKey).toBe(
      "query-navigator-render-7",
    );
  });

  it("normalizes Markdown previews and keeps reasoning out of answer text", () => {
    expect(
      normalizePreviewText(
        "## 标题\n\n[链接](https://example.test)\n\n- `行内代码`\n\n```ts\nconst sample = 1;\n```",
      ),
    ).toBe("标题 链接 行内代码 const sample = 1;");

    const first = items[0];
    if (!first) {
      throw new Error("Expected the first query navigation item");
    }
    expect(answerPreview(first, "idle")).not.toContain("思考过程");
  });

  it("uses status-aware fallback text when an answer is unavailable", () => {
    const first = items[0];
    if (!first) {
      throw new Error("Expected the first query navigation item");
    }
    const streaming = {
      ...first,
      assistantMessage: first.assistantMessage
        ? { ...first.assistantMessage, content: "", status: "streaming" as const }
        : null,
    };
    const stopped = {
      ...first,
      assistantMessage: first.assistantMessage
        ? { ...first.assistantMessage, content: "", status: "stopped" as const }
        : null,
    };

    expect(answerPreview(streaming, "streaming")).toBe("正在生成回答…");
    expect(answerPreview(stopped, "idle")).toBe("回答已停止");
  });

  it("builds a centered five-slot window with one buffered item on each side", () => {
    const centered = createCenteredQueryWindow(4, 9);

    expect(centered).toMatchObject({
      centerIndex: 4,
      visibleStart: 2,
      visibleEnd: 6,
      bufferedStart: 1,
      bufferedEnd: 7,
      indices: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(isQueryIndexInCenteredWindow(2, centered)).toBe(true);
    expect(isQueryIndexInCenteredWindow(1, centered)).toBe(false);

    const atStart = createCenteredQueryWindow(0, 9);
    expect(atStart).toMatchObject({
      centerIndex: 0,
      visibleStart: -2,
      visibleEnd: 2,
      indices: [0, 1, 2, 3],
    });
  });

  it("finds the current query from the visible message index", () => {
    expect(activeQueryIndexForMessage(items, null)).toBe(0);
    expect(activeQueryIndexForMessage(items, 0)).toBe(0);
    expect(activeQueryIndexForMessage(items, 1)).toBe(0);
    expect(activeQueryIndexForMessage(items, 6)).toBe(3);
    expect(activeQueryIndexForMessage(items, 11)).toBe(5);
  });
});

describe("QueryScrollNavigator", () => {
  it("centers the current query and renders only five complete slots", () => {
    const nineItems = createQueryNavigationItems(
      createLongConversation(18, "nine-query-navigator"),
    );
    const wrapper = mountNavigator(4, nineItems);

    expect(visibleIndices(wrapper)).toEqual(["2", "3", "4", "5", "6"]);
    expect(
      wrapper.findAll("[data-query-index]").map((item) =>
        item.attributes("data-query-index"),
      ),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(
      wrapper.find('[aria-current="location"]').attributes("data-query-index"),
    ).toBe("4");
    expect(
      wrapper.find('[aria-current="location"]').attributes("data-query-slot"),
    ).toBe("2");
    expect(wrapper.find("[data-query-center-marker]").exists()).toBe(true);
    expect(
      wrapper.find('[data-query-buffer="above"]').attributes("data-query-index"),
    ).toBe("1");
    expect(
      wrapper.find('[data-query-buffer="below"]').attributes("data-query-index"),
    ).toBe("7");
    wrapper.unmount();
  });

  it("moves a buffered bar in from the top during an upward gesture", async () => {
    const nineItems = createQueryNavigationItems(
      createLongConversation(18, "nine-query-navigator"),
    );
    const wrapper = mountNavigator(4, nineItems);
    const navigator = wrapper.find("[data-query-navigator]");

    await navigator.trigger("wheel", { deltaY: -10 });
    await nextTick();
    expect(wrapper.find("[data-query-rail]").attributes("data-query-rail-offset")).toBe(
      "4",
    );
    expect(
      wrapper.find('[aria-current="location"]').attributes("data-query-index"),
    ).toBe("4");

    await navigator.trigger("wheel", { deltaY: -30 });
    await nextTick();
    expect(visibleIndices(wrapper)).toEqual(["1", "2", "3", "4", "5"]);
    expect(
      wrapper.find('[aria-current="location"]').attributes("data-query-index"),
    ).toBe("3");
    expect(
      wrapper.find('[aria-current="location"]').attributes("data-query-slot"),
    ).toBe("2");
    wrapper.unmount();
  });

  it("moves a buffered bar in from the bottom during a downward gesture", async () => {
    const nineItems = createQueryNavigationItems(
      createLongConversation(18, "nine-query-navigator"),
    );
    const wrapper = mountNavigator(4, nineItems);
    const navigator = wrapper.find("[data-query-navigator]");

    await navigator.trigger("wheel", { deltaY: 10 });
    await nextTick();
    expect(wrapper.find("[data-query-rail]").attributes("data-query-rail-offset")).toBe(
      "-4",
    );

    await navigator.trigger("wheel", { deltaY: 30 });
    await nextTick();
    expect(visibleIndices(wrapper)).toEqual(["3", "4", "5", "6", "7"]);
    expect(
      wrapper.find('[aria-current="location"]').attributes("data-query-index"),
    ).toBe("5");
    expect(
      wrapper.find('[aria-current="location"]').attributes("data-query-slot"),
    ).toBe("2");
    expect(wrapper.find("[data-query-preview]").text()).toContain("问题 10");
    wrapper.unmount();
  });

  it("keeps the first and last queries centered without fake bars", () => {
    const nineItems = createQueryNavigationItems(
      createLongConversation(18, "nine-query-navigator"),
    );
    const first = mountNavigator(0, nineItems);

    expect(visibleIndices(first)).toEqual(["0", "1", "2"]);
    expect(
      first.find('[aria-current="location"]').attributes("data-query-slot"),
    ).toBe("2");
    expect(first.find('[data-query-buffer="above"]').exists()).toBe(false);
    first.unmount();

    const last = mountNavigator(8, nineItems);
    expect(visibleIndices(last)).toEqual(["6", "7", "8"]);
    expect(
      last.find('[aria-current="location"]').attributes("data-query-slot"),
    ).toBe("2");
    expect(last.find('[data-query-buffer="below"]').exists()).toBe(false);
    last.unmount();
  });

  it("shows the one-line and three-line preview and emits the target index", async () => {
    const wrapper = mountNavigator();
    const target = wrapper.find('[data-query-index="2"]');

    await target.trigger("pointerenter");
    expect(wrapper.find("[data-query-preview]").text()).toContain("问题 4");
    expect(wrapper.find(".query-scroll-navigator-preview-query").exists()).toBe(
      true,
    );
    expect(wrapper.find(".query-scroll-navigator-preview-answer").exists()).toBe(
      true,
    );

    await target.trigger("click");
    expect(wrapper.emitted("navigate")).toEqual([[4]]);
    wrapper.unmount();
  });

  it("advances the browsing cursor by one query for a discrete wheel step", async () => {
    const wrapper = mountNavigator();

    await wrapper
      .find("[data-query-navigator]")
      .trigger("wheel", { deltaY: QUERY_NAVIGATOR_WHEEL_THRESHOLD });
    await nextTick();

    expect(
      wrapper.find('[aria-current="location"]').attributes("data-query-index"),
    ).toBe("1");
    expect(wrapper.find("[data-query-preview]").text()).toContain("问题 2");
    expect(wrapper.emitted("navigate")).toBeUndefined();
    wrapper.unmount();
  });
});
