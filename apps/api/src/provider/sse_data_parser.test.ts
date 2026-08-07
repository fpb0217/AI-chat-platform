import { describe, expect, it } from "vitest";
import { SseDataParser } from "./sse_data_parser.js";

describe("SseDataParser", () => {
  it("handles arbitrary chunk boundaries, CRLF, comments and multiline data", () => {
    const parser = new SseDataParser();
    const output = [
      ...parser.feed("\uFEFF: keep-alive\r\nda"),
      ...parser.feed("ta: {\"value\":\r\n"),
      ...parser.feed("data: 1}\r\n\r\ndata: [DO"),
      ...parser.feed("NE]\n\n"),
      ...parser.end(),
    ];

    expect(output).toEqual(['{"value":\n1}', "[DONE]"]);
  });

  it("dispatches the last data event when the stream has no trailing newline", () => {
    const parser = new SseDataParser();
    parser.feed("data: final");
    expect(parser.end()).toEqual(["final"]);
  });

  it("ignores comment-only event blocks", () => {
    const parser = new SseDataParser();
    expect(parser.feed(": keep-alive\n\n")).toEqual([]);
    expect(parser.end()).toEqual([]);
  });
});

