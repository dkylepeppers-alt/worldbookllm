// Regenerates PWA/favicon PNGs from src/brand/mark.svg (a white manuscript
// page on the indigo accent, DESIGN.md). Re-run after any edit to mark.svg.
//
//   pnpm --filter @worldbookllm/web generate:icons
//
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const markSvg = readFileSync(join(webRoot, 'src/brand/mark.svg'));
const iconsDir = join(webRoot, 'public/icons');
mkdirSync(iconsDir, { recursive: true });

// The manifest icon at 512/192 doubles as the "maskable" purpose: the page's
// farthest corner (about 165px from the centre) sits inside the W3C maskable
// safe zone (the inner 80% circle, radius 204.8px on a 512 canvas), so one
// flat, full-bleed-background render satisfies both purposes.
const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32x32.png', size: 32 },
  { file: 'favicon-16x16.png', size: 16 },
];

for (const { file, size } of targets) {
  await sharp(markSvg, { density: (size / 512) * 96 * 4 })
    .resize(size, size)
    .png()
    .toFile(join(iconsDir, file));
  console.log(`wrote public/icons/${file} (${size}x${size})`);
}

// Modern browsers use a scalable SVG favicon directly.
writeFileSync(join(webRoot, 'public/favicon.svg'), markSvg);
console.log('wrote public/favicon.svg');
