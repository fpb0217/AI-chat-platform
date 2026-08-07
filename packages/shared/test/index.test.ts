import { describe, expect, it } from "vitest";
import {
  REASONING_LEVELS,
  sendMessageRequestSchema,
} from "../src/index.js";

describe("sendMessageRequestSchema", () => {
  it("defaults an omitted reasoning level to off", () => {
    expect(sendMessageRequestSchema.parse({ content: "测试" })).toEqual({
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
