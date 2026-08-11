import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MessageTokenUsage from "./MessageTokenUsage.vue";

describe("MessageTokenUsage", () => {
  it("formats actual input counts and explains what they include", () => {
    const wrapper = mount(MessageTokenUsage, {
      props: {
        role: "user",
        display: {
          inputTokens: 1_234,
          reasoningTokens: null,
          answerTokens: 568,
          thinkingUsed: false,
          state: "available",
        },
      },
    });

    expect(wrapper.text()).toContain("实际输入 1,234");
    expect(wrapper.find(".message-token-metric").attributes("title")).toBe(
      "包含历史上下文与模型输入开销",
    );
  });

  it("renders thinking zero distinctly from an unavailable count", () => {
    const wrapper = mount(MessageTokenUsage, {
      props: {
        role: "assistant",
        display: {
          inputTokens: 6,
          reasoningTokens: 0,
          answerTokens: 12,
          thinkingUsed: true,
          state: "available",
        },
      },
    });

    expect(wrapper.text()).toContain("思考 0");
    expect(wrapper.text()).toContain("正文 12");
    expect(wrapper.text()).not.toContain("—");
  });

  it("uses pending and unavailable copy without a live region", async () => {
    const wrapper = mount(MessageTokenUsage, {
      props: {
        role: "assistant",
        display: {
          inputTokens: null,
          reasoningTokens: null,
          answerTokens: null,
          thinkingUsed: true,
          state: "pending",
        },
      },
    });

    expect(wrapper.text()).toContain("思考 计算中…");
    expect(wrapper.text()).toContain("正文 计算中…");
    expect(wrapper.attributes("aria-live")).toBeUndefined();

    await wrapper.setProps({
      display: {
        inputTokens: null,
        reasoningTokens: null,
        answerTokens: null,
        thinkingUsed: true,
        state: "unavailable",
      },
    });

    expect(wrapper.text()).toContain("思考 —");
    expect(wrapper.text()).toContain("正文 —");
    expect(wrapper.find(".sr-only").text()).toBe("本次请求未返回 Token 用量");
  });

  it("keeps a verified input count available when only the thinking split is missing", () => {
    const wrapper = mount(MessageTokenUsage, {
      props: {
        role: "user",
        display: {
          inputTokens: 6,
          reasoningTokens: null,
          answerTokens: null,
          thinkingUsed: true,
          state: "unavailable",
        },
      },
    });

    expect(wrapper.text()).toContain("实际输入 6");
    expect(wrapper.attributes("data-token-state")).toBe("available");
    expect(wrapper.find(".sr-only").exists()).toBe(false);
  });
});
