/**
 * The ZIP reader.
 *
 * The archive is untrusted input, so most of this file is about what the reader *refuses*. The
 * happy path is three tests; the rest are the naming and resource attacks a theme upload can
 * carry. Each one asserts the specific refusal, not just "it threw" — a reader that rejected
 * everything would pass the loose version of every test here.
 */
import { describe, expect, it } from "vitest";
import { ZIP_LIMITS, ZipError, looksLikeZip, readZipEntries } from "../src/zip.js";
import { JPEG_BYTES, makeZip } from "./zip-fixture.js";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Read, expecting success, and return the entries keyed by name. */
function readOk(archive: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readZipEntries(archive)) out.set(entry.name, decode(entry.bytes));
  return out;
}

/** Read, expecting a refusal whose message contains `fragment`. */
function expectRefusal(archive: Uint8Array, fragment: string): void {
  let error: unknown = null;
  try {
    readZipEntries(archive);
  } catch (err) {
    error = err;
  }
  expect(error, `expected a refusal mentioning "${fragment}"`).toBeInstanceOf(ZipError);
  expect((error as Error).message).toContain(fragment);
}

describe("reading a well-formed archive", () => {
  it("reads a flat archive", () => {
    const archive = makeZip([
      { name: "theme.json", bytes: text('{"id":"a"}') },
      { name: "background.jpg", bytes: JPEG_BYTES },
    ]);
    const entries = readOk(archive);
    expect([...entries.keys()].sort()).toEqual(["background.jpg", "theme.json"]);
    expect(entries.get("theme.json")).toBe('{"id":"a"}');
  });

  it("strips a single shared top-level directory, the `zip -r my-theme/` shape", () => {
    const archive = makeZip([
      { name: "my-theme/", bytes: new Uint8Array() },
      { name: "my-theme/theme.json", bytes: text("{}") },
      { name: "my-theme/background.jpg", bytes: JPEG_BYTES },
    ]);
    expect([...readOk(archive).keys()].sort()).toEqual(["background.jpg", "theme.json"]);
  });

  it("reads deflated entries as readily as stored ones", () => {
    const body = "x".repeat(4096);
    const archive = makeZip([
      { name: "theme.json", bytes: text(body), method: "deflate" },
      { name: "background.jpg", bytes: JPEG_BYTES, method: "stored" },
    ]);
    expect(readOk(archive).get("theme.json")).toBe(body);
  });

  it("keeps a loose manifest beside a nested image, which some file managers produce", () => {
    const archive = makeZip([
      { name: "theme.json", bytes: text("{}") },
      { name: "my-theme/background.jpg", bytes: JPEG_BYTES },
    ]);
    expect([...readOk(archive).keys()].sort()).toEqual(["background.jpg", "theme.json"]);
  });

  it("is empty for an archive holding only directory entries", () => {
    // Not a refusal: an archive of empty folders is well-formed and simply has nothing to
    // import. The caller decides that a theme needs a manifest.
    expect(readZipEntries(makeZip([{ name: "my-theme/", bytes: new Uint8Array() }]))).toEqual([]);
  });
});

describe("refusing traversal", () => {
  it("refuses `..`", () => {
    expectRefusal(makeZip([{ name: "../escape.jpg", bytes: JPEG_BYTES }]), "escapes");
    expectRefusal(makeZip([{ name: "my-theme/../../escape.jpg", bytes: JPEG_BYTES }]), "escapes");
  });

  it("refuses an absolute path", () => {
    expectRefusal(makeZip([{ name: "/etc/passwd", bytes: text("x") }]), "absolute");
  });

  it("refuses a Windows drive path", () => {
    expectRefusal(makeZip([{ name: "C:/Windows/x.jpg", bytes: JPEG_BYTES }]), "absolute");
  });

  it("refuses a backslash, which Windows would read as a separator", () => {
    // `..\\escape.jpg` is a single segment to a POSIX path check and a traversal to Windows.
    expectRefusal(makeZip([{ name: "..\\escape.jpg", bytes: JPEG_BYTES }]), "unusable entry name");
  });

  it("refuses a bare `.` segment", () => {
    expectRefusal(makeZip([{ name: "./theme.json", bytes: text("{}") }]), "escapes");
  });

  it("refuses nesting deeper than one directory", () => {
    expectRefusal(makeZip([{ name: "a/b/c.jpg", bytes: JPEG_BYTES }]), "nested too deeply");
  });

  it("refuses two entries that flatten to the same name", () => {
    // The dangerous shape: a loose `background.jpg` beside `my-theme/background.jpg` both land
    // on `background.jpg`, and flattening keeps the last write — so the theme would carry an
    // image the reviewer never saw.
    expectRefusal(
      makeZip([
        { name: "background.jpg", bytes: JPEG_BYTES },
        { name: "my-theme/background.jpg", bytes: JPEG_BYTES },
      ]),
      "flatten to the same name",
    );
  });

  it("refuses nested entries when there is no single top-level directory to strip", () => {
    // Two candidate prefixes means no prefix, so the entries stay nested and cannot be written.
    expectRefusal(
      makeZip([
        { name: "one/theme.json", bytes: text("{}") },
        { name: "two/background.jpg", bytes: JPEG_BYTES },
      ]),
      "not a flat filename",
    );
  });

  it("refuses a name that is not plain ASCII", () => {
    // Unicode normalisation is how a name can *look* like `background.jpg` and resolve
    // elsewhere; requiring ASCII sidesteps the whole question.
    expectRefusal(makeZip([{ name: "thème.json", bytes: text("{}") }]), "non-ASCII");
  });
});

describe("refusing non-regular and encrypted entries", () => {
  it("refuses a symlink", () => {
    expectRefusal(
      makeZip([{ name: "background.jpg", bytes: JPEG_BYTES, mode: 0o120777 }]),
      "symlink",
    );
  });

  it("refuses an entry whose mode is neither a file nor a directory", () => {
    expectRefusal(
      makeZip([{ name: "background.jpg", bytes: JPEG_BYTES, mode: 0o010644 }]),
      "non-regular entry",
    );
  });

  it("refuses an encrypted entry", () => {
    expectRefusal(makeZip([{ name: "theme.json", bytes: text("{}"), flags: 0x0001 }]), "Encrypted");
  });
});

describe("refusing unsupported and malformed structure", () => {
  it("refuses an unsupported compression method by name", () => {
    expectRefusal(
      makeZip([{ name: "theme.json", bytes: text("{}"), declaredMethod: 12 }]),
      "unsupported compression method",
    );
  });

  it("refuses an archive with no end-of-central-directory record", () => {
    expectRefusal(new Uint8Array(64), "no end-of-central-directory");
    expectRefusal(new Uint8Array(8), "too small");
  });

  it("refuses an empty archive", () => {
    expectRefusal(makeZip([]), "no entries");
  });

  it("refuses an entry whose declared payload runs past the end of the archive", () => {
    expectRefusal(
      makeZip([{ name: "theme.json", bytes: text("{}"), declaredCompressedSize: 9999 }]),
      "truncated",
    );
  });

  it("refuses a header that understates the decompressed size", () => {
    // The declared size is attacker-controlled, so the reader checks the real output against
    // it: a small claim must not become a large buffer.
    const archive = makeZip([
      { name: "theme.json", bytes: text("y".repeat(2048)), method: "deflate", declaredSize: 1 },
    ]);
    expectRefusal(archive, "does not match its declared size");
  });
});

describe("bounds", () => {
  it("refuses an entry larger than the per-entry cap", () => {
    const archive = makeZip([
      { name: "background.jpg", bytes: new Uint8Array(ZIP_LIMITS.maxEntryBytes + 1) },
    ]);
    expectRefusal(archive, "too large");
  });

  it("stops inflation at the per-entry cap, whatever the headers claim", () => {
    // The declared size is attacker-controlled in both directions. Here it understates the
    // output by four orders of magnitude; `maxOutputLength` is what actually bounds the buffer,
    // because it acts on the real inflated bytes rather than on a header's promise.
    const archive = makeZip([
      {
        name: "theme.json",
        bytes: new Uint8Array(ZIP_LIMITS.maxEntryBytes * 4),
        method: "deflate",
        declaredSize: 1024,
      },
    ]);
    expectRefusal(archive, "could not be decompressed");
  });

  it("inflates a highly repetitive file that a ratio ceiling would have rejected", () => {
    // The regression this guards: a ratio check refuses this honestly-compressible JSON, and
    // `maxOutputLength` already bounds the same attack without the false positive.
    const repetitive = JSON.stringify({ palette: Array.from({ length: 400 }, () => "#ffffff") });
    const archive = makeZip([{ name: "theme.json", bytes: text(repetitive), method: "deflate" }]);
    expect(readOk(archive).get("theme.json")).toBe(repetitive);
  });

  it("refuses more entries than the cap allows", () => {
    const entries = Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_unused, index) => ({
      name: `f${String(index)}.json`,
      bytes: text("{}"),
    }));
    expectRefusal(makeZip(entries), "more than");
  });

  it("refuses an archive whose total output exceeds the cap", () => {
    // Each entry is under the per-entry cap; together they are not.
    const chunk = new Uint8Array(ZIP_LIMITS.maxEntryBytes - 1);
    const entries = Array.from({ length: 4 }, (_unused, index) => ({
      name: `f${String(index)}.jpg`,
      bytes: chunk,
    }));
    expectRefusal(makeZip(entries), "expands beyond the allowed total");
  });
});

describe("looksLikeZip", () => {
  it("recognises a local file header and an empty archive", () => {
    expect(looksLikeZip(makeZip([{ name: "a", bytes: text("x") }]))).toBe(true);
    expect(looksLikeZip(makeZip([]))).toBe(true);
  });

  it("rejects other content and anything too short", () => {
    expect(looksLikeZip(JPEG_BYTES)).toBe(false);
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
    expect(looksLikeZip(new Uint8Array(0))).toBe(false);
  });
});
