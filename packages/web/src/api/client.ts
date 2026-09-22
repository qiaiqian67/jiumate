/**
 * fetch wrapper: JSON request/response, unified errors -> ApiError,
 * same-origin cookie auth (credentials: same-origin; CSRF relies on SameSite=Lax + JSON
 * Content-Type, see server README).
 *
 * When the session becomes invalid (server 401, e.g. database rebuilt, cookie expired),
 * notifies AuthProvider to clear the current user, letting the route guard redirect to the
 * login page — instead of each page popping its own "unauthorized" error.
 */
import { S } from "../lib/strings";

/** Unified API error: carries the HTTP status code and server error code (server error body {error:{code,message}}). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Session-invalidation callback (registered by AuthProvider; not triggered by 401s from the login/register endpoints themselves). */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** 401/409 from auth endpoints themselves are business failures (e.g. wrong password) and must not trigger a global logout. */
function isAuthEndpoint(path: string): boolean {
  return path.startsWith("/api/auth/");
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON request body (auto-serialized with Content-Type: application/json). */
  body?: unknown;
  /**
   * A raw request body, for the few routes that take bytes rather than JSON (the theme archive
   * upload). Mutually exclusive with {@link body}: only one of them may be set, because the
   * Content-Type and the serialization differ and a request cannot have both.
   */
  rawBody?: Blob;
  /** Content-Type for {@link rawBody}. Ignored when `body` is used. */
  contentType?: string;
  /** Query parameters (undefined values are skipped). */
  query?: Record<string, string | number | undefined>;
  /** Extra request headers (e.g. `If-Match` for ETag-based conflict detection). */
  headers?: Record<string, string>;
}

/** Response metadata a caller may need alongside the parsed body. */
export interface ApiFetchMeta {
  /**
   * The server's own clock at the moment it produced the response, read from the HTTP `Date`
   * header; null when absent or unparseable. Lets a caller measure a server-side interval
   * entirely in server time — differencing it against a server-supplied timestamp cancels any
   * client/server clock offset, which a local `Date.now()` cannot do. Whole-second precision
   * (RFC 9110 fixes the header's format), so treat it as ±1s. `Date` is CORS-safelisted, so it
   * is readable cross-origin too.
   */
  serverNowMs: number | null;
  /**
   * Weak ETag from the response, if the server sent one. Null when absent. Used by the
   * in-place Markdown editor to round-trip a file's mtime through `If-Match` on save, so
   * a concurrent write by the Agent is reported as 409 instead of silently overwritten.
   */
  etag: string | null;
}

/**
 * The `fetch` body and headers for one request.
 *
 * Three cases, and they are exclusive: a raw body (already serialized, caller picks the type),
 * a JSON body (serialized here), or neither. Kept as a function so the exclusivity is stated
 * once rather than re-derived at the call site.
 */
function requestBodyInit(options: ApiFetchOptions): RequestInit {
  if (options.rawBody !== undefined) {
    return {
      headers: {
        "Content-Type": options.contentType ?? "application/octet-stream",
        ...(options.headers ?? {}),
      },
      body: options.rawBody,
    };
  }
  if (options.body !== undefined) {
    return {
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
      body: JSON.stringify(options.body),
    };
  }
  return options.headers ? { headers: options.headers } : {};
}

/** Makes an API request; non-2xx responses uniformly throw ApiError; 204/empty body returns undefined. */ export async function apiFetch<
  T,
>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return (await apiFetchWithMeta<T>(path, options)).data;
}

/** {@link apiFetch} plus the response metadata in {@link ApiFetchMeta}; identical in every other respect. */
export async function apiFetchWithMeta<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T } & ApiFetchMeta> {
  let url = path;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      ...requestBodyInit(options),
    });
  } catch {
    throw new ApiError(0, "network_error", S.errors.networkError);
  }

  if (!response.ok) {
    let code = "http_error";
    let message: string = S.common.unknownError;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body: fall back to the default message.
    }
    if (response.status === 401 && !isAuthEndpoint(path)) onUnauthorized?.();
    throw new ApiError(response.status, code, message);
  }

  const headerDate = Date.parse(response.headers.get("date") ?? "");
  const serverNowMs = Number.isFinite(headerDate) ? headerDate : null;
  const etag = response.headers.get("etag");

  if (response.status === 204) return { data: undefined as T, serverNowMs, etag };
  const text = await response.text();
  if (!text) return { data: undefined as T, serverNowMs, etag };
  return { data: JSON.parse(text) as T, serverNowMs, etag };
}

/**
 * Posts a JSON body and reads the response as a Blob. Used for binary downloads
 * (`/api/sessions/:id/files/export` — PDF/DOCX/EPUB/RTF/TXT) where JSON parsing would
 * garble the bytes. Errors keep the same shape as {@link apiFetch}: non-2xx reads the
 * body's `{error:{code,message}}` if present and throws `ApiError`; a fetch rejection
 * (network) maps to `ApiError(0, "network_error")`. Same-origin credentials so a
 * session cookie rides along, same as {@link apiFetch}.
 */
export async function postBinary(path: string, body: unknown): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", S.errors.networkError);
  }
  if (!response.ok) {
    let code = "http_error";
    let message: string = S.common.unknownError;
    try {
      const errBody = (await response.json()) as { error?: { code?: string; message?: string } };
      if (errBody.error?.code) code = errBody.error.code;
      if (errBody.error?.message) message = errBody.error.message;
    } catch {
      // Body wasn't JSON — keep the defaults.
    }
    if (response.status === 401 && !isAuthEndpoint(path)) onUnauthorized?.();
    throw new ApiError(response.status, code, message);
  }
  return response.blob();
}
