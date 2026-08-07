import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

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

