import { describe, expect, it } from "vitest";
import {
  speedForBacklog,
  splitGraphemes,
  TypewriterBuffer,
  type FrameScheduler,
} from "./typewriter";

class ManualScheduler implements FrameScheduler {
  private currentTime = 0;
  private nextId = 1;
  private callbacks = new Map<number, (timestamp: number) => void>();

  now(): number {
    return this.currentTime;
  }

  request(callback: (timestamp: number) => void): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    this.callbacks.delete(id);
  }

  advance(milliseconds: number): void {
    this.currentTime += milliseconds;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) {
      callback(this.currentTime);
    }
  }
}

describe("typewriter", () => {
  it("segments emoji and combining characters without splitting graphemes", () => {
    expect(splitGraphemes("A👩‍💻é中")).toEqual(["A", "👩‍💻", "é", "中"]);
  });

  it("adapts speed between the configured lower and upper bounds", () => {
    expect(speedForBacklog(1)).toBe(48);
    expect(speedForBacklog(240)).toBe(240);
    expect(speedForBacklog(100)).toBeGreaterThan(48);
    expect(speedForBacklog(100)).toBeLessThan(240);
  });

  it("emits incrementally and drains all buffered graphemes by the deadline", async () => {
    const scheduler = new ManualScheduler();
    let output = "";
    const writer = new TypewriterBuffer((text) => {
      output += text;
    }, scheduler);

    writer.push("A👩‍💻中文测试");
    scheduler.advance(20);
    expect(output.length).toBeLessThan("A👩‍💻中文测试".length);

    const finished = writer.finish(300);
    for (let elapsed = 0; elapsed < 300; elapsed += 30) {
      scheduler.advance(30);
    }
    await finished;
    expect(output).toBe("A👩‍💻中文测试");
  });

  it("flushes pending text immediately when generation is stopped", () => {
    const scheduler = new ManualScheduler();
    let output = "";
    const writer = new TypewriterBuffer((text) => {
      output += text;
    }, scheduler);
    writer.push("保留部分回答");
    writer.flush();
    expect(output).toBe("保留部分回答");
  });
});

