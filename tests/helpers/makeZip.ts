import { deflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP writer for fixtures — stored or deflated entries, no ZIP64.
 * Enough structure for src/capture/instagramZip.ts to read; CRCs are left
 * zero because the reader (like most) never checks them.
 */
export function makeZip(entries: [name: string, content: string, deflate?: boolean][]): ArrayBuffer {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content, deflate] of entries) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(content);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, method, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, raw.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let cursor = 0;
  for (const c of all) {
    out.set(c, cursor);
    cursor += c.length;
  }
  return out.buffer;
}
