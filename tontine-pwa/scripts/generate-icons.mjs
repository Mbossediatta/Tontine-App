// Génère les icônes PWA (DESIGN-UI.md, section 8) : fond blanc, cercle vert clair,
// calebasse au centre. Usage : node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WHITE = [0xff, 0xff, 0xff];
const GREEN_300 = [0xa8, 0xe6, 0xc1];
const BLUE_700 = [0x1e, 0x5a, 0xa8];
const BLUE_900 = [0x12, 0x40, 0x7a];
const BLUE_DEEP = [0x0b, 0x2e, 0x5a];

// --- Encodage PNG ---------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profondeur
  header[9] = 2; // RVB
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Calebasse (coordonnées du logo : 200 × 150) ----------------------------

const ZIGZAG = [
  [22, 82],
  [38, 96],
  [54, 82],
  [70, 96],
  [86, 82],
  [102, 96],
  [118, 82],
  [134, 96],
  [150, 82],
  [166, 96],
  [180, 84],
];
const TRIANGLES = [
  [60, 110],
  [84, 115],
  [108, 115],
  [132, 110],
].map(([x, y]) => [
  [x, y],
  [x + 6, y + 11],
  [x - 6, y + 11],
]);

function inEllipse(x, y, cx, cy, rx, ry) {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}

/** Corps de la calebasse : courbes de Bézier quadratiques du logo. */
function inBowl(x, y) {
  if (y < 52 || y > 146) return false;
  const t = 1 - Math.sqrt(Math.max(0, 1 - (y - 52) / 94));
  const left = 8 + 92 * t * t;
  return x >= left && x <= 200 - left;
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inTriangle(px, py, [a, b, c]) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [px, py];
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

const mix = (a, b, alpha) => a.map((v, i) => v * (1 - alpha) + b[i] * alpha);

/** Couleur du logo au point (x, y), ou null en dehors. */
function logoColor(x, y) {
  if (inEllipse(x, y, 100, 54, 62, 9)) return GREEN_300;
  if (inEllipse(x, y, 100, 52, 82, 14)) return BLUE_DEEP;
  if (inEllipse(x, y, 100, 52, 92, 20)) return BLUE_900;
  if (!inBowl(x, y)) return null;
  if (TRIANGLES.some((tri) => inTriangle(x, y, tri))) return mix(BLUE_700, WHITE, 0.9);
  for (let i = 0; i < ZIGZAG.length - 1; i += 1) {
    if (distanceToSegment(x, y, ZIGZAG[i], ZIGZAG[i + 1]) <= 1.75) return GREEN_300;
  }
  return BLUE_700;
}

// --- Icône ----------------------------------------------------------------

/** `maskable` : motif réduit dans la zone sûre (marge de 20 %). */
function draw(size, maskable) {
  const pixels = Buffer.alloc(size * size * 3);
  const c = size / 2;
  const circleRadius = size * (maskable ? 0.4 : 0.48);
  const logoWidth = circleRadius * 1.3;
  const scale = logoWidth / 200;
  const originX = c - logoWidth / 2;
  const originY = c - (150 * scale) / 2 - 4 * scale;
  const samples = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          let color = Math.hypot(px - c, py - c) <= circleRadius ? GREEN_300 : WHITE;
          const logo = logoColor((px - originX) / scale, (py - originY) / scale);
          if (logo) color = logo;
          acc[0] += color[0];
          acc[1] += color[1];
          acc[2] += color[2];
        }
      }
      const n = samples * samples;
      const i = (y * size + x) * 3;
      pixels[i] = Math.round(acc[0] / n);
      pixels[i + 1] = Math.round(acc[1] / n);
      pixels[i + 2] = Math.round(acc[2] / n);
    }
  }
  return encodePng(size, pixels);
}

const outDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('icon-192.png', outDir), draw(192, false));
writeFileSync(new URL('icon-512.png', outDir), draw(512, false));
writeFileSync(new URL('icon-maskable-512.png', outDir), draw(512, true));
writeFileSync(new URL('apple-touch-icon.png', outDir), draw(180, true));
console.log('Icônes générées dans public/icons/');
