import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { renderNativeFormula } from '../server/native-render.ts';
import { renderNativeLatexRpc } from '../shared/ratex.ts';

test('native renderer returns transparent unclipped PNGs with pinned KaTeX glyph outlines', async () => {
  for (const color of ['#eeeeee', '#111111']) for (const latex of [String.raw`\mathcal{A}(x)`, 'Q',
    String.raw`\frac{1}{\frac{x_i^2}{y^3}}`, String.raw`\sum_{i=1}^n x_i`,
    String.raw`\int_0^\infty e^{-x^2}\,dx`, String.raw`\begin{aligned}a&=b+c\\d&=\frac{x}{y}\end{aligned}`,
    String.raw`\begin{cases}x^2&x>0\\0&x\le0\end{cases}`, String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
    String.raw`\sqrt{x^2+\frac{1}{y}}`]) {
    const result = await renderNativeFormula({ latex, displayMode: true, color });
    assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) continue;
    assert(renderNativeLatexRpc.output.safeParse(result).success);
    const png = PNG.sync.read(Buffer.from(result.png, 'base64'));
    assert.equal(png.width, Math.round(result.width * result.density));
    assert.equal(png.height, Math.round(result.height * result.density));
    assert(result.baseline > 0 && result.baseline < result.height);
    let ink = 0, clear = 0;
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
      const alpha = png.data[(y * png.width + x) * 4 + 3];
      if (alpha) {
        ink++;
        assert(x > 0 && y > 0 && x < png.width - 1 && y < png.height - 1, `${latex}: clipped ink`);
      } else clear++;
    }
    assert(ink > 10 && clear > 10, 'must contain ink on transparent background');
  }
});

test('native rendering keeps density, size, colors and caching distinct', async () => {
  const a = await renderNativeFormula({ latex: 'x^2', displayMode: false, color: '#eeeeee', density: 2 });
  assert(a.ok);assert.equal(a, await renderNativeFormula({ latex: 'x^2', displayMode: false, color: '#eeeeee', density: 2 }));
  const b = await renderNativeFormula({ latex: 'x^2', displayMode: false, color: '#111111', density: 3 });
  assert(b.ok);assert.notEqual(a.png, b.png);
  const c = await renderNativeFormula({ latex: Array.from({length:45},(_,i)=>`x_{${i}}`).join('+'), displayMode: true });
  assert(c.ok);assert(c.width > 360, 'long formula retains natural size for native scrolling');
});

test('invalid or unsupported native formulas fail to selectable source, not replacement boxes', async () => {
  for (const latex of [String.raw`\definitelyNotACommand{x}`, String.raw`\text{中文}`, 'x'.repeat(4097)]) {
    const result = await renderNativeFormula({ latex, displayMode: false });
    assert.equal(result.ok, false);
  }
});
