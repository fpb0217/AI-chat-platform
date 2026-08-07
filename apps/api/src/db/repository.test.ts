import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findWorkspaceRoot } from "../config.js";
import { createDatabase, type DatabaseHandle } from "./client.js";
import { ChatRepository } from "./repository.js";

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
      status: "stopped",
      finishReason: null,
      usage: null,
      errorCode: null,
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
});
