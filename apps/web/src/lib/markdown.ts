import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

const ASTERISK = 0x2a;

function codePointBefore(value: string, index: number): number | undefined {
  if (index <= 0) {
    return undefined;
  }

  const lastCodeUnit = value.charCodeAt(index - 1);
  if (lastCodeUnit < 0xdc00 || lastCodeUnit > 0xdfff || index < 2) {
    return lastCodeUnit;
  }

  const firstCodeUnit = value.charCodeAt(index - 2);
  if (firstCodeUnit < 0xd800 || firstCodeUnit > 0xdbff) {
    return lastCodeUnit;
  }

  return (
    0x10000 +
    ((firstCodeUnit - 0xd800) << 10) +
    (lastCodeUnit - 0xdc00)
  );
}

function isPunctuation(
  markdown: MarkdownIt,
  codePoint: number | undefined,
): boolean {
  return (
    codePoint !== undefined &&
    (markdown.utils.isMdAsciiPunct(codePoint) ||
      markdown.utils.isPunctChar(String.fromCodePoint(codePoint)))
  );
}

function punctuationFriendlyEmphasis(markdown: MarkdownIt): void {
  const DefaultInlineState = markdown.inline.State;

  markdown.inline.State = class PunctuationFriendlyInlineState extends DefaultInlineState {
    override scanDelims(start: number, canSplitWord: boolean) {
      const scanned = super.scanDelims(start, canSplitWord);
      const marker = this.src.charCodeAt(start);

      // CommonMark rejects an opening run before punctuation when it immediately
      // follows prose, and a closing run after punctuation when prose follows it.
      // LLM output commonly wraps quoted CJK phrases as `正文**“重点”**正文`.
      // Relax only those boundary decisions for strong asterisk runs; Markdown-it
      // still owns delimiter tokenization, pairing, nesting and unmatched runs.
      if (marker === ASTERISK && scanned.length >= 2) {
        const previousCodePoint = codePointBefore(this.src, start);
        const nextCodePoint = this.src.codePointAt(start + scanned.length);

        if (!scanned.can_open && isPunctuation(markdown, nextCodePoint)) {
          scanned.can_open = true;
        }
        if (!scanned.can_close && isPunctuation(markdown, previousCodePoint)) {
          scanned.can_close = true;
        }
      }

      return scanned;
    }
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

markdown.use(punctuationFriendlyEmphasis);
markdown.use(taskLists, { enabled: true, label: true, labelAfter: true });

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _environment, renderer) =>
    renderer.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (
  tokens,
  index,
  options,
  environment,
  renderer,
) => {
  tokens[index]?.attrSet("target", "_blank");
  tokens[index]?.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, index, options, environment, renderer);
};

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  if (!token) {
    return "";
  }
  const language = token.info.trim().split(/\s+/u)[0] ?? "";
  const highlighted =
    language && hljs.getLanguage(language)
      ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value
      : escapeHtml(token.content);
  const label = language || "text";

  return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(label)}</span><button type="button" data-copy-code aria-label="复制代码">复制</button></div><pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`;
};

export function renderMarkdown(content: string): string {
  return DOMPurify.sanitize(markdown.render(content), {
    ADD_ATTR: ["target", "rel", "data-copy-code"],
  });
}

