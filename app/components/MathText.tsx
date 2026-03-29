"use client";

import type { ReactNode } from "react";
import "katex/dist/katex.min.css";
import katex from "katex";

type MathSegment = {
  type: "inline" | "display";
  content: string;
};

type InlineNode =
  | { type: "text"; content: string }
  | { type: "math"; segmentIndex: number }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; content: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "break" };

const PLACEHOLDER_PREFIX = "\uE000MATH";
const PLACEHOLDER_SUFFIX = "\uE001";

function mathPlaceholder(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
}

function tokenizeMath(source: string): { markdownSource: string; segments: MathSegment[] } {
  const segments: MathSegment[] = [];
  const markdownSource = source.replace(
    /\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g,
    (_match, displayContent: string | undefined, inlineContent: string | undefined) => {
      const nextIndex = segments.length;
      if (displayContent !== undefined) {
        segments.push({ type: "display", content: displayContent });
      } else {
        segments.push({ type: "inline", content: inlineContent ?? "" });
      }
      return mathPlaceholder(nextIndex);
    }
  );

  return { markdownSource, segments };
}

function parsePlaceholderAt(source: string, startIndex: number) {
  if (!source.startsWith(PLACEHOLDER_PREFIX, startIndex)) return null;

  const suffixIndex = source.indexOf(PLACEHOLDER_SUFFIX, startIndex + PLACEHOLDER_PREFIX.length);
  if (suffixIndex === -1) return null;

  const indexText = source.slice(startIndex + PLACEHOLDER_PREFIX.length, suffixIndex);
  if (!/^\d+$/.test(indexText)) return null;

  return {
    segmentIndex: Number(indexText),
    endIndex: suffixIndex + PLACEHOLDER_SUFFIX.length,
  };
}

function isStandaloneDisplayMath(line: string, segments: MathSegment[]): number | null {
  const trimmed = line.trim();
  const match = trimmed.match(
    new RegExp(`^${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}$`)
  );

  if (!match) return null;

  const segmentIndex = Number(match[1]);
  if (!Number.isInteger(segmentIndex)) return null;
  return segments[segmentIndex]?.type === "display" ? segmentIndex : null;
}

function renderMathSegment(segment: MathSegment, key: string) {
  try {
    // Use MathML output — Google Translate doesn't touch MathML elements
    // (<mi>, <mo>, <mn>, etc.), which solves the 'y' translation problem
    const html = katex.renderToString(segment.content.trim(), {
      displayMode: segment.type === "display",
      throwOnError: false,
      trust: true,
      output: "mathml",
    });

    return (
      <span
        key={key}
        dangerouslySetInnerHTML={{ __html: html }}
        className={segment.type === "display" ? "my-2 block overflow-x-auto" : ""}
      />
    );
  } catch {
    return (
      <code key={key} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-900">
        {segment.type === "display"
          ? `$$${segment.content}$$`
          : `$${segment.content}$`}
      </code>
    );
  }
}

function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9]/.test(value));
}

function findClosingBracket(source: string, startIndex: number): number {
  let depth = 0;

  for (let index = startIndex; index < source.length; index += 1) {
    const placeholder = parsePlaceholderAt(source, index);
    if (placeholder) {
      index = placeholder.endIndex - 1;
      continue;
    }

    if (source[index] === "[") {
      depth += 1;
    } else if (source[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function findClosingParen(source: string, startIndex: number): number {
  let depth = 0;

  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] === "(") {
      depth += 1;
    } else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function isSafeHref(href: string): boolean {
  const trimmedHref = href.trim();
  return (
    trimmedHref.startsWith("/") ||
    trimmedHref.startsWith("#") ||
    trimmedHref.startsWith("mailto:") ||
    /^https?:\/\//i.test(trimmedHref)
  );
}

function parseInlineMarkdown(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let textBuffer = "";
  let index = 0;

  const pushText = () => {
    if (!textBuffer) return;
    nodes.push({ type: "text", content: textBuffer });
    textBuffer = "";
  };

  while (index < source.length) {
    const placeholder = parsePlaceholderAt(source, index);
    if (placeholder) {
      pushText();
      nodes.push({ type: "math", segmentIndex: placeholder.segmentIndex });
      index = placeholder.endIndex;
      continue;
    }

    if (source[index] === "\n") {
      pushText();
      nodes.push({ type: "break" });
      index += 1;
      continue;
    }

    if (source.startsWith("**", index) || source.startsWith("__", index)) {
      const marker = source.slice(index, index + 2);
      const closeIndex = source.indexOf(marker, index + 2);
      if (closeIndex !== -1 && closeIndex > index + 2) {
        const inner = source.slice(index + 2, closeIndex);
        // Don't treat runs of underscores (e.g. ______) as bold markers
        if (marker === "__" && /^_+$/.test(inner)) {
          textBuffer += source[index];
          index += 1;
          continue;
        }
        pushText();
        nodes.push({
          type: "strong",
          children: parseInlineMarkdown(inner),
        });
        index = closeIndex + 2;
        continue;
      }
    }

    if (source[index] === "*") {
      const closeIndex = source.indexOf("*", index + 1);
      if (closeIndex !== -1) {
        pushText();
        nodes.push({
          type: "em",
          children: parseInlineMarkdown(source.slice(index + 1, closeIndex)),
        });
        index = closeIndex + 1;
        continue;
      }
    }

    if (source[index] === "_") {
      const previousChar = index > 0 ? source[index - 1] : undefined;
      const nextChar = index + 1 < source.length ? source[index + 1] : undefined;
      const canOpen = !isWordCharacter(previousChar) && !/^\s$/.test(nextChar ?? "");

      // Don't open italic if next char is also underscore (part of a run like _______)
      if (canOpen && nextChar !== "_") {
        const closeIndex = source.indexOf("_", index + 1);
        if (closeIndex !== -1 && closeIndex > index + 1) {
          const beforeClose = source[closeIndex - 1];
          if (!isWordCharacter(beforeClose)) {
            pushText();
            nodes.push({
              type: "em",
              children: parseInlineMarkdown(source.slice(index + 1, closeIndex)),
            });
            index = closeIndex + 1;
            continue;
          }
        }
      }
    }

    if (source[index] === "`") {
      const closeIndex = source.indexOf("`", index + 1);
      if (closeIndex !== -1) {
        pushText();
        nodes.push({
          type: "code",
          content: source.slice(index + 1, closeIndex),
        });
        index = closeIndex + 1;
        continue;
      }
    }

    if (source[index] === "[") {
      const labelCloseIndex = findClosingBracket(source, index);
      if (labelCloseIndex !== -1 && source[labelCloseIndex + 1] === "(") {
        const hrefCloseIndex = findClosingParen(source, labelCloseIndex + 1);
        if (hrefCloseIndex !== -1) {
          const href = source.slice(labelCloseIndex + 2, hrefCloseIndex).trim();
          if (isSafeHref(href)) {
            pushText();
            nodes.push({
              type: "link",
              href,
              children: parseInlineMarkdown(source.slice(index + 1, labelCloseIndex)),
            });
            index = hrefCloseIndex + 1;
            continue;
          }
        }
      }
    }

    textBuffer += source[index];
    index += 1;
  }

  pushText();
  return nodes;
}

function renderInlineNodes(
  nodes: InlineNode[],
  segments: MathSegment[],
  keyPrefix: string
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.type) {
      case "text":
        return node.content;
      case "math":
        return renderMathSegment(segments[node.segmentIndex], key);
      case "strong":
        return <strong key={key}>{renderInlineNodes(node.children, segments, key)}</strong>;
      case "em":
        return <em key={key}>{renderInlineNodes(node.children, segments, key)}</em>;
      case "code":
        return (
          <code key={key} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.95em] text-zinc-900">
            {node.content}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target={node.href.startsWith("#") || node.href.startsWith("/") ? undefined : "_blank"}
            rel={node.href.startsWith("#") || node.href.startsWith("/") ? undefined : "noopener noreferrer"}
            className="text-[#750014] underline underline-offset-2 hover:text-[#5a0010]"
          >
            {renderInlineNodes(node.children, segments, key)}
          </a>
        );
      case "break":
        return <br key={key} />;
      default:
        return null;
    }
  });
}

function isUnorderedListLine(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line);
}

function isOrderedListLine(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isBlockquoteLine(line: string): boolean {
  return /^\s*>\s?/.test(line);
}

function isCodeFenceLine(line: string): boolean {
  return /^```/.test(line.trim());
}

function isBlockStart(line: string, segments: MathSegment[]): boolean {
  return (
    line.trim().length === 0 ||
    isHeadingLine(line) ||
    isBlockquoteLine(line) ||
    isUnorderedListLine(line) ||
    isOrderedListLine(line) ||
    isCodeFenceLine(line) ||
    isStandaloneDisplayMath(line, segments) !== null
  );
}

function renderHeading(level: number, content: string, segments: MathSegment[], key: string) {
  const inlineNodes = renderInlineNodes(parseInlineMarkdown(content), segments, `${key}-inline`);

  switch (level) {
    case 1:
      return (
        <h1 key={key} className="mb-3 text-2xl font-semibold text-zinc-900 last:mb-0">
          {inlineNodes}
        </h1>
      );
    case 2:
      return (
        <h2 key={key} className="mb-3 text-xl font-semibold text-zinc-900 last:mb-0">
          {inlineNodes}
        </h2>
      );
    case 3:
      return (
        <h3 key={key} className="mb-3 text-lg font-semibold text-zinc-900 last:mb-0">
          {inlineNodes}
        </h3>
      );
    default:
      return (
        <h4 key={key} className="mb-3 text-base font-semibold text-zinc-900 last:mb-0">
          {inlineNodes}
        </h4>
      );
  }
}

function renderMarkdownBlocks(
  source: string,
  segments: MathSegment[],
  keyPrefix: string
): ReactNode[] {
  const lines = source.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let lineIndex = 0;
  let blockIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];

    if (line.trim().length === 0) {
      lineIndex += 1;
      continue;
    }

    const standaloneDisplayIndex = isStandaloneDisplayMath(line, segments);
    if (standaloneDisplayIndex !== null) {
      blocks.push(
        renderMathSegment(segments[standaloneDisplayIndex], `${keyPrefix}-block-${blockIndex}`)
      );
      blockIndex += 1;
      lineIndex += 1;
      continue;
    }

    if (isCodeFenceLine(line)) {
      const codeLines: string[] = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !isCodeFenceLine(lines[lineIndex])) {
        codeLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) lineIndex += 1;

      blocks.push(
        <pre
          key={`${keyPrefix}-block-${blockIndex}`}
          className="mb-3 overflow-x-auto rounded-lg bg-zinc-950 px-4 py-3 text-sm text-zinc-100 last:mb-0"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      blockIndex += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push(
        renderHeading(
          headingMatch[1].length,
          headingMatch[2],
          segments,
          `${keyPrefix}-block-${blockIndex}`
        )
      );
      blockIndex += 1;
      lineIndex += 1;
      continue;
    }

    if (isBlockquoteLine(line)) {
      const quoteLines: string[] = [];
      while (lineIndex < lines.length && isBlockquoteLine(lines[lineIndex])) {
        quoteLines.push(lines[lineIndex].replace(/^\s*>\s?/, ""));
        lineIndex += 1;
      }

      blocks.push(
        <blockquote
          key={`${keyPrefix}-block-${blockIndex}`}
          className="mb-3 border-l-4 border-zinc-200 pl-4 text-zinc-700 last:mb-0"
        >
          {renderMarkdownBlocks(quoteLines.join("\n"), segments, `${keyPrefix}-quote-${blockIndex}`)}
        </blockquote>
      );
      blockIndex += 1;
      continue;
    }

    if (isUnorderedListLine(line) || isOrderedListLine(line)) {
      const ordered = isOrderedListLine(line);
      const items: string[] = [];

      while (lineIndex < lines.length) {
        const currentLine = lines[lineIndex];
        if (ordered ? !isOrderedListLine(currentLine) : !isUnorderedListLine(currentLine)) {
          break;
        }

        items.push(currentLine.replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, ""));
        lineIndex += 1;
      }

      const ListTag = ordered ? "ol" : "ul";
      const listClassName = ordered
        ? "mb-3 list-decimal space-y-1 pl-6 last:mb-0"
        : "mb-3 list-disc space-y-1 pl-6 last:mb-0";

      blocks.push(
        <ListTag key={`${keyPrefix}-block-${blockIndex}`} className={listClassName}>
          {items.map((item, itemIndex) => (
            <li key={`${keyPrefix}-block-${blockIndex}-item-${itemIndex}`}>
              {renderInlineNodes(
                parseInlineMarkdown(item),
                segments,
                `${keyPrefix}-block-${blockIndex}-item-${itemIndex}`
              )}
            </li>
          ))}
        </ListTag>
      );
      blockIndex += 1;
      continue;
    }

    const paragraphLines = [line];
    lineIndex += 1;

    while (lineIndex < lines.length) {
      const nextLine = lines[lineIndex];
      if (isBlockStart(nextLine, segments)) break;
      paragraphLines.push(nextLine);
      lineIndex += 1;
    }

    blocks.push(
      <div key={`${keyPrefix}-block-${blockIndex}`} className="mb-3 last:mb-0">
        {renderInlineNodes(
          parseInlineMarkdown(paragraphLines.join("\n")),
          segments,
          `${keyPrefix}-block-${blockIndex}`
        )}
      </div>
    );
    blockIndex += 1;
  }

  return blocks;
}

/**
 * Renders Markdown plus LaTeX, while protecting `$...$` / `$$...$$` math
 * from Markdown parsing so emphasis, lists, and links do not interfere with KaTeX.
 */
export default function MathText({ children }: { children: string }) {
  const { markdownSource, segments } = tokenizeMath(children);
  return <>{renderMarkdownBlocks(markdownSource, segments, "math")}</>;
}
