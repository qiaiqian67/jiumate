/**
 * A minimal, deliberately narrow ZIP reader for theme imports.
 *
 * ## Why this is hand-written
 *
 * The alternative is a dependency. A reader for the two methods a theme archive actually uses —
 * `stored` and `deflate` — is small, and the hard part (decompression) is Node's built-in
 * `zlib`, so a library would buy battle-tested parsing in exchange for a supply-chain
 * dependency and a much larger surface than this needs. What a library would *not* buy is the
 * part that matters most here: the archive is untrusted input, and every check below is a
 * decision about what an attacker gets to name. Those are clearer stated than delegated.
 *
 * ## What it refuses
 *
 * A ZIP is a naming attack surface before it is a compression format.
 *
 *   - **Traversal.** `..`, a leading `/`, a backslash, a drive letter, a NUL. Anything that
 *     could resolve outside the extraction root.
 *   - **Nesting.** Entries must be one flat filename, optionally under a single shared top-level
 *     directory (the shape a `zip -r my-theme/` produces). A deeper path is refused rather than
 *     flattened, because flattening two `assets/background.jpg`-style entries would silently
 *     collide.
 *   - **Symlinks and other non-regular entries.** Refused by the external-attributes mode bits.
 *     Writing a symlink from an archive is how a later write escapes the root.
 *   - **Encryption.** Flag bit 0. This host has no password to offer and would otherwise read
 *     ciphertext as if it were the file.
 *   - **Any method but `stored` and `deflate`.** Refused by name, so an exotic method cannot
 *     fall through a default branch.
 *   - **ZIP64.** Refused rather than half-supported: a sentinel `0xffffffff` size or offset
 *     would otherwise be read as a literal 4 GiB.
 *
 * ## And what it bounds
 *
 * The declared sizes in a ZIP header are attacker-controlled, so they are used for *refusal*
 * and never for allocation. Decompression is capped with `zlib`'s `maxOutputLength`, and the
 * output length is then checked against the declared value — so a header that lies about being
 * small still cannot produce a large buffer.
 *
 * There is deliberately **no compression-ratio check**. `maxOutputLength` already stops a bomb
 * at exactly the same byte, and it stops it on the real output rather than on a header's claim;
 * a ratio ceiling on top of that adds no protection and rejects honest input, because a
 * repetitive file legitimately compresses far better than a photograph does.
 *
 * The archive's own byte length is checked by the caller before this runs.
 */
import { inflateRawSync } from "node:zlib";

/** What an archive may cost. Small on purpose: a theme is one image and one JSON file. */
export interface ZipLimits {
  /** Uncompressed bytes across every accepted entry. */
  maxTotalBytes: number;
  /** Uncompressed bytes of any single entry. */
  maxEntryBytes: number;
  /** Entries in the central directory, accepted or not. */
  maxEntries: number;
}

export const ZIP_LIMITS: ZipLimits = {
  // A theme is one JSON file plus one image. `ASSET_LIMIT` is 10 MiB, so 12 MiB for a single
  // entry leaves room for the manifest, and 32 MiB total leaves room for a preview as well.
  maxTotalBytes: 32 * 1024 * 1024,
  maxEntryBytes: 12 * 1024 * 1024,
  maxEntries: 64,
};

/**
 * The most bytes an uploaded archive may be.
 *
 * Equal to {@link ZIP_LIMITS}'s total rather than smaller: an archive of *stored* entries is as
 * large as its contents, so a tighter ceiling here would refuse an honest archive that the
 * entry limits would have accepted. The entry limits are what actually bound the work; this one
 * exists so an oversized upload is refused before it is buffered.
 */
export const ZIP_ARCHIVE_LIMIT = ZIP_LIMITS.maxTotalBytes;

/** One accepted member of the archive, named the way the extractor will write it. */
export interface ZipEntry {
  /** A flat filename: no directory part, no separators. */
  name: string;
  bytes: Uint8Array;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_MIN_BYTES = 22;
/** The EOCD comment is a 16-bit length, so the record cannot start further back than this. */
const MAX_COMMENT_BYTES = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** Flag bit 0: the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001;
/** Flag bit 3: sizes live in a trailing data descriptor. We read them from the CD, so it is fine. */
const FLAG_DATA_DESCRIPTOR = 0x0008;

/** Unix mode bits live in the high 16 bits of the external attributes, when made-by is Unix. */
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

/** `0xffffffff` in any size or offset field means "look in the ZIP64 record", which we refuse. */
const ZIP64_SENTINEL = 0xffffffff;

class Reader {
  private offset = 0;
  constructor(private readonly view: DataView) {}

  get position(): number {
    return this.offset;
  }

  seek(to: number): void {
    this.offset = to;
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  bytes(length: number): Uint8Array {
    this.need(length);
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return out;
  }

  private need(length: number): void {
    if (length < 0 || this.remaining < length) {
      throw new ZipError("Archive is truncated");
    }
  }
}

/**
 * Read every acceptable entry of an archive.
 *
 * Order follows the central directory. Entries that are directories are skipped rather than
 * refused — `zip -r` writes them for every folder, and rejecting the archive over one would
 * make the common case fail.
 */
export function readZipEntries(archive: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocd = findEndOfCentralDirectory(view);

  const reader = new Reader(view);
  reader.seek(eocd + 4);
  const diskNumber = reader.u16();
  const directoryDisk = reader.u16();
  const entriesOnDisk = reader.u16();
  const totalEntries = reader.u16();
  const directorySize = reader.u32();
  const directoryOffset = reader.u32();

  // Multi-disk archives cannot be read from one buffer, and a spanned archive that claims to be
  // single-disk is a lie worth refusing outright.
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ZipError("Multi-disk archives are not supported");
  }
  if (totalEntries === 0 || totalEntries === 0xffff || directoryOffset === ZIP64_SENTINEL) {
    // `0xffff` means "look in the ZIP64 record", which this reader does not parse.
    throw new ZipError(totalEntries === 0 ? "Archive has no entries" : "ZIP64 is not supported");
  }
  if (totalEntries > limits.maxEntries) {
    throw new ZipError(`Archive has more than ${String(limits.maxEntries)} entries`);
  }
  if (directoryOffset + directorySize > archive.byteLength) {
    throw new ZipError("Archive directory is out of bounds");
  }

  const raw: RawEntry[] = [];
  reader.seek(directoryOffset);
  for (let index = 0; index < totalEntries; index += 1) {
    if (reader.u32() !== CENTRAL_SIGNATURE) {
      throw new ZipError("Archive directory is malformed");
    }
    reader.u16(); // version made by
    reader.u16(); // version needed
    const flags = reader.u16();
    const method = reader.u16();
    reader.u16(); // mod time
    reader.u16(); // mod date
    reader.u32(); // crc32 — zlib verifies the stream for deflate; stored entries are copied as-is
    const compressedSize = reader.u32();
    const uncompressedSize = reader.u32();
    const nameLength = reader.u16();
    const extraLength = reader.u16();
    const commentLength = reader.u16();
    reader.u16(); // disk start
    reader.u16(); // internal attributes
    const externalAttributes = reader.u32();
    const localOffset = reader.u32();
    const nameBytes = reader.bytes(nameLength);
    reader.bytes(extraLength);
    reader.bytes(commentLength);

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
      throw new ZipError("ZIP64 is not supported");
    }
    if (localOffset === ZIP64_SENTINEL) throw new ZipError("ZIP64 is not supported");
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new ZipError("Encrypted archives are not supported");
    }

    const name = decodeName(nameBytes);
    const kind = entryKind(name, externalAttributes);
    if (kind === "directory") continue;
    if (kind === "other") {
      throw new ZipError(`Archive contains a non-regular entry: ${name}`);
    }

    raw.push({
      name,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
  }

  const stripped = stripSharedTopLevel(raw.map((entry) => entry.name));
  const entries: ZipEntry[] = [];
  let total = 0;
  for (const entry of raw) {
    const flat = stripped.get(entry.name);
    // An entry outside the single shared top-level directory. Refused rather than dropped: a
    // file the user put there is a file they expect to be imported, and silently ignoring it
    // produces a theme that is missing something with no explanation.
    if (flat === undefined) {
      throw new ZipError(`Archive entry is not a flat filename: ${entry.name}`);
    }
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      throw new ZipError(`Archive entry "${flat}" is too large`);
    }
    if (total + entry.uncompressedSize > limits.maxTotalBytes) {
      throw new ZipError("Archive expands beyond the allowed total size");
    }
    const bytes = readEntryBytes(archive, view, entry, limits);
    if (bytes.byteLength !== entry.uncompressedSize) {
      // A header that understates the output would otherwise slip past every cap above.
      throw new ZipError(`Archive entry "${flat}" does not match its declared size`);
    }
    total += bytes.byteLength;
    entries.push({ name: flat, bytes });
  }
  return entries;
}

interface RawEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

/** Walk back from the end for the EOCD signature, allowing for a trailing comment. */
function findEndOfCentralDirectory(view: DataView): number {
  if (view.byteLength < EOCD_MIN_BYTES) throw new ZipError("Archive is too small to be a ZIP");
  const lowest = Math.max(0, view.byteLength - EOCD_MIN_BYTES - MAX_COMMENT_BYTES);
  for (let at = view.byteLength - EOCD_MIN_BYTES; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      // The comment length must account for exactly the bytes after the record; otherwise this
      // is the signature appearing inside a comment or in file data.
      const commentLength = view.getUint16(at + 20, true);
      if (at + EOCD_MIN_BYTES + commentLength === view.byteLength) return at;
    }
  }
  throw new ZipError("Archive has no end-of-central-directory record");
}

/**
 * Decode an entry name, refusing anything that is not a plain ASCII filename.
 *
 * Names outside the allowlist this reader serves (`theme.json`, `background.jpg`, …) have no
 * legitimate reason to be here, and requiring ASCII sidesteps the flag-bit-11 UTF-8 question and
 * every Unicode normalisation trick that comes with it — including the ones that make a name
 * *look* like `background.jpg` while resolving elsewhere.
 */
function decodeName(bytes: Uint8Array): string {
  for (const byte of bytes) {
    if (byte === 0 || byte > 0x7f) {
      throw new ZipError("Archive contains a non-ASCII entry name");
    }
  }
  return new TextDecoder("ascii").decode(bytes);
}

/** Classify an entry by its name and Unix mode bits. */
function entryKind(name: string, externalAttributes: number): "file" | "directory" | "other" {
  // A trailing slash is the portable directory marker; the mode bits are the Unix one.
  if (name.endsWith("/")) return "directory";
  if (name === "" || name.includes("\0") || name.includes("\\")) {
    throw new ZipError(`Archive contains an unusable entry name: ${name}`);
  }
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw new ZipError(`Archive entry has an absolute path: ${name}`);
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ZipError(`Archive entry escapes the extraction root: ${name}`);
  }
  const mode = (externalAttributes >>> 16) & S_IFMT;
  if (mode === S_IFLNK) throw new ZipError(`Archive contains a symlink: ${name}`);
  if (mode === S_IFDIR) return "directory";
  if (mode !== 0 && mode !== S_IFREG) return "other";
  return "file";
}

/**
 * Map each entry to a flat filename, stripping a single shared top-level directory.
 *
 * Handles the two shapes people actually produce: `zip theme.json background.jpg` (flat already)
 * and `zip -r my-theme/` (one shared directory). Both are accepted, and so is a mix of a loose
 * manifest beside a nested image, because that is what zipping a folder from some file managers
 * produces.
 *
 * What is refused is depth beyond one directory and any two entries that would land on the same
 * flat name. Flattening is only safe while it stays injective: two `assets/background.jpg`-style
 * entries would otherwise become one file with the last write winning, and the theme would
 * silently carry the wrong image.
 *
 * Returns a name only for entries that survive; a caller that gets `undefined` for an entry
 * refuses the archive rather than dropping the file.
 */
function stripSharedTopLevel(names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const tops = new Set<string>();
  for (const name of names) {
    const segments = name.split("/");
    if (segments.length > 2) {
      throw new ZipError(`Archive entry is nested too deeply: ${name}`);
    }
    if (segments.length === 2) tops.add(segments[0] as string);
  }
  const strip = tops.size === 1 ? ([...tops][0] as string) : null;

  for (const name of names) {
    const segments = name.split("/");
    const flat = segments.length === 1 ? name : strip === null ? null : (segments[1] as string);
    if (flat === null) continue;
    if (out.has(flat)) {
      throw new ZipError(`Archive has two entries that flatten to the same name: ${flat}`);
    }
    out.set(name, flat);
  }
  return out;
}

/**
 * Read and decompress one entry's bytes.
 *
 * The local header is re-read rather than trusting the central directory's offset arithmetic:
 * the two name and extra lengths are allowed to differ, and skipping only the central
 * directory's values would read the wrong bytes for any archive that uses that latitude.
 */
function readEntryBytes(
  archive: Uint8Array,
  view: DataView,
  entry: RawEntry,
  limits: ZipLimits,
): Uint8Array {
  const reader = new Reader(view);
  reader.seek(entry.localOffset);
  if (reader.u32() !== LOCAL_SIGNATURE) {
    throw new ZipError(`Archive entry "${entry.name}" has no local header`);
  }
  reader.u16(); // version needed
  const localFlags = reader.u16();
  const localMethod = reader.u16();
  reader.u16(); // mod time
  reader.u16(); // mod date
  reader.u32(); // crc32
  const localCompressed = reader.u32();
  const localUncompressed = reader.u32();
  const nameLength = reader.u16();
  const extraLength = reader.u16();
  reader.bytes(nameLength);
  reader.bytes(extraLength);
  const dataStart = reader.position;

  if ((localFlags & FLAG_ENCRYPTED) !== 0) {
    throw new ZipError("Encrypted archives are not supported");
  }
  if (localMethod !== entry.method) {
    throw new ZipError(`Archive entry "${entry.name}" has inconsistent headers`);
  }
  // With a data descriptor the local sizes are zero and the central directory holds the truth.
  const useLocal = (localFlags & FLAG_DATA_DESCRIPTOR) === 0 && localUncompressed !== 0;
  const compressedSize = useLocal ? localCompressed : entry.compressedSize;

  if (dataStart + compressedSize > archive.byteLength) {
    throw new ZipError(`Archive entry "${entry.name}" is truncated`);
  }
  const payload = archive.subarray(dataStart, dataStart + compressedSize);

  if (entry.method === METHOD_STORED) {
    // A stored entry cannot expand, so the declared size is the real one — but it is still
    // checked against the per-entry cap before anything is allocated.
    if (payload.byteLength > limits.maxEntryBytes) {
      throw new ZipError(`Archive entry "${entry.name}" is too large`);
    }
    return new Uint8Array(payload);
  }
  if (entry.method !== METHOD_DEFLATE) {
    throw new ZipError(`Archive entry "${entry.name}" uses an unsupported compression method`);
  }
  try {
    // `maxOutputLength` is what makes this safe: zlib stops and throws rather than inflating a
    // bomb into memory. The declared size is only a refusal check on top of it.
    return new Uint8Array(inflateRawSync(payload, { maxOutputLength: limits.maxEntryBytes }));
  } catch (err) {
    throw new ZipError(`Archive entry "${entry.name}" could not be decompressed: ${String(err)}`);
  }
}

/** True when `bytes` starts with a local file header or an end-of-central-directory record. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const signature = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  // A self-extracting archive starts with an executable stub, so the local header is not at
  // offset 0 — `PK\x05\x06` (an empty archive) is the only other first-four-bytes case worth
  // accepting, and the EOCD scan handles the rest.
  return signature === LOCAL_SIGNATURE || signature === EOCD_SIGNATURE;
}
