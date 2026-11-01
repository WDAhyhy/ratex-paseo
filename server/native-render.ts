import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { Writable } from 'node:stream';
import { make, encodePNGToStream } from 'pureimage';
import opentype, { type Font, type Path } from 'opentype.js';
import { formulaDepth } from '../shared/layout.ts';
import type { DisplayList } from '../shared/ratex.ts';
import { initRatex, renderLatexToDisplayList } from './ratex.ts';
import { NATIVE_FONT_INDEX, NATIVE_FONTS_GZIP } from './vendor/native-fonts.ts';
import cjkAsset from './assets/native-cjk.json' with { type: 'json' };

type Color = { r: number; g: number; b: number; a: number };
type Command = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
type Shape = { path: Command[]; color: string; stroke?: number };
type NativeTile = { png: string; x: number; y: number; width: number; height: number };
const fonts = new Map<string, Font>();
function getFont(name: string): Font {
  if (!fonts.size) {
    const all = gunzipSync(Buffer.from(NATIVE_FONTS_GZIP, 'base64'));
    for (const [id, offset, length] of NATIVE_FONT_INDEX) {
      const bytes = all.subarray(offset, offset + length);
      fonts.set(id, opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    }
  }
  if (name.startsWith('CJK-') && !fonts.has(name)) {
    const bytes = gunzipSync(Buffer.from(cjkAsset.gzip, 'base64'));
    fonts.set(name, opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  }
  const font = fonts.get(name);
  if (!font) throw new Error(`Unsupported native formula font: ${name}`);
  return font;
}
const css = (c: Color) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
const cache = new Map<string, { result: NativeBitmap; bytes: number }>();
let cacheBytes = 0;
export type NativeBitmap = { ok: true; png: string; width: number; height: number; baseline: number; density: number; tiles?: NativeTile[] };

/** Font outlines are painted on the daemon, so Android needs no webfont or DOM. */
export async function renderNativeFormula({ latex, displayMode, color, fontSize = 16, density = 3 }: {
  latex: string; displayMode: boolean; color?: string; fontSize?: number; density?: number;
}): Promise<NativeBitmap | { ok: false; error: string }> {
  try {
    if (latex.length > 4096 || !Number.isFinite(fontSize) || fontSize < 8 || fontSize > 64 || density < 1 || density > 4) {
      throw new Error('Native formula input exceeds rendering limits');
    }
    const key = JSON.stringify([latex, displayMode, color, fontSize, density]);
    const hit = cache.get(key); if (hit) return hit.result;
    await initRatex();
    const list: DisplayList = renderLatexToDisplayList(latex, { displayMode, color });
    const em = fontSize * density, pad = density;
    let left = 0, top = 0, right = list.width * em, bottom = (list.height + formulaDepth(list)) * em;
    const shapes: Shape[] = [];
    for (const raw of list.items) {
      const item = raw as Record<string, any>;
      const tint = css(item.color);
      if (item.type === 'GlyphPath') {
        const font = getFont(item.font);
        const text = String.fromCodePoint(item.char_code);
        if (font.charToGlyphIndex(text) === 0 && !/\s/.test(text)) throw new Error(`Missing native glyph U+${item.char_code.toString(16)}`);
        const path: Path = font.getPath(text, item.x * em, item.y * em, item.scale * em);
        const box = path.getBoundingBox();
        left = Math.min(left, box.x1); top = Math.min(top, box.y1);
        right = Math.max(right, box.x2); bottom = Math.max(bottom, box.y2);
        shapes.push({ path: path.commands, color: tint });
      } else if (item.type === 'Rect' || item.type === 'Line') {
        const thickness = item.type === 'Line' ? Math.max(0.5, item.thickness * em) : item.height * em;
        const x = item.x * em, y = item.y * em - (item.type === 'Line' ? thickness / 2 : 0), w = item.width * em;
        const rect = (start: number, width: number) => shapes.push({ color: tint, path: [
          { type: 'M', x: start, y }, { type: 'L', x: start + width, y },
          { type: 'L', x: start + width, y: y + thickness }, { type: 'L', x: start, y: y + thickness }, { type: 'Z' },
        ] });
        if (item.dashed) for (let at = 0; at < w; at += thickness * 6) rect(x + at, Math.min(thickness * 3, w - at));
        else rect(x, w);
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + w); bottom = Math.max(bottom, y + thickness);
      } else if (item.type === 'Path') {
        const x = item.x * em, y = item.y * em;
        const commands: Command[] = item.commands.map((c: Record<string, any>) => ({
          type: ({ MoveTo: 'M', LineTo: 'L', CubicTo: 'C', QuadTo: 'Q', Close: 'Z' } as Record<string, string>)[c.type],
          ...(c.x === undefined ? {} : { x: x + c.x * em, y: y + c.y * em }),
          ...(c.x1 === undefined ? {} : { x1: x + c.x1 * em, y1: y + c.y1 * em }),
          ...(c.x2 === undefined ? {} : { x2: x + c.x2 * em, y2: y + c.y2 * em }),
        }));
        for (const c of commands) for (const suffix of ['', '1', '2']) {
          const px = c[('x' + suffix) as keyof Command], py = c[('y' + suffix) as keyof Command];
          if (typeof px === 'number' && typeof py === 'number') {
            left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
          }
        }
        shapes.push({ path: commands, color: tint, ...(item.fill ? {} : { stroke: 1 }) });
      }
    }
    const ox = pad - Math.floor(left), oy = pad - Math.floor(top);
    const width = Math.max(1, Math.ceil(right) + ox + pad), height = Math.max(1, Math.ceil(bottom) + oy + pad);
    // Android decoders/GPU textures must never receive an enormous single image.
    // Tile the painted geometry rather than splitting TeX, preserving alignment,
    // spanning brackets and fractions across row/column boundaries.
    if (width > 65536 || height > 32768 || width * height > 16_000_000) throw new Error('Native formula bitmap exceeds size limit');
    const tileSize = 1536;
    const tiles: NativeTile[] = [];
    for (let ty = 0; ty < height; ty += tileSize) for (let tx = 0; tx < width; tx += tileSize) {
      const tw = Math.min(tileSize, width - tx), th = Math.min(tileSize, height - ty);
      const image = make(tw, th), ctx = image.getContext('2d');
      image.data.fill(0);
      for (const shape of shapes) {
        const xs = shape.path.flatMap(c => [c.x, c.x1, c.x2].filter((v): v is number => v !== undefined));
        const ys = shape.path.flatMap(c => [c.y, c.y1, c.y2].filter((v): v is number => v !== undefined));
        if (xs.length && (Math.max(...xs) + ox < tx || Math.min(...xs) + ox > tx + tw ||
            Math.max(...ys) + oy < ty || Math.min(...ys) + oy > ty + th)) continue;
        ctx.beginPath();
        for (const c of shape.path) {
          if (c.type === 'M') ctx.moveTo(c.x! + ox - tx, c.y! + oy - ty);
          else if (c.type === 'L') ctx.lineTo(c.x! + ox - tx, c.y! + oy - ty);
          else if (c.type === 'C') ctx.bezierCurveTo(c.x1! + ox - tx, c.y1! + oy - ty, c.x2! + ox - tx, c.y2! + oy - ty, c.x! + ox - tx, c.y! + oy - ty);
          else if (c.type === 'Q') ctx.quadraticCurveTo(c.x1! + ox - tx, c.y1! + oy - ty, c.x! + ox - tx, c.y! + oy - ty);
          else if (c.type === 'Z') ctx.closePath();
        }
        ctx.fillStyle = shape.color; ctx.strokeStyle = shape.color;
        if (shape.stroke) { ctx.lineWidth = shape.stroke; ctx.stroke(); } else ctx.fill();
      }
      const chunks: Buffer[] = [];
      const stream = new Writable({ write(chunk, _encoding, next) { chunks.push(Buffer.from(chunk)); next(); } });
      await encodePNGToStream(image, stream);
      tiles.push({ png: Buffer.concat(chunks).toString('base64'), x: tx / density, y: ty / density,
        width: tw / density, height: th / density });
    }
    const result: NativeBitmap = { ok: true, png: tiles[0].png, width: width / density, height: height / density,
      baseline: (list.height * em + oy) / density, density, ...(tiles.length > 1 ? { tiles } : {}) };
    const bytes = tiles.reduce((sum, tile) => sum + tile.png.length * 2, 0);
    if (bytes < 1_000_000) {
      while (cache.size >= 128 || cacheBytes + bytes > 8_000_000) {
        const first = cache.keys().next().value!; cacheBytes -= cache.get(first)!.bytes; cache.delete(first);
      }
      cache.set(key, { result, bytes }); cacheBytes += bytes;
    }
    return result;
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
