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

  it("renders strong emphasis that starts and ends with punctuation in prose", () => {
    const html = renderMarkdown(
      "陶喆是华语乐坛的**“R&B教父”**，**是一位集歌手、词曲创作人与音乐制作人于一体的音乐人**。",
    );

    expect(html).toContain("<strong>“R&amp;B教父”</strong>");
    expect(html).toContain(
      "<strong>是一位集歌手、词曲创作人与音乐制作人于一体的音乐人</strong>",
    );
    expect(html).not.toContain("**");
  });

  it("does not rewrite punctuation-like strong markers inside code or when unclosed", () => {
    const html = renderMarkdown(
      "这首歌是专辑中**“最诚实、最贴近陶喆内心”**的作品。\n\n代码：`文字**“原样”**`\n\n未闭合：**“原样",
    );

    expect(html).toContain(
      "<strong>“最诚实、最贴近陶喆内心”</strong>",
    );
    expect(html).toContain("<code>文字**“原样”**</code>");
    expect(html).toContain("未闭合：**“原样");
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

