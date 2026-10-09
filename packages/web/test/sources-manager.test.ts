/**
 * Marketplace sources (features/plugins/sources-manager.tsx).
 *
 * The validation is the part worth guarding, because the failure it prevents is a security-shaped
 * mistake rather than a cosmetic one: a marketplace source is fetched by the *server*, so
 * accepting `file://` (or a bare path) in that field would be a way to point the server at an
 * arbitrary local file. The field's own label differs by type, and the rules differ with it.
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_SOURCE,
  sourceIdFor,
  validateSource,
} from "../src/features/plugins/sources-manager";

describe("validateSource", () => {
  it("accepts an http(s) marketplace URL", () => {
    expect(validateSource({ type: "market", url: "https://example.com/repo", path: "" })).toBe(
      "ok",
    );
    expect(validateSource({ type: "market", url: "http://example.com/repo", path: "" })).toBe("ok");
  });

  it("rejects anything that is not an http(s) URL", () => {
    // file:// here would be the server reading a local path on request; also not a URL at all.
    expect(validateSource({ type: "market", url: "file:///etc/passwd", path: "" })).toBe("invalid");
    expect(validateSource({ type: "market", url: "ftp://example.com", path: "" })).toBe("invalid");
    expect(validateSource({ type: "market", url: "example.com/repo", path: "" })).toBe("invalid");
  });

  it("rejects an empty value in either type", () => {
    expect(validateSource({ type: "market", url: "   ", path: "" })).toBe("invalid");
    expect(validateSource({ type: "local", url: "", path: "" })).toBe("invalid");
  });

  it("accepts any non-empty local path, including a Windows one", () => {
    // Shape only: whether the path exists is a question about the *server's* filesystem, which
    // the browser cannot answer, so the client must not pretend to.
    expect(validateSource({ type: "local", url: "", path: "D:\\skills" })).toBe("ok");
    expect(validateSource({ type: "local", url: "", path: "~/skills" })).toBe("ok");
    expect(validateSource({ type: "local", url: "", path: "/opt/skills" })).toBe("ok");
  });

  it("reads the field matching the type, not the other one", () => {
    // A local path sitting in the URL box must not satisfy a marketplace source, or switching the
    // type back and forth would keep a "valid" value that belongs to the other field.
    expect(validateSource({ type: "market", url: "", path: "D:\\skills" })).toBe("invalid");
    expect(validateSource({ type: "local", url: "https://example.com", path: "" })).toBe("invalid");
  });
});

describe("sourceIdFor", () => {
  it("is stable for the same target, so re-adding does not create a duplicate", () => {
    expect(sourceIdFor("market", "https://Example.com/repo")).toBe(
      sourceIdFor("market", "https://example.com/repo"),
    );
  });

  it("distinguishes a marketplace from a local path pointing at the same text", () => {
    expect(sourceIdFor("market", "x")).not.toBe(sourceIdFor("local", "x"));
  });

  it("does not collide with the built-in id", () => {
    // BUILTIN_SOURCE uses a `builtin:` prefix no user-supplied value can produce, so the product
    // library can never be shadowed by a source the user added.
    expect(sourceIdFor("market", "library")).not.toBe(BUILTIN_SOURCE.id);
    expect(BUILTIN_SOURCE.id.startsWith("builtin:")).toBe(true);
  });
});

describe("the built-in source", () => {
  it("is marked built-in so the UI never offers to remove it", () => {
    expect(BUILTIN_SOURCE.builtin).toBe(true);
    expect(BUILTIN_SOURCE.enabled).toBe(true);
  });
});
