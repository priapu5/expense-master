// Dependency-free PWA icon generator.
// Reads scripts/icon-source.png (the app logo) and writes the icon set into
// public/icons/: regular icons (full-bleed square), the maskable icon (content
// scaled to 80% over a blurred extension of the background so nothing is lost
// to circular masks), and the iOS home-screen icon.
// PNG decoding (inflate + unfilter) and encoding (zlib + CRC32) are
// hand-rolled — no npm deps.
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(SCRIPT_DIR, 'icon-source.png');
const OUT_DIR = join(SCRIPT_DIR, '..', 'public', 'icons');

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

// ---------- PNG decoding (8-bit RGB/RGBA, non-interlaced) ----------

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('icon-source.png is not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('icon-source.png must be 8-bit, non-interlaced');
  if (colorType !== 6 && colorType !== 2) throw new Error('icon-source.png must be RGB or RGBA');
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    const filter = raw[rowOff];
    const row = raw.subarray(rowOff + 1, rowOff + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const dst = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? dst[x - bpp] : 0;
      const up = prev ? prev[x] : 0;
      const ul = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (left + up) >> 1;
      else if (filter === 4) v += paeth(left, up, ul);
      dst[x] = v & 0xff;
    }
  }
  return { width, height, bpp, pixels: out };
}

// ---------- resampling ----------

/** Whole-image downscale by area averaging (each dest pixel averages the
 *  source pixels its footprint covers). */
function boxResample(src, sw, sh, bpp, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.floor(dy * sy);
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((dy + 1) * sy)));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.floor(dx * sx);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((dx + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * sw + x) * bpp;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const o = (dy * dw + dx) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}

/** Bilinear sample at float coords (clamped), always returns 4 channels. */
function bilinearSample(pix, w, h, bpp, x, y) {
  const cx = Math.min(Math.max(x, 0), w - 1.001);
  const cy = Math.min(Math.max(y, 0), h - 1.001);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const at = (xx, yy) => (yy * w + xx) * bpp;
  const o = [0, 0, 0, 0];
  for (let c = 0; c < 3; c++) {
    o[c] = (pix[at(x0, y0) + c] * (1 - fx) + pix[at(x1, y0) + c] * fx) * (1 - fy) +
      (pix[at(x0, y1) + c] * (1 - fx) + pix[at(x1, y1) + c] * fx) * fy;
  }
  o[3] = bpp === 4
    ? (pix[at(x0, y0) + 3] * (1 - fx) + pix[at(x1, y0) + 3] * fx) * (1 - fy) +
      (pix[at(x0, y1) + 3] * (1 - fx) + pix[at(x1, y1) + 3] * fx) * fy
    : 255;
  return o;
}

/** Upscale a small buffer with bilinear smoothing (used for the blur backdrop). */
function bilinearUpscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const s = bilinearSample(src, sw, sh, 4, ((x + 0.5) / dw) * sw - 0.5, ((y + 0.5) / dh) * sh - 0.5);
      out.set(s.map(Math.round), (y * dw + x) * 4);
    }
  }
  return out;
}

// ---------- the icon set ----------

/** Maskable icon: source scaled to 80% centered over a blurred extension of
 *  its own background, so circular masks never cut into the artwork. */
function renderMaskable(src, sw, sh, bpp, size) {
  const blur = bilinearUpscale(boxResample(src, sw, sh, bpp, 24, 24), 24, 24, size, size);
  const scale = 0.8;
  const inset = (size * (1 - scale)) / 2;
  const zoom = sw / (size * scale); // source px per dest px inside the content box
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x - inset) * zoom;
      const sy = (y - inset) * zoom;
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue; // keep blur
      const s = bilinearSample(src, sw, sh, bpp, sx, sy);
      const a = s[3] / 255;
      const o = (y * size + x) * 4;
      blur[o] = s[0] * a + blur[o] * (1 - a);
      blur[o + 1] = s[1] * a + blur[o + 1] * (1 - a);
      blur[o + 2] = s[2] * a + blur[o + 2] * (1 - a);
      blur[o + 3] = Math.min(255, blur[o + 3] + s[3] * (1 - blur[o + 3] / 255));
    }
  }
  return blur;
}

function averageColor(pix, w, h, bpp) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < h; y += 16) {
    for (let x = 0; x < w; x += 16) {
      const i = (y * w + x) * bpp;
      r += pix[i];
      g += pix[i + 1];
      b += pix[i + 2];
      n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

const src = decodePng(readFileSync(SOURCE));
const avg = averageColor(src.pixels, src.width, src.height, src.bpp);
console.log(`source: ${src.width}x${src.height}, average color #${avg.map((v) => v.toString(16).padStart(2, '0')).join('')}`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon-192.png'), encodePng(192, boxResample(src.pixels, src.width, src.height, src.bpp, 192, 192)));
writeFileSync(join(OUT_DIR, 'icon-512.png'), encodePng(512, boxResample(src.pixels, src.width, src.height, src.bpp, 512, 512)));
writeFileSync(join(OUT_DIR, 'apple-touch-icon.png'), encodePng(180, boxResample(src.pixels, src.width, src.height, src.bpp, 180, 180)));
writeFileSync(join(OUT_DIR, 'maskable-512.png'), encodePng(512, renderMaskable(src.pixels, src.width, src.height, src.bpp, 512)));
console.log('icons written to', OUT_DIR);
