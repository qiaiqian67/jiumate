/**
 * A tiny ZIP writer, so the reader's tests can build the archives they need.
 *
 * Hand-built rather than taken from a library because most of what these tests check is
 * *malformed* input — a traversal name, a symlink mode, an encrypted flag, a header that lies
 * about its size. A real writer will not produce any of those, and a fixture that patches one
 * into a valid archive afterwards is harder to read than one that states the hostile field
 * outright.
 */
import { deflateRawSync } from "node:zlib";

export interface TestZipEntry {
  name: string;
  bytes?: Uint8Array;
  /** "stored" (default) or "deflate". */
  method?: "stored" | "deflate";
  /** Raw flag bits, e.g. `0x0001` for the encryption flag. */
  flags?: number;
  /** Unix mode bits, e.g. `0o120777` for a symlink. Written into the external attributes. */
  mode?: number;
  /** Overrides the uncompressed size the headers declare, to test a lying header. */
  declaredSize?: number;
  /** Overrides the compressed size the headers declare. */
  declaredCompressedSize?: number;
  /** Overrides the method the headers declare, to test an unsupported one. */
  declaredMethod?: number;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** Build an archive from the given entries. */
export function makeZip(entries: readonly TestZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = entry.bytes ?? new Uint8Array();
    const deflated = entry.method === "deflate";
    const payload = deflated ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = new TextEncoder().encode(entry.name);
    const method = entry.declaredMethod ?? (deflated ? 8 : 0);
    const flags = entry.flags ?? 0;
    const declaredSize = entry.declaredSize ?? raw.byteLength;
    const declaredCompressed = entry.declaredCompressedSize ?? payload.byteLength;
    const mode = entry.mode ?? 0o100644;
    const external = (mode << 16) >>> 0;

    const local = concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(flags),
      u16(method),
      u16(0), // time
      u16(0), // date
      u32(0), // crc32 — this reader does not verify it
      u32(declaredCompressed),
      u32(declaredSize),
      u16(name.byteLength),
      u16(0), // extra length
      name,
      payload,
    ]);

    centrals.push(
      concat([
        u32(0x02014b50),
        u16(0x031e), // version made by: Unix
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0),
        u32(0),
        u32(declaredCompressed),
        u32(declaredSize),
        u16(name.byteLength),
        u16(0), // extra length
        u16(0), // comment length
        u16(0), // disk start
        u16(0), // internal attributes
        u32(external),
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.byteLength;
  }

  const directory = concat(centrals);
  const eocd = concat([
    u32(0x06054b50),
    u16(0), // this disk
    u16(0), // disk with the directory
    u16(entries.length),
    u16(entries.length),
    u32(directory.byteLength),
    u32(offset),
    u16(0), // comment length
  ]);

  return concat([...locals, directory, eocd]);
}

/** The bytes of a tiny valid JPEG, enough for the image sniffing in the manifest validator. */
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
