import { createElement as h } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function normalizeMarkdown(content) {
  return content
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(/\\(\*{1,2})(?=\S)(.+?)\\\1(?=\s|$|[.,!?;:])/g, "$1$2$1")
        .replace(/\n{3,}/g, "\n\n");
    })
    .join("");
}

const components = {
  code: ({ className, children }) =>
    h(
      "code",
      { className: className ? "markdown-code" : "markdown-inline-code" },
      children
    ),
  pre: ({ children }) =>
    h("pre", { className: "markdown-code-block" }, children),
  table: ({ children }) =>
    h(
      "div",
      { className: "markdown-table-wrap" },
      h("table", null, children)
    ),
};

export default function ChatMarkdown({ content }) {
  return h(
    ReactMarkdown,
    {
      remarkPlugins: [remarkGfm],
      components,
    },
    normalizeMarkdown(content)
  );
}

export { normalizeMarkdown };
