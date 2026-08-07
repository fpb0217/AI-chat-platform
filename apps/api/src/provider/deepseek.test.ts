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
  it("sends the fixed non-thinking request and parses deltas plus usage", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, _init) =>
      streamResponse([
        ': keep-alive\n\ndata: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n',
        '\ndata: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":null}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
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
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "delta", text: "你" },
      { type: "delta", text: "好" },
      {
        type: "done",
        finishReason: "stop",
        usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
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
      thinking: { type: "disabled" },
      stream: true,
      stream_options: { include_usage: true },
    });
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
        new AbortController().signal,
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
        new AbortController().signal,
      )) {
        events.push(event);
      }
    } catch (error) {
      thrown = error;
    }

    expect(events).toEqual([{ type: "delta", text: "partial" }]);
    expect(thrown).toMatchObject({ code: "UPSTREAM_STREAM_INTERRUPTED" });
  });
});
