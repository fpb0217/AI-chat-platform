import { describe, expect, it } from "vitest";
import { SseEventParser } from "./sse";

describe("SseEventParser", () => {
  it("parses named events across chunks and ignores keep-alive comments", () => {
    const parser = new SseEventParser();
    const events = [
      ...parser.feed(": keep-alive\r\nevent: me"),
      ...parser.feed('ta\r\ndata: {"id":1}\r\n\r\nevent: delta\n'),
      ...parser.feed('data: {"text":"你"}\n\n'),
      ...parser.end(),
    ];

    expect(events).toEqual([
      { event: "meta", data: '{"id":1}' },
      { event: "delta", data: '{"text":"你"}' },
    ]);
  });

  it("joins multiline data fields", () => {
    const parser = new SseEventParser();
    expect(parser.feed("event: note\ndata: one\ndata: two\n\n")).toEqual([
      { event: "note", data: "one\ntwo" },
    ]);
  });
});

