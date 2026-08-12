/**
 * make-icons.mjs
 *
 * Generates the PWA icon set. Written by hand rather than pulled from an image
 * library so the build has no binary asset dependencies - run `npm run icons`
 * to regenerate.
 *
 * Design: dark felt background, a white playing card, and a red diamond pip.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(ROOT, 'icons');

const FELT = [15, 27, 20, 255];       // page background
const CARD = [253, 253, 248, 255];    // card face
const PIP = [210, 31, 60, 255];       // diamond red

/* ---------- PNG encoding ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));

  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encode raw RGBA pixels as a PNG buffer.
 * @param {number} size - Width and height in pixels
 * @param {Uint8Array} pixels - RGBA data, size*size*4 bytes
 */
function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bit depth
  header[9] = 6;   // colour type: RGBA
  header[10] = 0;  // deflate
  header[11] = 0;  // adaptive filtering
  header[12] = 0;  // no interlace

  // Each scanline is prefixed with its filter type (0 = none)
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- drawing ---------- */

/** Signed distance style test for a rounded rectangle */
function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;

  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;

  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Render one icon.
 * @param {number} size - Icon edge length
 * @param {boolean} maskable - Pad the artwork so Android's safe zone can crop it
 */
function drawIcon(size, maskable = false) {
  const pixels = new Uint8Array(size * size * 4);

  // A maskable icon may be cropped to a circle, so keep art inside ~80%
  const inset = maskable ? size * 0.22 : size * 0.14;
  const cardLeft = inset;
  const cardRight = size - inset;
  const cardTop = inset * 0.82;
  const cardBottom = size - inset * 0.82;
  const cardRadius = size * 0.07;

  const cx = size / 2;
  const cy = size / 2;
  const pipRadius = (cardRight - cardLeft) * 0.3;

  // Supersample so the curves don't alias badly at small sizes
  const SAMPLES = 3;
  const step = 1 / SAMPLES;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;

          let colour = FELT;

          if (insideRoundedRect(px, py, cardLeft, cardTop, cardRight, cardBottom, cardRadius)) {
            colour = CARD;

            // Diamond pip: |dx| + |dy| <= r, squashed slightly vertically
            const dx = Math.abs(px - cx);
            const dy = Math.abs(py - cy) * 0.78;
            if (dx + dy <= pipRadius) {
              colour = PIP;
            }
          }

          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += colour[3];
        }
      }

      const n = SAMPLES * SAMPLES;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
      pixels[i + 3] = Math.round(a / n);
    }
  }

  return encodePng(size, pixels);
}

/* ---------- svg ---------- */

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f1b14"/>
  <rect x="72" y="59" width="368" height="394" rx="36" fill="#fdfdf8"/>
  <path d="M256 168 L322 256 L256 344 L190 256 Z" fill="#d21f3c"/>
</svg>
`;

/* ---------- output ---------- */

mkdirSync(ICON_DIR, { recursive: true });

writeFileSync(join(ICON_DIR, 'icon.svg'), svg);
writeFileSync(join(ICON_DIR, 'icon-180.png'), drawIcon(180));
writeFileSync(join(ICON_DIR, 'icon-192.png'), drawIcon(192));
writeFileSync(join(ICON_DIR, 'icon-512.png'), drawIcon(512));
writeFileSync(join(ICON_DIR, 'icon-maskable-512.png'), drawIcon(512, true));

console.log('Wrote icons to', ICON_DIR);
