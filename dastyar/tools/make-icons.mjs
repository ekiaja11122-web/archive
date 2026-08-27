/**
 * ساخت آیکون‌های برنامه (PNG) بدون هیچ کتابخانهٔ بیرونی
 * اجرا:  node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // ۸ بیت، RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** فاصلهٔ نقطه تا پاره‌خط */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const BG = [15, 23, 42];       // سرمهٔ تیره
const ACCENT = [45, 212, 191]; // فیروزه‌ای

function draw(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const r = maskable ? 1 : 0.22;          // شعاع گوشه (نسبت به اندازه)
  const pad = maskable ? 0.18 : 0.0;       // حاشیهٔ امن برای آیکون ماسک‌دار

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const i = (y * size + x) * 4;

      // گوشهٔ گرد
      const rr = r * size;
      const cx = Math.min(Math.max(x, rr), size - rr);
      const cy = Math.min(Math.max(y, rr), size - rr);
      const inside = maskable ? true : Math.hypot(x - cx, y - cy) <= rr;
      if (!inside) { buf[i + 3] = 0; continue; }

      let color = BG;

      // حلقهٔ فیروزه‌ای
      const d = Math.hypot(u - 0.5, v - 0.5);
      const ring = 0.34 * (1 - pad);
      if (Math.abs(d - ring) < 0.035) color = ACCENT;

      // تیک وسط
      const t = 0.055 * (1 - pad);
      const s = (a) => 0.5 + (a - 0.5) * (1 - pad);
      const p1 = [s(0.34), s(0.52)], p2 = [s(0.45), s(0.63)], p3 = [s(0.68), s(0.38)];
      if (distToSegment(u, v, p1[0], p1[1], p2[0], p2[1]) < t
        || distToSegment(u, v, p2[0], p2[1], p3[0], p3[1]) < t) color = ACCENT;

      buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = 255;
    }
  }
  return png(size, size, buf);
}

const files = [
  ['icon-192.png', draw(192)],
  ['icon-512.png', draw(512)],
  ['icon-180.png', draw(180)],
  ['icon-maskable.png', draw(512, { maskable: true })],
  ['badge.png', draw(96)],
];
for (const [name, data] of files) {
  writeFileSync(join(OUT, name), data);
  console.log('ساخته شد:', name, Math.round(data.length / 1024) + 'KB');
}

writeFileSync(join(OUT, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#0f172a"/>
  <circle cx="50" cy="50" r="34" fill="none" stroke="#2dd4bf" stroke-width="7"/>
  <path d="M34 52 L45 63 L68 38" fill="none" stroke="#2dd4bf" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`);
console.log('ساخته شد: icon.svg');
