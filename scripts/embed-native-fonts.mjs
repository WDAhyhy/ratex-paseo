import { readFile, writeFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const root = new URL('../', import.meta.url);
const directory = new URL('node_modules/ratex-wasm/fonts/', root);
const files = (await readdir(directory)).filter(name => name.endsWith('.ttf')).sort();
const chunks = [], entries = [];
let offset = 0;
for (const file of files) {
  const bytes = await readFile(new URL(file, directory));
  entries.push([file.replace(/^KaTeX_/, '').replace(/\.ttf$/, ''), offset, bytes.length]);
  chunks.push(bytes); offset += bytes.length;
}
await writeFile(new URL('server/vendor/native-fonts.ts', root),
  '// Generated from pinned ratex-wasm KaTeX TTF fonts; see client/vendor/FONT-LICENSE.txt.\n' +
  `export const NATIVE_FONT_INDEX = ${JSON.stringify(entries)} as const;\n` +
  `export const NATIVE_FONTS_GZIP = ${JSON.stringify(gzipSync(Buffer.concat(chunks)).toString('base64'))};\n`);
console.log(`Embedded ${files.length} native font faces`);
