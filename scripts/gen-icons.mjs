// Dependency-free PWA icon generator.
// Draws the app logo (green rounded square + white receipt + three bars) into an
// RGBA pixel buffer, then hand-encodes PNG (zlib + CRC32, no npm deps).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---------- PNG encoding ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- drawing helpers ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Coverage (0..1, ~1px anti-aliased) of a rounded rectangle at pixel (px,py).
function roundedRect(px, py, x, y, w, h, r) {
  const cx = clamp(px, x + r, x + w - r);
  const cy = clamp(py, y + r, y + h - r);
  const dist = Math.hypot(px - cx, py - cy) - r;
  return clamp(0.5 - dist, 0, 1);
}

function circle(px, py, cx, cy, r) {
  return clamp(r - Math.hypot(px - cx, py - cy) + 0.5, 0, 1);
}

const lerp = (a, b, t) => a + (b - a) * t;

// Composite `src` (rgba) over `dst` (rgba) with coverage a.
function over(dst, src, a) {
  const sa = src[3] * a;
  const oa = dst[3] + sa * (1 - dst[3]);
  if (oa === 0) return dst.fill(0);
  dst[0] = (src[0] * sa + dst[0] * dst[3] * (1 - sa)) / oa;
  dst[1] = (src[1] * sa + dst[1] * dst[3] * (1 - sa)) / oa;
  dst[2] = (src[2] * sa + dst[2] * dst[3] * (1 - sa)) / oa;
  dst[3] = oa;
  return dst;
}

// ---------- the logo ----------
function render(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size;
  const top = [20, 148, 96];
  const bottom = [7, 106, 67];
  const barCols = [
    [10, 122, 75],
    [46, 160, 106],
    [125, 201, 159],
  ];

  // Receipt card geometry
  const cw = s * 0.5;
  const ch = s * 0.66;
  const cx = (s - cw) / 2;
  const cy = s * 0.165;
  const cr = s * 0.06;

  const bgRadius = maskable ? 0 : s * 0.23;
  const cardScale = maskable ? 0.86 : 1;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      // Background: vertical gradient
      const t = y / (s - 1);
      const bg = [lerp(top[0], bottom[0], t), lerp(top[1], bottom[1], t), lerp(top[2], bottom[2], t), 1];
      const px = x + 0.5;
      const py = y + 0.5;
      let a = roundedRect(px, py, 0, 0, s, s, bgRadius);
      let col = [bg[0] * a, bg[1] * a, bg[2] * a, a];

      // Receipt card (scaled toward center for maskable safe zone)
      const ccx = s / 2 + (cx - s / 2) * cardScale;
      const ccy = s / 2 + (cy - s / 2) * cardScale;
      const ccw = cw * cardScale;
      const cch = ch * cardScale;
      const cardA = roundedRect(px, py, ccx, ccy, ccw, cch, cr * cardScale);
      if (cardA > 0) over(col, [255, 255, 255, 1], cardA);

      // Three bars on the card (pills)
      const barH = cch * 0.07;
      const barX = ccx + ccw * 0.15;
      const widths = [0.6, 0.42, 0.5];
      for (let b = 0; b < 3; b++) {
        const by = ccy + cch * (0.32 + b * 0.14);
        const bw = ccw * widths[b];
        const barA = roundedRect(px, py, barX, by, bw, barH, barH / 2);
        if (barA > 0) over(col, [...barCols[b], 1], barA);
      }

      // Amber coin accent at the card's bottom-right corner
      const coinR = s * 0.075;
      const coinCx = ccx + ccw * 0.85;
      const coinCy = ccy + cch * 0.9;
      const coinA = circle(px, py, coinCx, coinCy, coinR);
      if (coinA > 0) {
        over(col, [245, 166, 35, 1], coinA);
        // coin ring (inner circle punched back to card white)
        const holeA = circle(px, py, coinCx, coinCy, coinR * 0.55);
        if (holeA > 0) over(col, [255, 255, 255, 1], holeA);
      }

      rgba[i] = col[0];
      rgba[i + 1] = col[1];
      rgba[i + 2] = col[2];
      rgba[i + 3] = Math.round(col[3] * 255);
    }
  }
  return encodePng(s, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon-192.png'), render(192, { maskable: false }));
writeFileSync(join(OUT_DIR, 'icon-512.png'), render(512, { maskable: false }));
writeFileSync(join(OUT_DIR, 'maskable-512.png'), render(512, { maskable: true }));
writeFileSync(join(OUT_DIR, 'apple-touch-icon.png'), render(180, { maskable: false }));
console.log('icons written to', OUT_DIR);
