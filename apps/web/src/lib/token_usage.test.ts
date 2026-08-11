import type { ChatMessage, TokenUsage } from "@ai-chat/shared";
import { describe, expect, it } from "vitest";
import {
  createTurnTokenDisplays,
  isValidTokenUsage,
} from "./token_usage";

const validUsage: TokenUsage = {
  promptTokens: 1_234,
  completionTokens: 568,
  totalTokens: 1_802,
  reasoningTokens: null,
};

function message(
  role: ChatMessage["role"],
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `${role}-id`,
    conversationId: "conversation-1",
    turnId: "turn-1",
    position: role === "user" ? 0 : 1,
    role,
    content: "",
    reasoningContent: null,
    reasoningDurationMs: null,
    status: "completed",
    model: role === "assistant" ? "deepseek-v4-flash" : null,
    reasoningLevel: role === "assistant" ? "off" : null,
    finishReason: "stop",
    usage: role === "assistant" ? validUsage : null,
    errorCode: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("token usage display derivation", () => {
  it("projects a unique assistant prompt count onto its user and shows a non-thinking answer", () => {
    const displays = createTurnTokenDisplays([
      message("user"),
      message("assistant"),
    ]);

    expect(displays).toEqual([
      {
        inputTokens: 1_234,
        reasoningTokens: null,
        answerTokens: 568,
        thinkingUsed: false,
        state: "available",
      },
      {
        inputTokens: 1_234,
        reasoningTokens: null,
        answerTokens: 568,
        thinkingUsed: false,
        state: "available",
      },
    ]);
  });

  it("matches a unique turn by id rather than message order", () => {
    const displays = createTurnTokenDisplays([
      message("assistant", { position: 1 }),
      message("user", { position: 0 }),
    ]);

    expect(displays[0]).toMatchObject({
      inputTokens: 1_234,
      answerTokens: 568,
      state: "available",
    });
    expect(displays[1]).toMatchObject({
      inputTokens: 1_234,
      answerTokens: 568,
      state: "available",
    });
  });

  it("splits thinking and answer tokens, including a valid zero", () => {
    const thinkingUsage: TokenUsage = {
      promptTokens: 6,
      completionTokens: 12,
      totalTokens: 18,
      reasoningTokens: 5,
    };
    const zeroReasoningUsage: TokenUsage = {
      ...thinkingUsage,
      reasoningTokens: 0,
    };
    const displays = createTurnTokenDisplays([
      message("assistant", { reasoningLevel: "high", usage: thinkingUsage }),
      message("assistant", {
        id: "assistant-zero",
        turnId: "turn-2",
        reasoningLevel: "max",
        usage: zeroReasoningUsage,
      }),
    ]);

    expect(displays[0]).toMatchObject({
      inputTokens: 6,
      reasoningTokens: 5,
      answerTokens: 7,
      thinkingUsed: true,
      state: "available",
    });
    expect(displays[1]).toMatchObject({
      reasoningTokens: 0,
      answerTokens: 12,
      thinkingUsed: true,
      state: "available",
    });
  });

  it("does not label all completion tokens as body tokens when a thinking split is missing", () => {
    const displays = createTurnTokenDisplays([
      message("user"),
      message("assistant", {
        reasoningLevel: "high",
        usage: { ...validUsage, reasoningTokens: null },
      }),
    ]);

    expect(displays[0]).toMatchObject({
      inputTokens: 1_234,
      state: "unavailable",
    });
    expect(displays[1]).toEqual({
      inputTokens: 1_234,
      reasoningTokens: null,
      answerTokens: null,
      thinkingUsed: true,
      state: "unavailable",
    });
  });

  it("deducts unexpected upstream reasoning tokens without rendering a thinking item for off mode", () => {
    const displays = createTurnTokenDisplays([
      message("assistant", {
        usage: {
          promptTokens: 6,
          completionTokens: 12,
          totalTokens: 18,
          reasoningTokens: 5,
        },
      }),
    ]);

    expect(displays[0]).toMatchObject({
      reasoningTokens: null,
      answerTokens: 7,
      thinkingUsed: false,
      state: "available",
    });
  });

  it("uses conservative legacy reasoning detection", () => {
    const displays = createTurnTokenDisplays([
      message("assistant", {
        reasoningLevel: null,
        reasoningContent: "旧消息中的思考内容",
        usage: { ...validUsage, reasoningTokens: 8 },
      }),
      message("assistant", {
        id: "unknown-legacy",
        turnId: "turn-2",
        reasoningLevel: null,
        usage: validUsage,
      }),
    ]);

    expect(displays[0]).toMatchObject({
      reasoningTokens: 8,
      answerTokens: 560,
      thinkingUsed: true,
      state: "available",
    });
    expect(displays[1]).toEqual({
      inputTokens: 1_234,
      reasoningTokens: null,
      answerTokens: null,
      thinkingUsed: false,
      state: "unavailable",
    });
  });

  it("keeps streaming turns pending and refuses missing, duplicate, and empty turn pairings", () => {
    const streaming = message("assistant", {
      status: "streaming",
      reasoningLevel: "high",
      usage: null,
    });
    const duplicateUser = message("user", { id: "second-user" });
    const emptyTurnUser = message("user", { id: "empty-turn", turnId: " " });
    const missingAssistantUser = message("user", {
      id: "missing-assistant",
      turnId: "missing-turn",
    });
    const displays = createTurnTokenDisplays([
      message("user"),
      streaming,
      duplicateUser,
      emptyTurnUser,
      missingAssistantUser,
    ]);

    expect(displays[0]).toMatchObject({ state: "unavailable" });
    expect(displays[1]).toEqual({
      inputTokens: null,
      reasoningTokens: null,
      answerTokens: null,
      thinkingUsed: true,
      state: "pending",
    });
    expect(displays[2]).toMatchObject({ state: "unavailable" });
    expect(displays[3]).toMatchObject({ state: "unavailable" });
    expect(displays[4]).toMatchObject({ state: "unavailable" });
  });

  it.each([
    { ...validUsage, promptTokens: -1 },
    { ...validUsage, completionTokens: 1.5 },
    { ...validUsage, totalTokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...validUsage, totalTokens: 1_801 },
    { ...validUsage, reasoningTokens: 569 },
    { ...validUsage, promptTokens: "1234" },
  ])("rejects malformed usage %#", (usage) => {
    expect(isValidTokenUsage(usage)).toBe(false);
  });
});
