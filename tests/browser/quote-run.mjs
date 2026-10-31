import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { renderLatex } from "../../server/render.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const quote = path.resolve(process.env.QUOTE_SOURCE || path.join(root, "../quote"));
const evidence = path.resolve(process.env.RATEX_EVIDENCE || path.join(root, "../evidence"));
await mkdir(evidence, { recursive: true });
const revision = execFileSync("git", ["-C", quote, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(execFileSync("git", ["-C", quote, "status", "--porcelain"], { encoding: "utf8" }), "", "Quote must be unmodified");
const require = createRequire(path.join(process.env.RATEX_BROWSER_DEPS || root, "package.json"));
const { build } = require("esbuild");
const puppeteer = require("puppeteer-core");
const dep = (name) => path.dirname(require.resolve(`${name}/package.json`));
const errors = [];
const results = [];
const clientBundle = process.env.RATEX_CLIENT_BUNDLE ? await readFile(process.env.RATEX_CLIENT_BUNDLE, 'utf8') : null;
const hostServer = process.env.RATEX_RENDER_SERVER ? (await import(process.env.RATEX_RENDER_SERVER)).renderLatex : renderLatex;
const bundle = await build({ entryPoints: [path.join(root, "tests/browser/quote-entry.jsx")], bundle: true, write: false,
  format: "iife", jsx: "automatic", logLevel: "warning", alias: { react: dep("react"), "react-dom": dep("react-dom"),
    "react-native": dep("react-native-web"), "quote-under-test": path.join(quote, "client/web.ts") },
  plugins: [{ name: "paseo-host", setup(builder) {
    if (clientBundle) {
      builder.onResolve({filter:/index\.client\.tsx$/}, () => ({path:'ratex-built-client',namespace:'compiled'}));
      builder.onLoad({filter:/.*/,namespace:'compiled'}, () => ({loader:'js',contents:
        `import * as react from 'react';import * as jsx from 'react/jsx-runtime';import * as native from 'react-native';
         import * as query from '@tanstack/react-query';import * as zod from 'zod';
         import * as sdk from '@getpaseo/plugin';import * as client from '@getpaseo/plugin/client';import * as ui from '@getpaseo/plugin/client/ui';
         const modules={'react':react,'react/jsx-runtime':jsx,'react-native':native,'@tanstack/react-query':query,'zod':zod,
           '@getpaseo/plugin':sdk,'@getpaseo/plugin/client':client,'@getpaseo/plugin/client/ui':ui};
         const plugin=(${clientBundle})(name=>{if(!(name in modules))throw new Error('Unexpected host dependency '+name);return modules[name]});
         export default plugin.default;`,resolveDir:root}));
    }
    builder.onResolve({ filter: /^@getpaseo\/plugin(?:\/.*)?$/ }, ({ path: name }) => ({ path: name, namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, ({ path: name }) => ({ loader: "js", contents:
      name.endsWith("/client/ui") || name.endsWith("/client/react-native") ?
        `export const useToast=()=>({error:console.error});export const copyText=async text=>{await navigator.clipboard.writeText(text);window.copyWrites.push(text)};` :
      name.endsWith("/client") ? `export const useAgent=(id,select)=>select({cwd:'/repo'});export const openExternalUrl=async()=>{};
        export const useRpc=()=>async input=>(await fetch('/render',{method:'POST',body:JSON.stringify(input)})).json();` :
        `export const defineRpc=x=>x;` }));
  } }] });
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
    else if (req.url === "/render") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(await hostServer(JSON.parse(raw))));
    } else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta charset="utf-8"><style>body{margin:20px;font:15px sans-serif;color:#eee}#root{min-width:0}</style><div id="root"></div><script src="/bundle.js"></script>'); }
  } catch (error) { errors.push(String(error)); res.writeHead(500).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  await browser.defaultBrowserContext().overridePermissions(origin, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewport({ width: 1100, height: 1100, deviceScaleFactor: 1 });
  await page.goto(origin);
  await page.waitForSelector("canvas");
  const set = async (text) => {
    await page.evaluate((text) => { window.setMessage({ text }); document.querySelector('[data-composer-input]').value = ""; }, text);
    await page.waitForFunction((text) => document.querySelector("#message").dataset.source === text, {}, text);
    // Wait on the actual mapped source, not a timing-only delay.
    await page.waitForFunction((text) => {
      const leaves = [...document.querySelectorAll('#message [data-ratex-source]')];
      return leaves.length && document.querySelector('#message').textContent.length > 0 && window.sourceMarkdown(text).source === text;
    }, {}, text);
    await page.waitForFunction(() => document.querySelector('#message [data-ratex-source]'));
  };
  const select = async (startText, startOffset, endText, endOffset, reverse = false) => page.evaluate((input) => {
    const find = (text) => {
      const walk = document.createTreeWalker(document.querySelector("#message"), NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) if (walk.currentNode.textContent === text) return walk.currentNode;
      throw new Error(`Missing text ${JSON.stringify(text)} in ${document.querySelector('#message').textContent}`);
    };
    const a = find(input.startText), b = find(input.endText);
    const s = window.getSelection(); s.removeAllRanges();
    s.setBaseAndExtent(input.reverse ? b : a, input.reverse ? input.endOffset : input.startOffset,
      input.reverse ? a : b, input.reverse ? input.startOffset : input.endOffset);
    const transfer = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: transfer });
    const target = s.getRangeAt(0).startContainer.parentElement;
    target.dispatchEvent(event);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    return { text: transfer.getData("text/plain"), prevented: event.defaultPrevented };
  }, { startText, startOffset, endText, endOffset, reverse });
  const button = async (action) => {
    const handle = await page.evaluateHandle((action) => document.querySelector('[data-paseo-quote]').shadowRoot.querySelector(`[data-action="${action}"]`), action);
    await handle.click();
  };
  const bar = () => page.waitForFunction(() => getComputedStyle(document.querySelector('[data-paseo-quote]')).display !== "none");
  const full = async (text) => {
    await set(text);
    return page.evaluate(() => {
      const node = document.querySelector("#message");
      const range = document.createRange(); range.selectNodeContents(node.firstChild);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      const data = new DataTransfer(); const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
      range.startContainer.dispatchEvent(event);
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      return data.getData("text/plain");
    });
  };
  const sample = "已知函数：\n\n$f(x)=x^2+1$\n\n根据求导法则：\n\n$$\nf'(x)=2x\n$$\n\n因此导数为 $2x$。";
  for (const [name, text] of [
    ["plain", "Plain text only"], ["inline", "Before $x^2$ after"], ["display", "Before\n\n$$\nx^2\n$$\n\nAfter"],
    ["multiple", sample], ["delimiters", "First \\(a_i\\) then\n\n\\[\n\\frac{1}{2}\n\\]\n\nLast $z$"],
    ["markdown", "## Title $x$\n\n**bold $y$ text** and [docs](https://example.com/$x$).\n\n- [x] first $a$\n- second $b$\n\n| Value | TeX |\n|---|---|\n| first | $x$ |\n\n```js\nconst price = '$5';\n```"],
    ["code-and-math", "Use `price = $5` then $x$"], ["quote", "> First $x$\n> second\n\nEnd $y$"],
    ["table-only", "| Value | TeX |\n|---|---|\n| first | $x$ |"],
  ]) {
    assert.equal(await full(text), text, `${name}: exact raw Markdown`);
    await bar();
    await button("quote");
    const expected = text.split("\n").map((line) => line.trim() ? `> ${line}` : ">").join("\n") + "\n\n";
    assert.equal(await page.$eval('[data-composer-input]', (input) => input.value), expected, `${name}: real Quote composer`);
    results.push(name); console.log(`PASS ${name}: synthetic copy + original Quote -> composer`);
  }
  await set("Prefix alpha $x^2$ omega suffix");
  for (const reverse of [false, true]) {
    const copy = await select("Prefix alpha ", 7, " omega suffix", 6, reverse);
    assert.deepEqual(copy, { text: "alpha $x^2$ omega", prevented: true });
    await bar(); await button("quote");
    assert.equal(await page.$eval('[data-composer-input]', (input) => input.value), "> alpha $x^2$ omega\n\n");
    await page.$eval('[data-composer-input]', (input) => { input.value = ""; });
  }
  results.push("partial-and-reverse");
  assert.deepEqual(await select("Prefix alpha ", 2, "Prefix alpha ", 6), { text: "efix", prevented: true });
  results.push("partial-plain");
  assert.deepEqual(await select("$x^2$", 1, "$x^2$", 3), { text: "$x^2$", prevented: true });
  await bar(); await button("copy");
  await page.waitForFunction(() => window.copyWrites.at(-1) === "$x^2$");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "$x^2$");
  results.push("formula-atomic-copy");

  await full(sample); await bar(); await button("reply");
  await page.type('[data-paseo-quote] textarea', "Reply answer"); await button("add");
  const quoted = sample.split("\n").map((line) => line.trim() ? `> ${line}` : ">").join("\n");
  assert.equal(await page.$eval('[data-composer-input]', (input) => input.value), `${quoted}\n\nReply answer`);
  await full(sample); await bar(); await button("reply");
  await page.type('[data-paseo-quote] textarea', "Send answer"); await button("send");
  await page.waitForFunction(() => window.calls.some((call) => call.type === "send"));
  assert.equal(await page.evaluate(() => window.calls.find((call) => call.type === "send").text), `${quoted}\n\nSend answer`);
  await full(sample); await bar(); await button("side");
  await page.type('[data-paseo-quote] textarea', "Explain"); await button("ask");
  await page.waitForFunction(() => window.calls.some((call) => call.type === "panel"));
  assert.equal(await page.evaluate(() => window.calls.find((call) => call.type === "side").input.prompt), `${quoted}\n\nExplain`);
  results.push("reply-add-send-side-chat");
  console.log("PASS original Quote Reply/Add/Send/Side chat through host API fixture");

  const reject = await page.evaluate(() => {
    const s = window.getSelection(); const root = document.querySelector('#message').firstChild;
    const dispatch = () => { const data = new DataTransfer(); const e = new ClipboardEvent('copy', { bubbles:true, cancelable:true, clipboardData:data }); root.dispatchEvent(e); return e.defaultPrevented; };
    s.removeAllRanges(); const empty = dispatch();
    const r = document.createRange(); r.setStart(root,0); r.setEnd(document.querySelector('#other-message').firstChild,5); s.addRange(r);
    const crossMessage = dispatch();
    return { empty, crossMessage };
  });
  assert.deepEqual(reject, { empty: false, crossMessage: false }); results.push("ownership-empty");
  for (let index = 0; index < 8; index++) {
    await page.evaluate((key) => window.setMessage({ mounted: false, key }), index);
    await page.waitForFunction(() => !document.querySelector('#message [data-ratex-source]'));
    await page.evaluate(() => window.setMessage({ mounted: true }));
    assert.equal(await full("Session $x$ after"), "Session $x$ after");
  }
  await page.evaluate(() => window.toggleQuote(false));
  assert.equal(await full("Independent $x$ works"), "Independent $x$ works");
  assert.equal(await page.$('[data-paseo-quote]'), null);
  await page.evaluate(() => window.toggleQuote(true));
  results.push("session-remount-independent");

  // Actual mouse drag -> unchanged Quote toolbar -> composer, not a Range-only test.
  await page.setViewport({ width: 1100, height: 1100, deviceScaleFactor: 1 });
  const dragged = "Mouse start $a_i$\n\n$$\\frac{1}{x}$$\n\nMouse end $b$ tail";
  await full(dragged);
  await page.waitForFunction(() => document.querySelectorAll('#message canvas').length === 3);
  const points = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('#message [data-ratex-source]')];
    const point = (text, end) => {
      const leaf = texts.find((node) => node.textContent === text);
      const r = document.createRange(); r.setStart(leaf.firstChild,end ? leaf.textContent.length : 0); r.collapse(true);
      const rect = r.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    };
    window.getSelection().removeAllRanges();
    return { start: point('Mouse start ',false), end: point(' tail',true) };
  });
  await page.mouse.move(points.start.x, points.start.y); await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 35 }); await page.mouse.up();
  await bar(); await button('quote');
  assert.equal(await page.$eval('[data-composer-input]', input => input.value), dragged.split('\n').map(line=>line ? `> ${line}` : '>').join('\n')+'\n\n');
  results.push('real-mouse-mixed-quote');

  // One unrelated slow face must not keep already-loaded math in stale bitmaps.
  // Use real delayed font responses, not a mocked renderer or font metrics.
  const cold = await browser.newPage();
  let releaseFaces, releaseSlowFace;
  const faces = new Promise(resolve => { releaseFaces = resolve; });
  const slowFace = new Promise(resolve => { releaseSlowFace = resolve; });
  let requestedFaces = 0;
  await cold.setRequestInterception(true);
  cold.on('request', async request => {
    if (!request.url().startsWith('http://ratex-font.test/')) return request.continue();
    const index = requestedFaces++;
    await faces;
    if (index === 0) await slowFace;
    await request.respond({ status: 200, contentType: 'font/woff2',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(new URL(request.url()).searchParams.get('data'), 'base64') });
  });
  await cold.evaluateOnNewDocument(() => {
    const append = Node.prototype.appendChild;
    Node.prototype.appendChild = function(child) {
      if (child.tagName === 'STYLE' && child.id?.startsWith('ratex-formula-katex-fonts-')) {
        child.textContent = child.textContent.replace(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g,
          (_, data) => `http://ratex-font.test/face.woff2?data=${encodeURIComponent(data)}`);
      }
      return append.call(this, child);
    };
  });
  try {
    await cold.setViewport({ width: 900, height: 450, deviceScaleFactor: 1 });
    await cold.goto(origin, { waitUntil: 'domcontentloaded' });
    await cold.waitForFunction(() => window.setMessage);
    await cold.evaluate(() => window.setMessage({
      text: String.raw`活动集 $\mathcal{A}(x)$ 是分到了任务的站点的集合。“恰好是 $Q$”指： $x^2+\sum_i^n a_i$`,
    }));
    await cold.waitForFunction(() => document.querySelectorAll('#message canvas').length === 3);
    releaseFaces();
    await cold.waitForFunction(() => [...document.fonts].filter(face => face.status === 'loaded').length === 19);
    await cold.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bitmaps = () => cold.$$eval('#message canvas', canvases => canvases.map(canvas => canvas.toDataURL()));
    const initial = await bitmaps();
    await cold.screenshot({ path: path.join(evidence, 'inline-partial-fonts.png') });
    for (let index = 0; index < 3; index++) {
      await (await cold.$$('#message [aria-label="View formula source"]'))[index].click({ count: 2 });
      await cold.waitForSelector('[aria-label="Show formula"]');
      await cold.click('[aria-label="Show formula"]');
      await cold.waitForFunction(() => document.querySelectorAll('#message canvas').length === 3);
      await cold.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok((await bitmaps()).every((bitmap, i) => bitmap === initial[i]),
        `formula ${index}: source toggle must not be needed to refresh loaded fonts`);
    }
    results.push('partial-font-readiness-without-source-toggle');
  } finally {
    releaseFaces(); releaseSlowFace();
    await cold.evaluate(async () => document.fonts.ready);
    await cold.close();
  }

  // Exact listener accounting on detached roots proves cleanup on session changes.
  const cleanup = await page.evaluate(async () => {
    const oldRoot = document.querySelector('#message').firstChild;
    const oldCanvas = oldRoot.querySelector('canvas');
    let calls = 0;
    const original = oldRoot.removeEventListener;
    oldRoot.removeEventListener = function(type, ...args) { if(type === 'copy') calls++; return original.call(this,type,...args); };
    window.setMessage({ mounted: false });
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return { calls, detached: !oldRoot.isConnected, canvasDetached: !oldCanvas.isConnected };
  });
  assert.deepEqual(cleanup, { calls:1, detached:true, canvasDetached:true });
  await page.evaluate(()=>window.setMessage({mounted:true}));
  results.push('listener-cleanup');

  // Measure painted ink against an oversized reference, not merely nonzero canvas dimensions.
  const formulas = [String.raw`\frac{1}{\frac{x_i^2}{y^3}}`, String.raw`\sum_{i=1}^{n}x_i`, String.raw`\int_0^\infty e^{-x^2}\,dx`,
    String.raw`\begin{aligned}a&=b+c\\d&=\frac{x}{y}\end{aligned}`, String.raw`\begin{cases}x^2&x>0\\0&x\le0\end{cases}`,
    String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`, Array.from({length:65},(_,i)=>`x_{${i}}`).join('+')];
  for (const dpr of [1, 1.25, 2]) {
    await page.setViewport({ width: dpr === 1 ? 1100 : 390, height: 1100, deviceScaleFactor: dpr });
    await page.waitForFunction(dpr => window.devicePixelRatio === dpr, {}, dpr);
    for (const light of [false, true]) {
      await page.evaluate((light) => window.setMessage({ light }), light);
      await full(formulas.map((latex) => `$$${latex}$$`).join('\n\n'));
      await page.waitForFunction((n) => document.querySelectorAll('#message canvas').length === n, {}, formulas.length);
      await page.evaluate(async () => document.fonts.ready);
      // ResizeObserver and font completion can schedule the repaint after the RPC
      // resolves. Observe the resulting DPR-sized bitmap, not merely canvas count.
      await page.waitForFunction(() => [...document.querySelectorAll('#message canvas')].every(canvas =>
        Math.abs(canvas.getBoundingClientRect().width * window.devicePixelRatio - canvas.width) < 1));
      const ink = await page.$$eval('#message canvas', (canvases) => canvases.map((canvas) => {
        const {width,height}=canvas; const data=canvas.getContext('2d').getImageData(0,0,width,height).data;
        let minX=width,minY=height,maxX=-1,maxY=-1;
        for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
        return {width,height,minX,minY,maxX,maxY,css:canvas.getBoundingClientRect().width};
      }));
      for (const box of ink) {
        assert.ok(box.maxX >= box.minX && box.maxY >= box.minY, 'formula has painted ink');
        assert.ok(box.minX > 0 && box.minY > 0 && box.maxX < box.width-1 && box.maxY < box.height-1, `ink is not clipped ${JSON.stringify(box)}`);
        assert.ok(Math.abs(box.css*dpr-box.width)<1,'CSS size agrees with device pixels');
      }
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('#message *')].some((node) => getComputedStyle(node).overflowX === 'scroll' && node.scrollWidth > node.clientWidth)), 'wide display formula has horizontal scrolling');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),'no viewport overflow');
      await page.screenshot({ path:path.join(evidence, `formulas-${dpr}-${light?'light':'dark'}.png`),fullPage:true });
    }
  }
  // Ink equality against a generously sized *test-only* reference catches lost pixels.
  const referenceResults = [];
  for (const latex of formulas.slice(0,6)) {
    const rendered = await renderLatex({latex,displayMode:true,color:'#eee'});
    assert.ok(rendered.ok);
    referenceResults.push(await page.evaluate((list) => {
      const pixels = canvas => {
        const {width,height}=canvas, data=canvas.getContext('2d').getImageData(0,0,width,height).data;
        let minX=width,minY=height,maxX=-1,maxY=-1;
        for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
        return {minX,minY,maxX,maxY};
      };
      const actual=document.createElement('canvas'); window.drawFormula(list,actual,30,4,'transparent');
      const reference=document.createElement('canvas');
      window.referenceCanvas({...list,width:list.width+20,height:list.height+20,depth:list.depth??0,
        items:list.items.map(item=>({...item,x:typeof item.x==='number'?item.x+10:item.x,y:typeof item.y==='number'?item.y+10:item.y}))},reference,{fontSize:30,padding:4,backgroundColor:'transparent'});
      const a=pixels(actual), b=pixels(reference);
      return {width:a.maxX-a.minX,referenceWidth:b.maxX-b.minX,height:a.maxY-a.minY,referenceHeight:b.maxY-b.minY};
    },rendered.displayList));
  }
  for(const box of referenceResults){assert.equal(box.width,box.referenceWidth);assert.equal(box.height,box.referenceHeight);}
  await writeFile(path.join(evidence,'ink-reference.json'),JSON.stringify(referenceResults,null,2));

  // Tall inline fractions must fit their actual line boxes, including inside table cells.
  await full('Top line\n\nInline $\\frac{1}{\\frac{x^2}{y_i}}$ after\n\nBottom line\n\n| Tall | End |\n|---|---|\n| $\\sum_{i=1}^n x_i$ | done |');
  await page.waitForFunction(()=>document.querySelectorAll('#message canvas').length===2);
  const inlineBoxes=await page.$$eval('#message canvas',canvases=>canvases.map(canvas=>{
    const box=canvas.getBoundingClientRect();const clipped=[];
    for(let p=canvas.parentElement;p&&p.id!=='message';p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(['hidden','clip','scroll','auto'].includes(s.overflowY)&&(box.top<r.top-1||box.bottom>r.bottom+1))clipped.push(p.tagName);}
    return {clipped,height:box.height};
  }));
  for(const box of inlineBoxes){assert.deepEqual(box.clipped,[]);assert.ok(box.height>15);}
  await page.screenshot({path:path.join(evidence,'inline-tall-formulas.png'),fullPage:true});
  results.push('ink-reference-and-inline-parent-clipping');

  results.push("ink-fractions-matrix-sum-integral-aligned-cases-scroll-theme-dpr");
  assert.deepEqual(await page.evaluate(() => window.transformers), ['assistant_message']);
  const alignment = await page.evaluate(() => {
    const user=document.querySelector('#native-user'), bubble=user.firstElementChild;
    const message=document.querySelector('#message'), text=message.querySelector('[data-ratex-source]');
    const u=user.getBoundingClientRect(), b=bubble.getBoundingClientRect(), m=message.getBoundingClientRect(), t=text.getBoundingClientRect();
    return {userRight:Math.abs(u.right-b.right)<1,assistantLeft:Math.abs(m.left-t.left)<1};
  });
  assert.deepEqual(alignment,{userRight:true,assistantLeft:true});
  results.push("native-user-not-transformed");
  await full(sample); await bar();
  await page.screenshot({ path:path.join(evidence,'quote-mixed-selection.png'),fullPage:true });
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence,'quote-results.json'),JSON.stringify({quoteCommit:revision,builtClient:Boolean(clientBundle),results,errors},null,2));
  console.log(`PASS ${results.length} integration groups; original Quote ${revision}; no browser/RPC errors`);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise((resolve)=>server.close(resolve)); }
