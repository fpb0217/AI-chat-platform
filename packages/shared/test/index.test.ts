import { describe, expect, it } from "vitest";
import {
  MAX_AUTOMATIC_TITLE_LENGTH,
  MAX_MANUAL_TITLE_LENGTH,
  REASONING_LEVELS,
  graphemeCount,
  renameConversationRequestSchema,
  sendMessageRequestSchema,
  truncateGraphemes,
} from "../src/index.js";

describe("sendMessageRequestSchema", () => {
  it("defaults an omitted reasoning level to off", () => {
    expect(sendMessageRequestSchema.parse({ content: "测试" })).toEqual({
      conversationId: null,
      content: "测试",
      reasoningLevel: "off",
    });
  });

  it.each(REASONING_LEVELS)("accepts the %s reasoning level", (level) => {
    expect(
      sendMessageRequestSchema.parse({ content: "测试", reasoningLevel: level }),
    ).toMatchObject({ reasoningLevel: level });
  });

  it.each(["medium", "xhigh", "turbo"])(
    "rejects the unsupported %s alias",
    (level) => {
      expect(
        sendMessageRequestSchema.safeParse({
          content: "测试",
          reasoningLevel: level,
        }).success,
      ).toBe(false);
    },
  );
});

describe("conversation contracts", () => {
  it("accepts null, default, and UUID-like conversation IDs but rejects blanks", () => {
    expect(
      sendMessageRequestSchema.parse({ content: "测试", conversationId: null }),
    ).toMatchObject({ conversationId: null });
    expect(
      sendMessageRequestSchema.parse({ content: "测试", conversationId: "default" }),
    ).toMatchObject({ conversationId: "default" });
    expect(
      sendMessageRequestSchema.safeParse({ content: "测试", conversationId: "   " })
        .success,
    ).toBe(false);
  });

  it("counts and truncates Unicode graphemes consistently", () => {
    const value = "中🙂e\u0301";
    const expectedTitle = "claude code和codex在harness工程上的区别";
    expect(graphemeCount(value)).toBe(3);
    expect(truncateGraphemes(value, 2)).toBe("中🙂");
    expect(graphemeCount(expectedTitle)).toBe(31);
    expect(truncateGraphemes(expectedTitle, MAX_AUTOMATIC_TITLE_LENGTH)).toBe(
      expectedTitle,
    );
    expect(truncateGraphemes("标题".repeat(20), MAX_AUTOMATIC_TITLE_LENGTH)).toHaveLength(
      40,
    );
  });

  it("keeps manual title validation separate from automatic title length", () => {
    expect(
      renameConversationRequestSchema.safeParse({
        title: "手动标题".repeat(16),
      }).success,
    ).toBe(false);
    expect(
      renameConversationRequestSchema.safeParse({
        title: "a".repeat(MAX_MANUAL_TITLE_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      renameConversationRequestSchema.safeParse({ title: "标题\n注入" }).success,
    ).toBe(false);
  });
});
