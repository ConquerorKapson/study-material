import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import Mermaid from "./Mermaid";

export default function MarkdownRenderer({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeSlug,
        [
          rehypeAutolinkHeadings,
          {
            behavior: "append",
            properties: { className: ["anchor"], ariaHidden: true, tabIndex: -1 },
            content: { type: "text", value: "#" },
          },
        ],
        rehypeKatex,
        rehypeHighlight,
      ]}
      components={{
        code(props) {
          const { className, children, ...rest } = props as {
            className?: string;
            children?: React.ReactNode;
          };
          const match = /language-(\w+)/.exec(className || "");
          const lang = match?.[1];
          if (lang === "mermaid") {
            return <Mermaid chart={String(children).trim()} />;
          }
          return (
            <code className={className} {...rest}>
              {children}
            </code>
          );
        },
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
