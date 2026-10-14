// Draws QuantBot's icon (the price-line logo on a dark rounded tile) at every size Windows uses and packs the PNGs
// into installer/quantbot.ico. Run with: node installer/make-icon.mjs  (needs Chromium for playwright-core)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'quantbot.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Small sizes get a thicker, simpler line so they stay readable in the taskbar
const svg = (size) => {
  const small = size <= 32;
  const stroke = small ? 7 : 5.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34342f"/><stop offset="1" stop-color="#1f1f1d"/></linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3e9fe0"/><stop offset="1" stop-color="#7cc8f7"/></linearGradient>
  </defs>
  <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#bg)"/>
  <rect x="1.5" y="1.5" width="61" height="61" rx="13.5" fill="none" stroke="#45443f" stroke-width="1"/>
  ${small ? '' : '<line x1="12" y1="48" x2="52" y2="48" stroke="#4a4944" stroke-width="2" stroke-linecap="round"/>'}
  <path d="${small ? 'M10 42 L22 26 L32 34 L44 16 L54 22' : 'M11 42 L19 33 L26 37 L34 22 L41 28 L47 16 L53 20'}" fill="none" stroke="url(#line)" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
const pngs = [];
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  pngs.push(await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
await browser.close();

// ICO: 6-byte header, 16-byte entry per image, then the PNG data (PNG-in-ICO works on Windows Vista and later)
const header = Buffer.alloc(6 + 16 * SIZES.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(SIZES.length, 4);
let offset = header.length;
SIZES.forEach((size, k) => {
  const e = 6 + 16 * k;
  header.writeUInt8(size >= 256 ? 0 : size, e);
  header.writeUInt8(size >= 256 ? 0 : size, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[k].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[k].length;
});
fs.writeFileSync(out, Buffer.concat([header, ...pngs]));
console.log(`wrote ${out} (${SIZES.join(', ')} px)`);
