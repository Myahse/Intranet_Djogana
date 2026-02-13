/**
 * Generates valid square PNG placeholder icons for Expo.
 * Run from mobile/: node scripts/ensure-valid-assets.cjs
 *
 * Produces solid-color square PNGs at the sizes Expo expects:
 *   icon.png           – 1024x1024
 *   adaptive-icon.png  – 1024x1024
 *   splash-icon.png    – 1024x1024
 *   favicon.png        –   48x48
 *
 * Replace these with real artwork before releasing to stores.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// ── CRC-32 (ISO 3309 / PNG spec) ──────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG helpers ────────────────────────────────────────────────────────────
function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Create a solid-colour square RGBA PNG.
 * @param {number} size   Width & height in pixels.
 * @param {number} r      Red   0-255
 * @param {number} g      Green 0-255
 * @param {number} b      Blue  0-255
 * @param {number} [a=255] Alpha 0-255
 */
function createSquarePng(size, r, g, b, a = 255) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR – 13 bytes: width(4) height(4) bitDepth(1) colourType(1) compression(1) filter(1) interlace(1)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // colour type 6 = RGBA
  const ihdr = makeChunk('IHDR', ihdrData);

  // Raw image data: each scanline = 1 filter-byte (0=None) + size*4 RGBA bytes
  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = off + 1 + x * 4;
      raw[px]     = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }
  const idat = makeChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));

  // IEND
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ── Generate assets ────────────────────────────────────────────────────────
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

const ASSETS = [
  { name: 'icon.png',          size: 1024, r: 0, g: 0, b: 0 },
  { name: 'adaptive-icon.png', size: 1024, r: 0, g: 0, b: 0 },
  { name: 'splash-icon.png',   size: 1024, r: 0, g: 0, b: 0 },
  { name: 'favicon.png',       size:   48, r: 0, g: 0, b: 0 },
];

for (const { name, size, r, g, b } of ASSETS) {
  const filePath = path.join(ASSETS_DIR, name);
  const png = createSquarePng(size, r, g, b);
  fs.writeFileSync(filePath, png);
  console.log(`Written ${size}x${size} PNG: ${filePath}`);
}

console.log('\nDone. Replace these placeholders with proper icons before release.');
