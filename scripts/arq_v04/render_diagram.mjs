// render_diagram.mjs — screenshots the .canvas element of a diagram source
// (docs/assets/src/diagram_*.html) at deviceScaleFactor 2 (print quality,
// ~300dpi when embedded at body width). House procedure per docs/assets/README.md.
//
// Usage: node scripts/arq_v04/render_diagram.mjs [src.html] [out.png]
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const src = path.resolve(repo, process.argv[2] || 'docs/assets/src/diagram_arquitectura.html');
const out = path.resolve(repo, process.argv[3] || 'docs/assets/diagram_arquitectura.png');

if (!fs.existsSync(src)) {
  console.error(`diagram source not found: ${src}`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 2 });
await page.goto(url.pathToFileURL(src).href, { waitUntil: 'networkidle' });
const canvas = page.locator('.canvas');
await canvas.screenshot({ path: out });
await browser.close();
console.log(`diagram written: ${out}`);
