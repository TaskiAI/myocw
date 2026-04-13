"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import "./hljs-dark.css";

interface Props {
  children: string;
}

export default function MarkdownContent({ children }: Props) {
  return (
    <div className="prose prose-slate max-w-none dark:prose-invert prose-headings:font-light prose-headings:tracking-tight prose-p:leading-relaxed prose-pre:bg-[#F9F9F9] prose-pre:border prose-pre:border-[#E5E5E5] prose-pre:text-[#1A1A1A] dark:prose-pre:bg-zinc-800 dark:prose-pre:border-zinc-700 dark:prose-pre:text-zinc-100">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
