import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Optional real WebKit engine checks; mobile viewport is not an iOS device. */
export async function testMobileWebkit({ origin, evidence, dependencyRoot, errors }) {
  const require = createRequire(path.join(dependencyRoot, 'package.json'));
  const { webkit } = require('playwright');
  const browser = await webkit.launch({ headless: true,
    ...(process.env.RATEX_WEBKIT_BIN ? { executablePath: process.env.RATEX_WEBKIT_BIN } : {}) });
  const measurements = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(origin);
    await page.waitForFunction(() => window.setMessage);
    const long = Array.from({ length: 45 }, (_, i) => `x_{${i}}`).join('+');
    const text = String.raw`活动集 $\mathcal{A}(x)$ 与 $Q$。

长行内 $${long}$ 后续。

$$${long}$$

| TeX | Value |
|---|---|
| $${long}$ | $\sum_i^n a_i$ |`;
    await page.evaluate(text => window.setMessage({ text, compact: true }), text);
    await page.waitForFunction(() => document.querySelectorAll('#message canvas').length === 6);
    await page.evaluate(async () => document.fonts.ready);
    for (const light of [false, true]) {
      await page.evaluate(light => window.setMessage({ light }), light);
      for (const width of [390, 844, 390]) {
        await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
        await page.waitForFunction(() => [...document.querySelectorAll('#message canvas')].every(canvas =>
          Math.abs(canvas.getBoundingClientRect().width * devicePixelRatio - canvas.width) < 1));
        const metric = await page.evaluate(() => ({ width: innerWidth, pageWidth: document.documentElement.scrollWidth,
          scrollers: [...document.querySelectorAll('#message *')].filter(node =>
            ['auto', 'scroll'].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth).length,
          clipped: [...document.querySelectorAll('#message canvas')].some(canvas => {
            const box = canvas.getBoundingClientRect();
            for (let p = canvas.parentElement; p && p.id !== 'message'; p = p.parentElement) {
              const style = getComputedStyle(p), rect = p.getBoundingClientRect();
              if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) &&
                (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) return true;
            }
            return false;
          }) }));
        assert.ok(metric.pageWidth <= width, 'WebKit: no viewport overflow');
        assert.ok(metric.scrollers >= 3, 'WebKit: local inline/display/table scrolling');
        assert.equal(metric.clipped, false, 'WebKit: no vertically clipped formulas');
        measurements.push({ light, ...metric });
      }
    }
    await page.screenshot({ path: path.join(evidence, 'webkit-mobile-formulas.png'), fullPage: true });
    const hosts = page.locator('#message [aria-label="View formula source"]');
    await hosts.nth(2).tap();
    await page.locator('[data-testid="formula-source"]').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'WebKit source does not overflow');
    await page.screenshot({ path: path.join(evidence, 'webkit-mobile-source.png'), fullPage: true });
    await page.locator('[aria-label="Show formula"]').tap();
    await page.waitForFunction(() => document.querySelectorAll('#message canvas').length === 6);
    const copied = await page.evaluate(() => {
      const root = document.querySelector('#message').firstChild, range = document.createRange();range.selectNodeContents(root);
      const selection = window.getSelection();selection.removeAllRanges();selection.addRange(range);
      const data = new DataTransfer(), event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
      root.dispatchEvent(event);document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return data.getData('text/plain');
    });
    assert.equal(copied, text, 'WebKit mixed Markdown copy keeps exact LaTeX');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-paseo-quote]')).display !== 'none');
    // Playwright's CSS locator pierces the original Quote's open shadow root.
    await page.locator('[data-paseo-quote] [data-action="quote"]').tap();
    assert.equal(await page.locator('[data-composer-input]').inputValue(),
      text.split('\n').map(line => line ? `> ${line}` : '>').join('\n') + '\n\n');
    await writeFile(path.join(evidence, 'webkit-mobile-results.json'), JSON.stringify(measurements, null, 2));
    return measurements;
  } finally { await browser.close(); }
}
