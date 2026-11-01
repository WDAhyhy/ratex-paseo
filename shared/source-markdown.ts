import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { decodeString } from "micromark-util-decode-string";
import type { Nodes, RootContent, PhrasingContent } from "mdast";
import type { InlineNode, MarkdownBlock, TableAlign } from "./markdown.ts";
import { splitMathSegments } from "./math.ts";

export type SourceSpan = {
  start: number;
  end: number;
  /** UTF-16 DOM text boundaries -> untouched Markdown offsets. */
  boundaries?: number[];
  atomic?: boolean;
};
export type SourceDocument = {
  source: string;
  blocks: MarkdownBlock[];
  spans: Map<string, SourceSpan>;
  ids: WeakMap<object, string>;
  /** Restore enclosing syntax only when its entire visible content is selected. */
  wrappers: Array<{ start: number; end: number; contentStart: number; contentEnd: number }>;
};

type MathToken = SourceSpan & { latex: string; source: string; displayMode: boolean };

/** Parse once per message. Math is masked at identical UTF-16 offsets before Markdown parsing. */
export function sourceMarkdown(source: string): SourceDocument {
  const doc: SourceDocument = { source, blocks: [], spans: new Map(), ids: new WeakMap(), wrappers: [] };
  const maths: MathToken[] = [];
  let offset = 0;
  const masked = splitMathSegments(source).map((segment) => {
    const raw = segment.type === "text" ? segment.text : segment.source;
    const start = offset;
    offset += raw.length;
    if (segment.type === "text") return raw;
    maths.push({ ...segment, start, end: offset, atomic: true });
    // Use non-line-breaking placeholders for internal math newlines, so a blank
    // line in aligned/cases cannot split one formula into multiple Markdown nodes.
    // Offsets and the surrounding prose's line breaks remain unchanged.
    return raw.replace(/[^]/g, "x");
  }).join("");
  const tree = fromMarkdown(masked, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const bounds = (node: Nodes): SourceSpan => ({
    start: node.position?.start.offset ?? 0,
    end: node.position?.end.offset ?? source.length,
  });
  const register = <T extends object>(node: T, span: SourceSpan): T => {
    const id = String(doc.spans.size);
    doc.ids.set(node, id);
    doc.spans.set(id, span);
    return node;
  };
  const wrap = (node: Nodes, children: InlineNode[]) => {
    const first = children[0];
    const last = children[children.length - 1];
    const a = first && doc.spans.get(doc.ids.get(first) ?? "");
    const b = last && doc.spans.get(doc.ids.get(last) ?? "");
    if (a && b) doc.wrappers.push({ ...bounds(node), contentStart: a.start, contentEnd: b.end });
  };
  const textNodes = (start: number, end: number): InlineNode[] => {
    const result: InlineNode[] = [];
    let cursor = start;
    const prose = (a: number, b: number) => {
      if (b <= a) return;
      const raw = source.slice(a, b);
      // Markdown escapes/entities and blockquote continuation prefixes are syntax, not DOM text.
      let text = "";
      const boundaries = [a];
      const token = /\r\n|\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);|\n(?: {0,3}> ?)+|[^]/gi;
      for (const match of raw.matchAll(token)) {
        const value = match[0] === "\r\n" || match[0].startsWith("\n") ? "\n" : decodeString(match[0]);
        const from = a + (match.index ?? 0);
        text += value;
        for (let i = 1; i <= value.length; i++) boundaries.push(i === value.length ? from + match[0].length : from + i);
      }
      result.push(register({ type: "text", text }, { start: a, end: b, boundaries }));
    };
    for (const math of maths) {
      if (math.end <= start || math.start >= end) continue;
      prose(cursor, math.start);
      result.push(register({ type: "math", latex: math.latex, source: math.source }, math));
      cursor = math.end;
    }
    prose(cursor, end);
    return result;
  };
  const originalUrl = (url: string, span: SourceSpan): string => {
    const at = masked.indexOf(url, span.start);
    return at >= span.start && at + url.length <= span.end ? decodeString(source.slice(at, at + url.length)) : url;
  };
  const inlines = (children: PhrasingContent[]): InlineNode[] => children.flatMap((node): InlineNode[] => {
    const span = bounds(node);
    switch (node.type) {
      case "text": return textNodes(span.start, span.end);
      case "inlineCode": return [register({ type: "code", text: node.value }, { ...span, atomic: true })];
      case "break": return [register({ type: "text", text: "\n" }, { ...span, atomic: true })];
      case "strong": case "emphasis": case "delete": {
        const children = inlines(node.children);
        wrap(node, children);
        return [register({ type: node.type === "strong" ? "strong" : node.type === "delete" ? "strike" : "em", children }, span)];
      }
      case "link": {
        const children = inlines(node.children);
        wrap(node, children);
        return [register({ type: "link", image: false, href: originalUrl(node.url, span), children }, span)];
      }
      case "image": return [register({ type: "link", image: true, href: originalUrl(node.url, span),
        children: [register({ type: "text", text: node.alt ?? "" }, { ...span, atomic: true })] }, { ...span, atomic: true })];
      default: return textNodes(span.start, span.end);
    }
  });
  const blocks = (children: RootContent[], depth = 0, indent = 0): MarkdownBlock[] => children.flatMap((node): MarkdownBlock[] => {
    const span = bounds(node);
    switch (node.type) {
      case "paragraph": {
        const parts = inlines(node.children);
        const result: MarkdownBlock[] = [];
        let pending: InlineNode[] = [];
        const flush = () => {
          if (pending.length) result.push(register({ type: "paragraph", inlines: pending }, span));
          pending = [];
        };
        for (const part of parts) {
          const pos = doc.spans.get(doc.ids.get(part) ?? "");
          const math = pos && maths.find((math) => math.start === pos.start && math.displayMode);
          if (math) { flush(); result.push(register({ type: "display-math", latex: math.latex, source: math.source }, math)); }
          else if (!(part.type === "text" && /^\s*$/.test(part.text) && pending.length === 0 && result.length)) pending.push(part);
        }
        flush();
        return result;
      }
      case "heading": {
        const children = inlines(node.children);
        wrap(node, children);
        return [register({ type: "heading", level: node.depth, inlines: children }, span)];
      }
      case "blockquote": {
        if (depth >= 8) return [register({ type: "paragraph", inlines: textNodes(span.start, span.end) }, span)];
        const children = blocks(node.children, depth + 1, indent);
        const first = node.children[0];
        const last = node.children[node.children.length - 1];
        if (first && last) doc.wrappers.push({ ...span, contentStart: bounds(first).start, contentEnd: bounds(last).end });
        return [register({ type: "quote", blocks: children }, span)];
      }
      case "list": return node.children.flatMap((item, index) => {
        const result: MarkdownBlock[] = [];
        for (const child of item.children) {
          if (child.type === "paragraph" && result.length === 0) {
            const children = inlines(child.children);
            wrap(item, children);
            result.push(register({ type: "list-item", ordered: Boolean(node.ordered),
              marker: item.checked == null ? (node.ordered ? `${(node.start ?? 1) + index}.` : "•") : item.checked ? "☑" : "☐",
              indent, checked: item.checked ?? null, inlines: children }, bounds(item)));
          } else result.push(...blocks([child], depth, indent + 1));
        }
        return result;
      });
      case "code": return [register({ type: "code", text: node.value }, { ...span, atomic: true })];
      case "table": {
        const rows = node.children.map((row) => row.children.map((cell) => inlines(cell.children)));
        const cells = rows.flat(2);
        wrap(node, cells);
        return [register({ type: "table", align: (node.align ?? []).map((align): TableAlign => align ?? "left"), header: rows[0] ?? [], rows: rows.slice(1) }, span)];
      }
      case "thematicBreak": return [register({ type: "hr" }, span)];
      default: return [register({ type: "paragraph", inlines: textNodes(span.start, span.end) }, span)];
    }
  });
  doc.blocks = blocks(tree.children);
  return doc;
}

export function sourceSlice(doc: SourceDocument, start: number, end: number): string {
  // Inner wrappers first; repeated passes are unnecessary because Markdown is a tree.
  for (const span of [...doc.wrappers].sort((a, b) => (a.end - a.start) - (b.end - b.start))) {
    if (start <= span.contentStart && end >= span.contentEnd) {
      start = Math.min(start, span.start);
      end = Math.max(end, span.end);
    }
  }
  return doc.source.slice(start, end);
}
