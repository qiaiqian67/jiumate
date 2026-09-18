/**
 * Minimal asar reader — enough to list and read named files out of an Electron
 * `app.asar`, and nothing more.
 *
 * Why hand-rolled: the only consumer is the Codex pet importer (`pet-external.ts`),
 * which reads a handful of entries out of another app's archive. `@electron/asar`
 * is build tooling that happens to be in the tree as a transitive dependency of
 * electron-builder; depending on it at runtime would pull a CLI, a globber and a
 * minimatcher into the server for one directory lookup. OpenBitFun writes its own
 * reader for the same reason.
 *
 * Layout (Chromium Pickle; `offset 0` is the start of the file):
 *
 *   0   u32  size of the first pickle's payload — always 4
 *   4   u32  size of the header pickle, i.e. the distance from offset 8 to the
 *            first file's content
 *   8   u32  size of the header pickle's own payload
 *   12  u32  length of the JSON header in bytes
 *   16  ...  the JSON header, NUL-padded to a 4-byte boundary
 *   content  file bytes, addressed as `8 + headerSize + entry.offset`
 *
 * The header is a directory tree: a directory has `files`, a file has `size` and
 * `offset` (a decimal string). Entries flagged `unpacked` live beside the archive
 * in `<archive>.unpacked/` instead and are reported as unreadable here — every
 * asset this reader is used for is packed.
 */
import { open, type FileHandle } from "node:fs/promises";

/** Bounds a malformed or hostile archive before it can allocate anything large. */
const HEADER_LIMIT = 16 * 1024 * 1024;
/** The fixed prefix that carries the header size. */
const HEADER_SIZE_PREFIX = 8;

export interface AsarFileEntry {
  kind: "file";
  size: number;
  /** Byte offset of the content, relative to the end of the header. */
  offset: number;
  unpacked: boolean;
}

export interface AsarDirectory {
  kind: "directory";
  files: Record<string, AsarNode>;
}

export type AsarNode = AsarFileEntry | AsarDirectory;

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/** Header size from the archive's first 8 bytes: the distance from offset 8 to the content. */
export function asarHeaderSize(prefix: Uint8Array): number {
  if (prefix.byteLength < HEADER_SIZE_PREFIX) {
    throw new Error("Asar archive is too short to hold a header");
  }
  const size = readU32(prefix, 4);
  if (size < HEADER_SIZE_PREFIX || size > HEADER_LIMIT) {
    throw new Error("Asar archive has an implausible header size");
  }
  return size;
}

/** Parse the header pickle (the bytes at file offset 8, `asarHeaderSize` long). */
export function parseAsarHeader(header: Uint8Array): AsarDirectory {
  if (header.byteLength < HEADER_SIZE_PREFIX) {
    throw new Error("Asar header is truncated");
  }
  const jsonLength = readU32(header, 4);
  if (jsonLength === 0 || jsonLength > header.byteLength - HEADER_SIZE_PREFIX) {
    throw new Error("Asar header has an implausible JSON length");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(header.subarray(8, 8 + jsonLength)));
  } catch (err) {
    throw new Error(`Asar header is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Asar header must be a JSON object");
  }
  return coerceDirectory(parsed);
}

function coerceDirectory(value: unknown): AsarDirectory {
  const files = (value as Record<string, unknown>)["files"];
  const out: Record<string, AsarNode> = {};
  if (typeof files !== "object" || files === null) {
    return { kind: "directory", files: out };
  }
  for (const [name, child] of Object.entries(files as Record<string, unknown>)) {
    if (typeof child !== "object" || child === null) continue;
    const raw = child as Record<string, unknown>;
    if (typeof raw["files"] === "object" && raw["files"] !== null) {
      out[name] = coerceDirectory(raw);
      continue;
    }
    const size = raw["size"];
    const offset = raw["offset"];
    if (typeof size !== "number" || typeof offset !== "string") continue;
    const parsedOffset = Number.parseInt(offset, 10);
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) continue;
    out[name] = {
      kind: "file",
      size,
      offset: parsedOffset,
      unpacked: raw["unpacked"] === true,
    };
  }
  return { kind: "directory", files: out };
}

function walk(root: AsarDirectory, segments: readonly string[]): AsarNode | null {
  let node: AsarNode = root;
  for (const segment of segments) {
    if (node.kind !== "directory") return null;
    const next: AsarNode | undefined = node.files[segment];
    if (next === undefined) return null;
    node = next;
  }
  return node;
}

/** Resolve a POSIX-style path inside the archive, or null when it is absent. */
export function findAsarFile(root: AsarDirectory, name: string): AsarFileEntry | null {
  const node = walk(
    root,
    name.split("/").filter((segment) => segment !== ""),
  );
  return node !== null && node.kind === "file" ? node : null;
}

/** Every file under `prefix`, as POSIX-style archive paths. */
export function listAsarFiles(root: AsarDirectory, prefix: string): string[] {
  const base = prefix.split("/").filter((segment) => segment !== "");
  const start = walk(root, base);
  if (start === null || start.kind !== "directory") return [];
  const out: string[] = [];
  const visit = (dir: AsarDirectory, path: string[]): void => {
    for (const [name, child] of Object.entries(dir.files)) {
      if (child.kind === "file") {
        out.push([...path, name].join("/"));
        continue;
      }
      visit(child, [...path, name]);
    }
  };
  visit(start, base);
  return out;
}

export interface AsarArchive {
  fileNames(prefix: string): string[];
  /** Read one entry, refusing anything over `limit` bytes. Throws when absent or unpacked. */
  read(name: string, limit: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * Electron replaces `fs` with a wrapper that reads *through* any path containing
 * `.asar`: it treats the archive as a directory, so opening the archive itself
 * fails — with a bare `ENOENT, not found in <path>` when the file exists, and an
 * `Invalid package <path>` for one that does not, neither of which names the real
 * problem. This reader wants the file, not a view into it, so asar support is
 * switched off for the duration via Electron's documented `process.noAsar`.
 *
 * The flag is process-wide, so entries are serialized and the window is kept as
 * short as possible. Outside Electron this is a pass-through, which is what lets
 * the plain-Node tests read the same archives.
 */
let asarGate: Promise<unknown> = Promise.resolve();

async function withAsarSupportDisabled<T>(run: () => Promise<T>): Promise<T> {
  // `process.noAsar` is undefined *while asar support is on*, so it cannot be used
  // to detect Electron — `process.versions.electron` is the reliable tell.
  if (process.versions.electron === undefined) return run();
  const holder = process as { noAsar?: boolean };
  const previous = asarGate;
  let release: () => void = () => undefined;
  asarGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const saved = holder.noAsar;
  holder.noAsar = true;
  try {
    return await run();
  } finally {
    // Restore rather than clear: leaving the key set to `undefined` is equivalent
    // to off, but deleting it keeps the process object as it was found.
    if (saved === undefined) delete holder.noAsar;
    else holder.noAsar = saved;
    release();
  }
}

/** Open an archive and read its header. The caller owns `close()`. */
export async function openAsar(archivePath: string): Promise<AsarArchive> {
  return withAsarSupportDisabled(() => openAsarInner(archivePath));
}

async function openAsarInner(archivePath: string): Promise<AsarArchive> {
  const handle: FileHandle = await open(archivePath, "r");
  try {
    const prefix = new Uint8Array(HEADER_SIZE_PREFIX);
    await handle.read(prefix, 0, HEADER_SIZE_PREFIX, 0);
    const headerSize = asarHeaderSize(prefix);
    const header = new Uint8Array(headerSize);
    await handle.read(header, 0, headerSize, HEADER_SIZE_PREFIX);
    const root = parseAsarHeader(header);
    const contentOffset = HEADER_SIZE_PREFIX + headerSize;
    return {
      fileNames: (name) => listAsarFiles(root, name),
      read: async (name, limit) => {
        const entry = findAsarFile(root, name);
        if (entry === null) throw new Error(`Asar entry is missing: ${name}`);
        if (entry.unpacked) throw new Error(`Asar entry is unpacked: ${name}`);
        if (entry.size > limit) throw new Error(`Asar entry exceeds ${limit} bytes: ${name}`);
        const bytes = new Uint8Array(entry.size);
        await handle.read(bytes, 0, entry.size, contentOffset + entry.offset);
        return bytes;
      },
      close: () => handle.close(),
    };
  } catch (err) {
    await handle.close().catch(() => undefined);
    throw err;
  }
}
