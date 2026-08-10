import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findWorkspaceRoot } from "../config.js";
import { createDatabase, type DatabaseHandle } from "./client.js";
import {
  ActiveConversationGenerationError,
  ChatRepository,
} from "./repository.js";

describe("ChatRepository", () => {
  let database: DatabaseHandle;
  let repository: ChatRepository;

  beforeEach(() => {
    database = createDatabase(
      ":memory:",
      resolve(findWorkspaceRoot(), "apps/api/drizzle"),
    );
    repository = new ChatRepository(database);
    repository.ensureDefaultConversation();
  });

  afterEach(() => {
    database.close();
  });

  it("stores a turn in deterministic order and finalizes usage", () => {
    const turn = repository.beginTurn("第一问", "deepseek-v4-flash", "high");
    expect(repository.getModelHistory()).toEqual([
      { role: "user", content: "第一问" },
    ]);

    repository.finalizeAssistant(turn.assistantMessage.id, {
      content: "第一答",
      reasoningContent: "先分析，再得出第一答。",
      reasoningDurationMs: 1_250,
      status: "completed",
      finishReason: "stop",
      usage: {
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
        reasoningTokens: 1,
      },
      errorCode: null,
    });

    const chat = repository.getChat();
    expect(chat.messages.map((message) => message.position)).toEqual([0, 1]);
    expect(chat.messages[1]).toMatchObject({
      content: "第一答",
      reasoningContent: "先分析，再得出第一答。",
      reasoningDurationMs: 1_250,
      status: "completed",
      reasoningLevel: "high",
      finishReason: "stop",
      usage: {
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
        reasoningTokens: 1,
      },
    });
    expect(repository.getModelHistory()).toEqual([
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
    ]);
  });

  it("excludes empty failed turns but retains partial stopped answers", () => {
    const failed = repository.beginTurn(
      "失败的问题",
      "deepseek-v4-flash",
      "off",
    );
    repository.finalizeAssistant(failed.assistantMessage.id, {
      content: "",
      reasoningContent: null,
      reasoningDurationMs: null,
      status: "error",
      finishReason: null,
      usage: null,
      errorCode: "UPSTREAM_UNAVAILABLE",
    });
    const stopped = repository.beginTurn(
      "被停止的问题",
      "deepseek-v4-flash",
      "max",
    );
    repository.finalizeAssistant(stopped.assistantMessage.id, {
      content: "部分回答",
      reasoningContent: "部分思考",
      reasoningDurationMs: 800,
      status: "stopped",
      finishReason: null,
      usage: null,
      errorCode: null,
    });

    expect(repository.getChat().messages.at(-1)).toMatchObject({
      content: "部分回答",
      reasoningContent: "部分思考",
      reasoningDurationMs: 800,
      status: "stopped",
    });

    expect(repository.getModelHistory()).toEqual([
      { role: "user", content: "被停止的问题" },
      { role: "assistant", content: "部分回答" },
    ]);
  });

  it("marks orphaned streaming rows as stopped on startup", () => {
    repository.beginTurn("进行中", "deepseek-v4-flash", "low");
    repository.markInterruptedMessages();
    expect(repository.getChat().messages.at(-1)).toMatchObject({
      status: "stopped",
      errorCode: "UPSTREAM_STREAM_INTERRUPTED",
    });
  });

  it("creates a new conversation and lists it only after its first turn", () => {
    expect(repository.listConversations()).toEqual([]);

    const turn = repository.beginTurn(null, "新的会话问题", "deepseek-v4-flash", "off");
    expect(turn.userMessage.conversationId).not.toBe("default");
    expect(repository.listConversations()).toMatchObject([
      {
        id: turn.userMessage.conversationId,
        title: "新对话",
        titleSource: "auto",
      },
    ]);

    const detail = repository.getConversation(turn.userMessage.conversationId);
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[0]?.content).toBe("新的会话问题");
  });

  it("keeps model history and positions isolated between conversations", () => {
    const first = repository.beginTurn(null, "会话一的问题", "deepseek-v4-flash", "off");
    repository.finalizeAssistant(first.assistantMessage.id, {
      content: "会话一的回答",
      reasoningContent: null,
      reasoningDurationMs: null,
      status: "completed",
      finishReason: "stop",
      usage: null,
      errorCode: null,
    });
    const second = repository.beginTurn(null, "会话二的问题", "deepseek-v4-flash", "off");
    repository.finalizeAssistant(second.assistantMessage.id, {
      content: "会话二的回答",
      reasoningContent: null,
      reasoningDurationMs: null,
      status: "completed",
      finishReason: "stop",
      usage: null,
      errorCode: null,
    });

    expect(repository.getModelHistory(first.userMessage.conversationId)).toEqual([
      { role: "user", content: "会话一的问题" },
      { role: "assistant", content: "会话一的回答" },
    ]);
    expect(repository.getModelHistory(second.userMessage.conversationId)).toEqual([
      { role: "user", content: "会话二的问题" },
      { role: "assistant", content: "会话二的回答" },
    ]);
    expect(
      repository
        .getConversation(first.userMessage.conversationId)
        ?.messages.map((message) => message.position),
    ).toEqual([0, 1]);
  });

  it("protects automatic titles from stale turns and manual renames", () => {
    const turn = repository.beginTurn(null, "如何设计会话管理", "deepseek-v4-flash", "off");
    repository.finalizeAssistant(turn.assistantMessage.id, {
      content: "可以从数据模型、接口和前端状态三个方面设计。",
      reasoningContent: null,
      reasoningDurationMs: null,
      status: "completed",
      finishReason: "stop",
      usage: null,
      errorCode: null,
    });
    const id = turn.userMessage.conversationId;

    expect(repository.applyAutomaticTitle(id, "stale-turn", "过期标题")).toMatchObject({
      title: "新对话",
      titleSource: "auto",
    });
    expect(repository.applyAutomaticTitle(id, turn.userMessage.turnId, "会话设计")).toMatchObject({
      title: "会话设计",
      titleSource: "auto",
    });
    expect(repository.applyAutomaticTitle(id, turn.userMessage.turnId, "重复标题")).toMatchObject({
      title: "会话设计",
      titleSource: "auto",
    });

    expect(repository.renameConversation(id, "我的重要会话")).toMatchObject({
      title: "我的重要会话",
      titleSource: "manual",
    });
    expect(repository.applyAutomaticTitle(id, turn.userMessage.turnId, "不应覆盖")).toMatchObject({
      title: "我的重要会话",
      titleSource: "manual",
    });
  });

  it("cascades messages on delete and rejects an active conversation", () => {
    const active = repository.beginTurn(null, "正在生成", "deepseek-v4-flash", "off");
    expect(() => repository.deleteConversation(active.userMessage.conversationId)).toThrow(
      ActiveConversationGenerationError,
    );
    repository.finalizeAssistant(active.assistantMessage.id, {
      content: "完成",
      reasoningContent: null,
      reasoningDurationMs: null,
      status: "completed",
      finishReason: "stop",
      usage: null,
      errorCode: null,
    });
    repository.deleteConversation(active.userMessage.conversationId);
    expect(repository.getConversation(active.userMessage.conversationId)).toBeNull();
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?")
        .get(active.userMessage.conversationId),
    ).toMatchObject({ count: 0 });
  });
});
