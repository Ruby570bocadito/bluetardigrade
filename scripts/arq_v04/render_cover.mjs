// render_cover.mjs — renders docs/assets/src/cover-v0.4.html to a single-page
// vector PDF (A4 @ 96dpi: 794x1123 px). Uses page.pdf() so the text stays
// selectable/sharp (vector), never a screenshot. Equivalent of the house
// pattern used for cover-v0.1..v0.3.
//
// Usage: node scripts/arq_v04/render_cover.mjs [src.html] [out.pdf]
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const src = path.resolve(repo, process.argv[2] || 'docs/assets/src/cover-v0.4.html');
const out = path.resolve(repo, process.argv[3] || 'docs/arquitectura-tecnica-v0.4.cover.pdf');

if (!fs.existsSync(src)) {
  console.error(`cover source not found: ${src}`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await page.goto(url.pathToFileURL(src).href, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: out,
  width: '794px',
  height: '1123px',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
await browser.close();
console.log(`cover written: ${out}`);
