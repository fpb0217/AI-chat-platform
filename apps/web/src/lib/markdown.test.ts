import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders GFM tables, task lists and highlighted code with a copy control", () => {
    const html = renderMarkdown(
      "- [x] 完成\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst value = 1\n```",
    );
    expect(html).toContain("task-list-item");
    expect(html).toContain("<table>");
    expect(html).toContain("data-copy-code");
    expect(html).toContain("hljs");
  });

  it("does not permit executable HTML or unsafe links", () => {
    const html = renderMarkdown(
      '<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(1))',
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<script");
  });
});

