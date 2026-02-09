/**
 * Writes valid minimal PNG files to assets so expo prebuild (jimp) does not fail with CRC error.
 * Run from mobile/: node scripts/ensure-valid-assets.cjs
 */
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Smallest valid 1x1 PNG (transparent pixel) - 68 bytes, known to parse correctly in PNG readers
const VALID_PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQwAADgGAWjRcAAAAASUVORK5CYII=',
  'base64'
);

const ASSETS = ['icon.png', 'splash-icon.png', 'adaptive-icon.png', 'favicon.png'];

if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

for (const name of ASSETS) {
  const filePath = path.join(ASSETS_DIR, name);
  fs.writeFileSync(filePath, VALID_PNG_1X1);
  console.log('Written:', filePath);
}

console.log('Done. Replace these with proper 1024x1024 icons before release.');
