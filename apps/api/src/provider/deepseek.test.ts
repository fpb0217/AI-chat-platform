import {
  MAX_AUTOMATIC_TITLE_LENGTH,
  graphemeCount,
  normalizeTitleText,
  truncateGraphemes,
} from "@ai-chat/shared";
import { describe, expect, it, vi } from "vitest";
import { DeepSeekProvider } from "./deepseek.js";
import { ProviderError } from "./types.js";

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

describe("DeepSeekProvider", () => {
  it("separates reasoning from answer content and parses reasoning usage", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, _init) =>
      streamResponse([
        ': keep-alive\n\ndata: {"choices":[{"delta":{"reasoning_content":"先分析"},"finish_reason":null}]}\n',
        '\ndata: {"choices":[{"delta":{"reasoning_content":"再判断","content":"你"},"finish_reason":null}]}\n\n',
        '\ndata: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":null}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":9,"total_tokens":13,"completion_tokens_details":{"reasoning_tokens":7}}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new DeepSeekProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/",
      model: "deepseek-v4-flash",
      fetchImplementation,
    });

    const events = [];
    for await (const event of provider.streamChat(
      [{ role: "user", content: "你好" }],
      {
        reasoningLevel: "max",
        signal: new AbortController().signal,
      },
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "phase", phase: "reasoning" },
      { type: "reasoning_delta", text: "先分析" },
      { type: "reasoning_delta", text: "再判断" },
      { type: "phase", phase: "answer" },
      { type: "delta", text: "你" },
      { type: "delta", text: "好" },
      {
        type: "done",
        finishReason: "stop",
        usage: {
          promptTokens: 4,
          completionTokens: 9,
          totalTokens: 13,
          reasoningTokens: 7,
        },
      },
    ]);
    const call = fetchImplementation.mock.calls[0];
    expect(call).toBeDefined();
    const [url, request] = call as Parameters<typeof fetch>;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(request?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it.each([
    ["off", "disabled", undefined],
    ["low", "enabled", "low"],
    ["high", "enabled", "high"],
    ["max", "enabled", "max"],
  ] as const)(
    "maps %s to the exact DeepSeek reasoning parameters",
    async (reasoningLevel, thinkingType, reasoningEffort) => {
      const fetchImplementation = vi.fn<typeof fetch>(async () =>
        streamResponse(["data: [DONE]\n\n"]),
      );
      const provider = new DeepSeekProvider({
        apiKey: "sk-test",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        fetchImplementation,
      });

      for await (const _event of provider.streamChat(
        [{ role: "user", content: "test" }],
        {
          reasoningLevel,
          signal: new AbortController().signal,
        },
      )) {
        // Consume the stream so the request body can be asserted.
      }

      const call = fetchImplementation.mock.calls[0];
      expect(call).toBeDefined();
      const [, request] = call as Parameters<typeof fetch>;
      const body = JSON.parse(request?.body as string) as Record<
        string,
        unknown
      >;
      expect(body.thinking).toEqual({ type: thinkingType });
      expect(body.reasoning_effort).toBe(reasoningEffort);
    },
  );

  it("advertises model-specific reasoning capabilities", () => {
    const flash = new DeepSeekProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    const pro = new DeepSeekProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
    });

    expect(flash.reasoningLevels).toEqual(["off", "low", "high", "max"]);
    expect(pro.reasoningLevels).toEqual(["off", "high", "max"]);
  });

  it("maps upstream authentication errors without exposing response bodies", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "sk-invalid",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      fetchImplementation: vi.fn(
        async () => new Response("secret upstream detail", { status: 401 }),
      ),
    });

    let thrown: unknown;
    try {
      const stream = provider.streamChat(
        [{ role: "user", content: "test" }],
        {
          reasoningLevel: "off",
          signal: new AbortController().signal,
        },
      );
      await stream[Symbol.asyncIterator]().next();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderError);
    expect(thrown).toMatchObject({
      code: "INVALID_API_KEY",
      retryable: false,
      statusCode: 401,
    });
    expect((thrown as Error).message).not.toContain("secret upstream detail");
  });

  it("rejects a stream that closes without the DONE marker", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      fetchImplementation: vi.fn(async () =>
        streamResponse([
          'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
        ]),
      ),
    });

    const events = [];
    let thrown: unknown;
    try {
      for await (const event of provider.streamChat(
        [{ role: "user", content: "test" }],
        {
          reasoningLevel: "off",
          signal: new AbortController().signal,
        },
      )) {
        events.push(event);
      }
    } catch (error) {
      thrown = error;
    }

    expect(events).toEqual([
      { type: "phase", phase: "answer" },
      { type: "delta", text: "partial" },
    ]);
    expect(thrown).toMatchObject({ code: "UPSTREAM_STREAM_INTERRUPTED" });
  });

  it("generates a constrained automatic title with the required DeepSeek request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ message: { content: '{"title":"\\" SSE 与 SDK 对比 \\""}' } }],
      }),
    );
    const provider = new DeepSeekProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      fetchImplementation,
    });

    await expect(
      provider.generateTitle?.("如何比较 SSE 和 SDK", "请从可靠性与调试成本分析。"),
    ).resolves.toBe("SSE 与 SDK 对比");

    const [, request] = fetchImplementation.mock.calls[0] as Parameters<
      typeof fetch
    >;
    const body = JSON.parse(request?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      stream: false,
      response_format: { type: "json_object" },
      max_tokens: 96,
    });
    expect(body.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      {
        role: "user",
        content: JSON.stringify({
          question: "如何比较 SSE 和 SDK",
          answer: "请从可靠性与调试成本分析。",
        }),
      },
    ]);
  });

  it("preserves a semantically complete 31-grapheme comparison title", async () => {
    const expectedTitle = "claude code和codex在harness工程上的区别";
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [
          { message: { content: JSON.stringify({ title: expectedTitle }) } },
        ],
      }),
    );
    const provider = new DeepSeekProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      fetchImplementation,
    });

    await expect(
      provider.generateTitle?.(
        "结合用户体验，介绍一下claude code和codex在harness工程上的区别",
        "两者在代理编排、上下文管理和工程集成方式上存在差异。",
      ),
    ).resolves.toBe(expectedTitle);
  });

  it("falls back to a normalized question when title output is invalid or too long", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { content: "not-json" } }] }),
    );
    const provider = new DeepSeekProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      fetchImplementation,
    });

    const question = `  ${"很长的问题".repeat(12)}🙂🙂🙂  `;
    const title = await provider.generateTitle?.(question, "回答");
    expect(title).toBe(
      truncateGraphemes(
        normalizeTitleText(question),
        MAX_AUTOMATIC_TITLE_LENGTH,
      ),
    );
    expect(graphemeCount(title ?? "")).toBe(MAX_AUTOMATIC_TITLE_LENGTH);
  });
});
