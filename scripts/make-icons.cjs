const { writeFileSync } = require('node:fs');
const zlib = require('node:zlib');

/*
 * A four-point star on the night sky the app already is — --bg #0a0a0b,
 * --accent #e8a33d, the same pair the arc's categories are drawn with.
 *
 * Written by hand: a PNG is the one artifact here that cannot be text, and a
 * build dependency for three small files would cost more than it saves.
 *
 * Supersampled 4x and boxed down, because the toolbar renders this at 16px and
 * an aliased star at 16px is a smudge.
 */
const BG = [0x0a, 0x0a, 0x0b];
const STAR = [0xe8, 0xa3, 0x3d];
const SS = 4;

function alpha(x, y, size) {
  const c = (size - 1) / 2;
  const reach = size * 0.46;
  const dx = (x - c) / reach, dy = (y - c) / reach;
  const r = Math.hypot(dx, dy);
  if (r > 1) return 0;
  // How close to an axis this pixel lies: 0 on the axis, 1 on the diagonal.
  const axis = Math.min(Math.abs(dx), Math.abs(dy)) / (r || 1e-9);
  const spike = (1 - r) ** 1.6 * Math.max(0, 1 - axis * 7) ** 2.2;
  const core = Math.max(0, 1 - r / 0.22) ** 1.4;
  return Math.min(1, spike * 2.4 + core * 1.9);
}

function render(size) {
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter: none
    for (let x = 0; x < size; x++) {
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          a += alpha(x + (sx + 0.5) / SS - 0.5, y + (sy + 0.5) / SS - 0.5, size);
        }
      }
      a /= SS * SS;
      for (let ch = 0; ch < 3; ch++) raw.push(Math.round(BG[ch] + (STAR[ch] - BG[ch]) * a));
      raw.push(255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(raw), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

let T = null;
function crc32(buf) {
  if (!T) { T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (const b of buf) c = T[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

for (const size of [16, 48, 128]) writeFileSync(`extension/icons/icon-${size}.png`, render(size));
console.log('wrote 16, 48, 128');
