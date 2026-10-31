import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceMarkdown, sourceSlice, type SourceDocument } from "../shared/source-markdown.ts";

function spanFor(doc: SourceDocument, type: string, text: string) {
  const walk = (node: object): object | undefined => {
    const record = node as Record<string, unknown>;
    if (record.type === type && (record.text === text || record.source === text)) return node;
    for (const value of Object.values(record)) if (Array.isArray(value)) {
      for (const child of value.flat(2)) if (child && typeof child === "object") { const found = walk(child); if (found) return found; }
    }
  };
  const node = doc.blocks.map(walk).find(Boolean);
  assert.ok(node, `missing ${type} ${text}`);
  const span = doc.spans.get(doc.ids.get(node) ?? "");
  assert.ok(span);
  return span;
}

test("positioned parser keeps all four original formula delimiters and offsets", () => {
  const source = "Start $x$ then \\(y_i\\)\n\n$$\nz^2\n$$\n\n\\[ w \\]";
  const doc = sourceMarkdown(source);
  for (const value of ["$x$", "\\(y_i\\)", "$$\nz^2\n$$", "\\[ w \\]"]) {
    const span = spanFor(doc, value.startsWith("$$") || value.startsWith("\\[") ? "display-math" : "math", value);
    assert.equal(source.slice(span.start, span.end), value);
    assert.equal(span.atomic, true);
  }
});

test("UTF-16 text boundaries preserve escapes, entities, emoji, CRLF and partial prose", () => {
  const doc = sourceMarkdown("Prefix \\* &amp; 😀 end\r\nnext $x$");
  const text = spanFor(doc, "text", "Prefix * & 😀 end\nnext ");
  const from = "Prefix * & ".length;
  const end = from + "😀".length;
  assert.equal(doc.source.slice(text.boundaries![from], text.boundaries![end]), "😀");
  assert.equal(doc.source.slice(text.boundaries![7], text.boundaries![8]), "\\*");
  assert.equal(doc.source.slice(text.boundaries![9], text.boundaries![10]), "&amp;");
});

test("complete wrappers restore markers; partial prose never pulls unrelated words", () => {
  const doc = sourceMarkdown("## Heading\n\n- [x] **first $x$ item**\n\n> quote $y$\n> second");
  const first = spanFor(doc, "text", "first ");
  const last = spanFor(doc, "text", " item");
  assert.equal(sourceSlice(doc, first.start, last.end), "- [x] **first $x$ item**");
  assert.equal(sourceSlice(doc, first.start + 1, first.start + 4), "irs");
  const heading = spanFor(doc, "text", "Heading");
  assert.equal(sourceSlice(doc, heading.start, heading.end), "## Heading");
});

test("code, fences and URLs are not confused with rendered math", () => {
  const doc = sourceMarkdown("Use `price=$5` and [docs](https://example.com/$x$) then $z$\n\n~~~tex\n$x$\n~~~");
  const maths = [...doc.spans.values()].filter((span) => span.atomic && doc.source.slice(span.start, span.end) === "$z$");
  assert.equal(maths.length, 1);
  const paragraph = doc.blocks[0];
  assert.ok(paragraph.type === "paragraph");
  assert.ok(paragraph.inlines.some((node) => node.type === "link" && node.href === "https://example.com/$x$"));
  assert.ok(paragraph.inlines.some((node) => node.type === "code" && node.text === "price=$5"));
  assert.equal(doc.blocks.at(-1)?.type, "code");
});

test("literal NUL and HTML stay text, never become math placeholders or executable HTML", () => {
  const doc = sourceMarkdown("<script>alert(1)</script>\n\nText \u00000\u0000 and $x$");
  const math = [...doc.spans.values()].filter((span) => doc.source.slice(span.start, span.end) === "$x$");
  assert.equal(math.length, 1);
  assert.equal(doc.blocks[0].type, "paragraph");
});
