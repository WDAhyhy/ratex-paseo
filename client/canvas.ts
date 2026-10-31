import { renderToCanvas, type WebRenderOptions } from "../node_modules/ratex-wasm/dist/renderer.js";
import { formulaDepth } from "../shared/layout";
import type { DisplayList } from "../shared/ratex";

type CanvasSurface = Pick<HTMLCanvasElement, "width" | "height"> & {
  getContext(context: "2d"): CanvasRenderingContext2D | null;
};
// RPC accepts forward-compatible display items; the pinned renderer ignores unknown
// item types. This adapter also permits the measurement surface (no DOM insertion).
const paint = renderToCanvas as (list: DisplayList, surface: CanvasSurface, options: WebRenderOptions) => void;

/** RaTeX supplies layout boxes, but Canvas paints font ink (not advance boxes).
 * Measure the actual glyph ink with the exact font selected by its renderer, then
 * enlarge/translate only when ink protrudes. No fixed oversized padding or scaling.
 */
export function drawFormula(list: DisplayList, canvas: HTMLCanvasElement, fontSize: number, padding: number, backgroundColor: string) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get formula canvas context");
  let left = 0;
  let top = 0;
  let right = list.width * fontSize;
  let bottom = (list.height + formulaDepth(list)) * fontSize;
  const fonts = new Set<string>();
  const measured = new Proxy(context, {
    get(target, property) {
      if (property === "fillText") return (text: string, x: number, y: number) => {
        const ink = target.measureText(text);
        left = Math.min(left, x - ink.actualBoundingBoxLeft);
        right = Math.max(right, x + ink.actualBoundingBoxRight);
        top = Math.min(top, y - ink.actualBoundingBoxAscent);
        bottom = Math.max(bottom, y + ink.actualBoundingBoxDescent);
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value: unknown) {
      if (property === "font") fonts.add(String(value));
      return Reflect.set(target, property, value, target);
    },
  });
  const measuringCanvas = { set width(value: number) { canvas.width = value; }, set height(value: number) { canvas.height = value; },
    getContext: () => measured };
  paint({ ...list, depth: formulaDepth(list) }, measuringCanvas, { fontSize, padding, backgroundColor });
  const x = -Math.floor(left);
  const y = -Math.floor(top);
  const width = Math.ceil(right) + x;
  const height = Math.ceil(bottom) + y;
  const adjusted = { ...list, width: width / fontSize, height: height / fontSize, depth: 0,
    items: list.items.map((item) => ({ ...item,
      ...(typeof item.x === "number" ? { x: item.x + x / fontSize } : {}),
      ...(typeof item.y === "number" ? { y: item.y + y / fontSize } : {}),
    })) };
  paint(adjusted, canvas, { fontSize, padding, backgroundColor });
  return { width: canvas.width, height: canvas.height, baseline: padding + list.height * fontSize + y, fonts: [...fonts] };
}
