import { sourceSlice, type SourceDocument } from "../shared/source-markdown.ts";

const LEAF = "[data-ratex-source]";

function compare(a: Node, offsetA: number, b: Node, offsetB: number): number {
  const left = a.ownerDocument!.createRange();
  const right = b.ownerDocument!.createRange();
  left.setStart(a, offsetA); left.collapse(true);
  right.setStart(b, offsetB); right.collapse(true);
  return left.compareBoundaryPoints(0, right);
}

/** Uses the normalized DOM Range, so forward and reverse drags are identical. */
export function selectedMarkdown(root: HTMLElement, doc: SourceDocument, selection: Selection | null): string | null {
  if (!root.isConnected || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  let start: number | undefined;
  let end: number | undefined;
  for (const element of root.querySelectorAll<HTMLElement>(LEAF)) {
    const span = doc.spans.get(element.dataset.ratexSource ?? "");
    if (!span) continue;
    // Strict intersection excludes an adjacent formula touched only at the boundary.
    if (compare(range.endContainer, range.endOffset, element, 0) <= 0 ||
        compare(range.startContainer, range.startOffset, element, element.childNodes.length) >= 0) continue;
    let a = span.start;
    let b = span.end;
    if (!span.atomic && span.boundaries) {
      const prefix = root.ownerDocument.createRange();
      prefix.selectNodeContents(element);
      const at = (container: Node, offset: number) => {
        if (compare(container, offset, element, 0) <= 0) return 0;
        if (compare(container, offset, element, element.childNodes.length) >= 0) return span.boundaries!.length - 1;
        prefix.setEnd(container, offset);
        return prefix.toString().length;
      };
      a = span.boundaries[at(range.startContainer, range.startOffset)] ?? a;
      b = span.boundaries[at(range.endContainer, range.endOffset)] ?? b;
    }
    if (a >= b) continue;
    start = start === undefined ? a : Math.min(start, a);
    end = end === undefined ? b : Math.max(end, b);
  }
  return start !== undefined && end !== undefined ? sourceSlice(doc, start, end) : null;
}

/** Native listener: Quote dispatches its synthetic event on the range's start element. */
export function installMarkdownCopy(root: HTMLElement, doc: SourceDocument): () => void {
  const copy = (event: ClipboardEvent) => {
    if (event.defaultPrevented || !event.clipboardData || !(event.target instanceof Node) || !root.contains(event.target)) return;
    const text = selectedMarkdown(root, doc, root.ownerDocument.defaultView?.getSelection() ?? null);
    if (!text) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  };
  root.addEventListener("copy", copy);
  return () => root.removeEventListener("copy", copy);
}
