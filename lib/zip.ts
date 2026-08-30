/**
 * A minimal ZIP reader and writer.
 *
 * Personal points with photos cannot travel as a single GeoJSON file, so an
 * export becomes an archive: `points.geojson` plus one JPEG per photographed
 * point. That is the only way the photos get off the device, so it is worth the
 * hundred lines rather than a dependency.
 *
 * Writing uses the stored method — no compression. JPEGs are already
 * compressed, so deflate would spend time to save nothing. Reading does handle
 * deflate, because a user who unzips an export and re-zips it with Finder or
 * Windows Explorer gets a deflated archive back, and being unable to read that
 * would be a nasty surprise at exactly the wrong moment.
 *
 * No ZIP64. It caps out at 4 GB, which a set of downscaled photos will not
 * approach; `makeZip` throws rather than writing a corrupt archive if it ever
 * does.
 */

/**
 * A byte array backed by a plain ArrayBuffer.
 *
 * Spelt out because `Uint8Array` alone now admits a SharedArrayBuffer backing,
 * which `Blob` will not accept.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export type ZipEntry = { name: string; data: Bytes };

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Flag bit 11: the filename is UTF-8 rather than the legacy code page. */
const UTF8_FLAG = 0x0800;

const MAX_SIZE = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Bytes): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date and time, which is what the format stores. */
function dosStamp(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export function makeZip(entries: ZipEntry[], now: Date = new Date()): Blob {
  const encoder = new TextEncoder();
  const { time, date } = dosStamp(now);

  const parts: BlobPart[] = [];
  const central: Bytes[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.data.length;
    if (size > MAX_SIZE) throw new Error(`${entry.name} is too large for a ZIP archive.`);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed
    lv.setUint32(22, size, true); // uncompressed
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(name, 30);

    parts.push(local, entry.data);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, CENTRAL_SIG, true);
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, UTF8_FLAG, true);
    dv.setUint16(10, 0, true); // stored
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, name.length, true);
    dv.setUint16(30, 0, true); // extra
    dv.setUint16(32, 0, true); // comment
    dv.setUint16(34, 0, true); // disk number
    dv.setUint16(36, 0, true); // internal attrs
    dv.setUint32(38, 0, true); // external attrs
    dv.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // disk with central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // comment length

  return new Blob([...parts, ...central, eocd], { type: "application/zip" });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export function looksLikeZip(bytes: Bytes): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function inflateRaw(data: Bytes): Promise<Bytes> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read compressed ZIP files.");
  }
  const stream = new Blob([data]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read every file in the archive.
 *
 * Walks the central directory rather than scanning for local headers: it is the
 * authoritative index, and the only way to be sure of an entry's real size when
 * a writer has used a trailing data descriptor.
 */
export async function readZip(buffer: ArrayBuffer): Promise<Map<string, Bytes>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // The end-of-central-directory record sits at the very end, unless there is a
  // trailing comment — hence the scan back over its maximum length.
  let eocd = -1;
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file is not a readable ZIP archive.");

  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  const files = new Map<string, Bytes>();
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIG) break;

    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    // The local header repeats the name and extra field, and its lengths are
    // allowed to differ from the central directory's — so the data offset has
    // to be computed from the local header, not assumed.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);

    if (!name.endsWith("/")) {
      if (method === 0) {
        files.set(name, raw);
      } else if (method === 8) {
        files.set(name, await inflateRaw(raw));
      } else {
        throw new Error(`Unsupported compression in ${name}.`);
      }
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}
