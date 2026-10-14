// Draws the installer wizard's side image (164 x 314, 24-bit BMP, the size NSIS expects): QuantBot's dark
// background with the blue price line and a faint grid. Run: node make-sidebar.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 164, H = 314;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build', 'installerSidebar.bmp');
const px = new Float64Array(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const k = (y * W + x) * 3;
  px[k] = px[k] * (1 - a) + r * a; px[k + 1] = px[k + 1] * (1 - a) + g * a; px[k + 2] = px[k + 2] * (1 - a) + b * a;
};

// Background: #34342f at the top to #1f1f1d at the bottom, with a soft blue glow behind the line
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const t = y / (H - 1);
  set(x, y, [0x34 + (0x1f - 0x34) * t, 0x34 + (0x1f - 0x34) * t, 0x2f + (0x1d - 0x2f) * t]);
  const d = Math.hypot((x - W / 2) / 90, (y - 120) / 70);
  if (d < 1) set(x, y, [95, 183, 242], 0.1 * (1 - d) ** 2);
}
// Faint grid
for (let y = 20; y < H; y += 24) for (let x = 0; x < W; x++) set(x, y, [255, 255, 255], 0.03);
for (let x = 10; x < W; x += 24) for (let y = 0; y < H; y++) set(x, y, [255, 255, 255], 0.03);

// The logo's price line, anti-aliased by distance to each segment
const pts = [[0, 30], [8, 22], [16, 26], [24, 12], [32, 18], [40, 8], [48, 15], [56, 6], [64, 12]].map(([x, y]) => [16 + x * 2.05, 70 + y * 2.05]);
const width = 3.2;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    d = Math.min(d, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
  }
  if (d < width + 6) set(x, y, [95, 183, 242], 0.12 * Math.max(0, 1 - (d - width) / 6));
  if (d < width + 1) set(x, y, [95, 183, 242], Math.max(0, Math.min(1, width + 0.5 - d)));
}
// Baseline under the line
for (let x = 16; x < W - 16; x++) set(x, 70 + 35 * 2.05, [0x3d, 0x3c, 0x38]);

// 24-bit BMP, rows bottom-up, each padded to 4 bytes
const row = Math.ceil((W * 3) / 4) * 4;
const buf = Buffer.alloc(54 + row * H);
buf.write('BM', 0); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10);
buf.writeUInt32LE(40, 14); buf.writeInt32LE(W, 18); buf.writeInt32LE(H, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
buf.writeUInt32LE(row * H, 34); buf.writeInt32LE(2835, 38); buf.writeInt32LE(2835, 42);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const k = (y * W + x) * 3, o = 54 + (H - 1 - y) * row + x * 3;
  buf[o] = Math.round(px[k + 2]); buf[o + 1] = Math.round(px[k + 1]); buf[o + 2] = Math.round(px[k]);
}
fs.writeFileSync(out, buf);
console.log(`Wrote ${out}`);
