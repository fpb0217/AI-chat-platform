import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { ChatMessage } from "@ai-chat/shared";
import { describe, expect, it } from "vitest";
import ReasoningPanel from "./ReasoningPanel.vue";

function createMessage(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: "assistant-1",
    conversationId: "default",
    turnId: "turn-1",
    position: 1,
    role: "assistant",
    content: "最终答案",
    reasoningContent: "先分析问题，再组织答案。",
    reasoningDurationMs: 1_500,
    status: "completed",
    model: "deepseek-v4-flash",
    reasoningLevel: "high",
    finishReason: "stop",
    usage: null,
    errorCode: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("ReasoningPanel", () => {
  it("opens while reasoning and collapses when the answer starts", async () => {
    const wrapper = mount(ReasoningPanel, {
      props: {
        message: createMessage({
          content: "",
          reasoningDurationMs: null,
          status: "streaming",
        }),
        active: true,
      },
    });
    const toggle = wrapper.get(".reasoning-toggle");

    expect(toggle.text()).toContain("正在思考");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".reasoning-body").isVisible()).toBe(true);

    await wrapper.setProps({
      active: false,
      message: createMessage({
        reasoningDurationMs: 1_500,
        status: "streaming",
      }),
    });

    expect(toggle.text()).toContain("已思考约 1.5 秒");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.get(".reasoning-body").attributes("style")).toContain(
      "display: none",
    );

    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".reasoning-body").isVisible()).toBe(true);
  });

  it("keeps historical reasoning collapsed until the user expands it", async () => {
    const wrapper = mount(ReasoningPanel, {
      props: { message: createMessage(), active: false },
    });
    const toggle = wrapper.get(".reasoning-toggle");

    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.attributes("aria-controls")).toBe(
      wrapper.get(".reasoning-body").attributes("id"),
    );

    await toggle.trigger("click");
    expect(wrapper.get(".reasoning-body").text()).toContain(
      "先分析问题，再组织答案。",
    );
  });

  it("describes a reasoning-only interruption and hides absent reasoning", () => {
    const stopped = mount(ReasoningPanel, {
      props: {
        message: createMessage({
          content: "",
          reasoningDurationMs: 600,
          status: "stopped",
        }),
        active: false,
      },
    });
    expect(stopped.get(".reasoning-toggle").text()).toContain("思考已停止");

    const absent = mount(ReasoningPanel, {
      props: {
        message: createMessage({ reasoningContent: null }),
        active: false,
      },
    });
    expect(absent.find(".reasoning-panel").exists()).toBe(false);
  });

  it("follows new reasoning until the user scrolls up, then resumes at the bottom", async () => {
    const streamingMessage = createMessage({
      content: "",
      reasoningContent: "第一段",
      reasoningDurationMs: null,
      status: "streaming",
    });
    const wrapper = mount(ReasoningPanel, {
      props: { message: streamingMessage, active: true },
    });
    const body = wrapper.get<HTMLElement>(".reasoning-body").element;
    let scrollHeight = 300;
    const clientHeight = 100;
    let scrollTop = 0;
    Object.defineProperties(body, {
      scrollHeight: {
        configurable: true,
        get: () => scrollHeight,
      },
      clientHeight: {
        configurable: true,
        get: () => clientHeight,
      },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(
            0,
            Math.min(value, scrollHeight - clientHeight),
          );
        },
      },
    });

    await wrapper.setProps({
      message: { ...streamingMessage, reasoningContent: "第一段\n\n第二段" },
    });
    await nextTick();
    expect(scrollTop).toBe(200);

    body.scrollTop = 100;
    await wrapper.get(".reasoning-body").trigger("scroll");
    scrollHeight = 500;
    await wrapper.setProps({
      message: {
        ...streamingMessage,
        reasoningContent: "第一段\n\n第二段\n\n第三段",
      },
    });
    await nextTick();
    expect(scrollTop).toBe(100);

    body.scrollTop = 400;
    await wrapper.get(".reasoning-body").trigger("scroll");
    scrollHeight = 600;
    await wrapper.setProps({
      message: {
        ...streamingMessage,
        reasoningContent: "第一段\n\n第二段\n\n第三段\n\n第四段",
      },
    });
    await nextTick();
    expect(scrollTop).toBe(500);
  });
});
