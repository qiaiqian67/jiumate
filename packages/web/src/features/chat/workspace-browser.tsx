/**
 * Workspace file browser (the "Browse All" tab of the Files panel): directory navigation
 * (breadcrumbs, going up a level navigates via a breadcrumb segment), file list (name/size/
 * modified time), preview (Markdown/HTML default to a rendered view + a source toggle, text/
 * images shown inline, other types prompt a download), upload (multi-select in the current
 * directory, single file <=14MB) and download. Path scoping is validated by the server (including
 * auto-creating missing parent directories within the sandbox, an API-level capability).
 *
 * Single-column list <-> preview drill-down (no side-by-side layout): the panel's width is
 * controlled by the outer Files panel and may be much narrower than the viewport, so `lg:`-style
 * viewport breakpoints would misjudge things here (a wide viewport doesn't mean this component
 * got a wide allotment of space) — so the list and preview are shown mutually exclusively,
 * routed by whether the existing `preview` is null, without introducing extra state.
 */
import {
  Suspense,
  isValidElement,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "../../lib/markdown-plugins";
import type { SessionInfo, WorkspaceFilesResponse } from "@prismshadow/linsight-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { useAuth } from "../../state/auth";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { joinWorkspacePath } from "../../lib/file-path";
import { formatBytes, formatDateTime } from "../../lib/format";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Dropdown } from "../../components/ui/dropdown";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { SkeletonList } from "../../components/ui/skeleton";
import { CodeBlock } from "./code-block";
import { MermaidBlock } from "./mermaid-block";
import { languageForExtension } from "./code-languages";
import { ExportMenu } from "./workspace-export";
import { MarkdownEditor } from "./markdown-editor";

/**
 * The .docx surface, loaded on demand.
 *
 * It is a layout and text-shaping engine, not a form control — a whole paginated editor and its
 * font pipeline — and only a session that opens a Word document needs any of it. `lazy` keeps it out
 * of the bundle every other view pays for, the same reason CodeMirror is loaded inside
 * MarkdownEditor rather than beside it.
 */
const DocxSurface = lazy(() => import("./docx-surface"));
import type { DocxSurfaceHandle } from "./docx-surface";
import { DocumentPreviewView } from "./document-preview";
import type { CellEditDraft } from "./document-preview";
import type { DocumentPreview } from "@prismshadow/linsight-core/documents";
import { toneInk } from "../../lib/tone";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "json",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "sh",
  "bash",
  "yaml",
  "yml",
  "toml",
  "css",
  "html",
  "htm",
  "csv",
  "log",
  "xml",
  "ini",
  "conf",
  "rs",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "sql",
  "rb",
  "php",
  "gitignore",
  "env",
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const HTML_EXTS = new Set(["html", "htm"]);
/**
 * Extensions the server can convert into a preview. Kept in step with `DOCUMENT_EXTENSIONS` in
 * core — a format listed here but not there answers 415, which the catch below reports as
 * unsupported rather than as a crash. `pdf` is absent on purpose: the browser renders it natively
 * and the iframe branch above handles it.
 */
const DOCUMENT_EXTS = new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp"]);
/** Read cap for text preview (beyond this, truncated with a download prompt). */
const TEXT_PREVIEW_LIMIT = 256 * 1024;
/** Source highlighting cap: tokenizing the full 256KB preview cap's worth of content in one go would block the main thread, so beyond this it falls back to unhighlighted. */
const HIGHLIGHT_LIMIT = 64 * 1024;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : name.toLowerCase();
}

/** Flatten a react-markdown code element's children to plain text. */
function extractCodeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("");
  return "";
}

/** Stable 32-bit hash of a string (FNV-1a). Used to derive a Mermaid nonce from the source
 *  body so two diagrams with identical code on the same page don't collide on Mermaid's
 *  required-unique DOM id, and a code edit reliably flips the nonce (re-render Mermaid). */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * ReactMarkdown's components map, isolated as a memoized child so that *its* component-type
 * identities for `pre` / `img` / `a` stay stable across the parent's renders. Without this
 * memo, every WorkspaceBrowser commit produces a fresh object literal — and every fresh `pre`
 * function is a *new* component type to react-markdown, so React unmounts and remounts every
 * fenced block on every parent render. The visible cost is exactly what the user reported:
 * MermaidBlock's useEffect clears the container, async-imports mermaid, calls render(), and
 * the cycle repeats in a visible flicker until something in the parent settles. Memoizing the
 * child means the components map only changes when one of its captured inputs (the file path,
 * the file nonce, the body length, the session id, the preview-path callback) actually
 * changes — none of which churn during reading.
 */
const RenderedMd = memo(function RenderedMd({
  body,
  fileNonce,
  filePath,
  sessionId,
  highlight,
  onLinkClick,
}: {
  body: string;
  /** The file's read nonce — also feeds the Mermaid id and the image cache-buster. */
  fileNonce: number;
  filePath: string;
  sessionId: string;
  /** Below this size Shiki tokenizes the source; above it the source view falls back to plain text. */
  highlight: boolean;
  onLinkClick: (target: string) => void;
}) {
  // useMemo so the components object is stable across renders of this memoized child; a fresh
  // object literal would be a new identity on every commit and react-markdown would still
  // consider `pre` a new component type. (React.memo already gates the parent, but the inline
  // object would still flip the components prop identity *inside* an unmemoized child.)
  const components = useMemo(
    () => ({
      // Fenced code block adapter: mermaid blocks route through MermaidBlock (heavy lazy-import
      // SVG renderer); everything else falls through to the message stream's CodeBlock.
      // Mermaid's required-unique id is `ws-<fileNonce>-<hash32(code)>` so a re-read (which
      // bumps nonce) and a code edit both get a fresh container.
      pre: ({ children }: { children?: ReactNode }) => {
        if (!isValidElement(children)) return <pre>{children as ReactNode}</pre>;
        const codeProps = children.props as { className?: string; children?: unknown };
        const language = /language-([\w+-]+)/.exec(codeProps.className ?? "")?.[1] ?? "";
        if (language === "mermaid") {
          const raw = codeProps.children;
          const code = (
            typeof raw === "string"
              ? raw
              : Array.isArray(raw)
                ? raw.filter((c) => typeof c === "string").join("")
                : ""
          ).replace(/\n$/, "");
          return <MermaidBlock code={code} nonce={`ws-${fileNonce}-${hash32(code)}`} />;
        }
        return (
          <CodeBlock
            language={language}
            code={extractCodeText(codeProps.children)}
            highlight={highlight}
          />
        );
      },
      // Relative images are resolved against the md file's directory into the file API.
      // `v=<fileNonce>` is the read nonce — a Workspace image rewritten under the same path
      // would otherwise keep painting the previous bytes from the browser's image cache.
      img: ({ src, alt }: { src?: unknown; alt?: unknown }) => (
        <img
          src={
            typeof src === "string" && !EXTERNAL_REF_RE.test(src)
              ? `${api.workspaceFileUrl(sessionId, resolveRelative(dirOf(filePath), src))}&v=${fileNonce}`
              : (src as string | undefined)
          }
          alt={typeof alt === "string" ? alt : ""}
          loading="lazy"
          className="max-w-full"
        />
      ),
      // External links open in a new tab; relative links point to a Workspace file (clicking
      // switches the preview directly via onLinkClick); in-page anchors keep default behavior.
      a: ({ href, children }: { href?: unknown; children?: ReactNode }) => {
        if (typeof href !== "string" || href.startsWith("#")) {
          return <a href={href as string | undefined}>{children}</a>;
        }
        if (EXTERNAL_REF_RE.test(href)) {
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        }
        const target = resolveRelative(dirOf(filePath), href);
        return (
          <a
            href={api.workspaceFileUrl(sessionId, target)}
            onClick={(e) => {
              e.preventDefault();
              onLinkClick(target);
            }}
          >
            {children}
          </a>
        );
      },
    }),
    [fileNonce, filePath, sessionId, highlight, onLinkClick],
  );
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={components}
    >
      {body}
    </ReactMarkdown>
  );
});

function dirOf(filePath: string): string {
  return filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
}

/** An external reference with a scheme (http(s)/mailto/data, etc.), passed through as-is in the md rendered view. */
const EXTERNAL_REF_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Resolves relative references (image src / link href) within the md rendered view: based on
 *  the md file's directory, handling ./ and ../ (clamped to the root if it would go past it);
 *  a leading "/" is treated as the Workspace root. */
function resolveRelative(baseDir: string, ref: string): string {
  const out = ref.startsWith("/") || baseDir === "" ? [] : baseDir.split("/");
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * Storage shim injected into the HTML preview: when the sandbox lacks allow-same-origin, the
 * iframe has an opaque origin, and accessing localStorage/sessionStorage throws a SecurityError
 * that halts scripts. The shim runs before any page script and falls back to a synchronous
 * in-memory implementation (substituted only when the native access throws), preserving sandbox
 * isolation while letting the page's scripts run normally.
 */
const STORAGE_SHIM =
  "<script>(function(){function mk(){var m={};return{getItem:function(k){return k in m?m[k]:null}," +
  "setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}," +
  "key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}" +
  "['localStorage','sessionStorage'].forEach(function(n){try{window[n].length}catch(e){" +
  "Object.defineProperty(window,n,{value:mk(),configurable:true})}})})();</script>";

/** Injects the storage shim at the earliest possible script position in the HTML (right after <head>, otherwise right after <html>, otherwise at the very start). */
function withStorageShim(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + STORAGE_SHIM);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + STORAGE_SHIM);
  return STORAGE_SHIM + html;
}

interface Preview {
  path: string;
  name: string;
  kind: "text" | "md" | "image" | "html" | "pdf" | "document" | "unsupported";
  /** Content for kind=text/md/html (may be truncated). */
  content?: string;
  truncated?: boolean;
  /**
   * Converted payload for kind=document: a .docx as HTML, a workbook as cells, a deck as slides.
   * Fetched from the server rather than derived here, because the conversion needs mammoth, a zip
   * reader and a spreadsheet parser — none of which belong in the web bundle.
   */
  document?: DocumentPreview;
  /**
   * Set when this `md` preview is really a .docx being edited through Markdown.
   *
   * The edit flow is driven entirely by `kind === "md"`, so a .docx that wants the editor becomes
   * one — same toolbar, same editor, same conflict modal. This field is the one thing that has to
   * be remembered, because saving goes somewhere different: a .docx cannot be written by putting
   * text into it.
   */
  docxSource?: { path: string; etag?: string };
  /** Bumped on every previewPath call; keys the isolated HTML iframe so re-opening the
   *  same path remounts it and refetches fresh content (its src alone would not change). */
  nonce: number;
  /**
   * Weak ETag from the read response (`W/"<mtimeMs>"`). Round-tripped as `If-Match` on save
   * so a concurrent write to the file (most commonly: the Agent rewriting it during a turn)
   * is reported as 409 instead of silently clobbered. Absent when the server didn't return
   * one — in which case the save proceeds unconditionally.
   */
  etag?: string;
}

/** Monotonic counter behind Preview.nonce. Doubles as the staleness guard: previewPath
 *  captures its value up front and publishes only while still the latest, so two rapid
 *  calls can't have the slower loser overwrite the winner. Module scope is fine — the
 *  docked panel and the drawer never mount WorkspaceBrowser at the same time. */
let previewSeq = 0;

export function WorkspaceBrowser({
  session,
  openRequest,
  active,
  onPreviewOpen,
  reloadSignal,
}: {
  session: SessionInfo;
  /** External navigation command (from clicking a file chip in a message): navigates to the
   *  directory and previews that path. Triggers again whenever the object reference changes,
   *  even if path is the same as last time (clicking the same file again must still re-locate it). */
  openRequest?: { path: string } | null;
  /** Whether the panel is visible: when collapsed in the docked state, the component stays
   *  mounted (width 0), during which the list can go stale as the Agent writes files; a refresh
   *  is issued right at the moment it transitions from hidden to visible. */
  active?: boolean;
  /** Callback when entering file preview (used by the mobile Sheet to raise its snap point to full). */
  onPreviewOpen?: () => void;
  /**
   * Bumped by the parent every time a Task settles on this session: the turn that just ended
   * is exactly when the Agent's writes land, so the listing — and whatever file is open in
   * the preview — is stale the moment it does. Any change of the number means "re-read",
   * so the initial value is irrelevant and no edge tracking is needed.
   */
  reloadSignal?: number;
}) {
  // Whether the HTML preview lands on a separate origin. True routes both the in-app
  // rendered view and "open in new tab" through the preview origin; false downgrades
  // the new tab to the same-origin sandbox (which the link flags rather than failing
  // silently in the page) and the in-app rendered view to the srcDoc fallback.
  const { previewIsolated } = useAuth();
  const [path, setPath] = useState("");
  /**
   * The loaded listing, bound to the path it was fetched for. Entry-row targets (descend /
   * preview / download) are joined against `base` — the generation the rendered rows came
   * from — never against the live `path` state: the stale rows stay on screen while a
   * navigation fetch is in flight, and joining onto the already-advanced path would compound
   * segments on a double-click ("home" → "home/home", a directory that does not exist).
   * Base-bound targets make a repeated click recompute the same target, i.e. a no-op.
   */
  const [data, setData] = useState<{ base: string; res: WorkspaceFilesResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Picked files whose names collide with the loaded listing (non-null shows the overwrite confirm). */
  const [pendingUpload, setPendingUpload] = useState<{ files: File[]; clashes: string[] } | null>(
    null,
  );
  const [reloadTick, setReloadTick] = useState(0);
  const [showPath, setShowPath] = useState(false);
  /** HTML / Markdown preview: rendered view (HTML via sandboxed iframe, Markdown via md-body),
   *  source toggle, and (Markdown only) the in-place editor view. The "edit" view is only
   *  reachable through the toolbar pill that also mounts the editor; choosing "edit" from
   *  outside of an active draft just enters the editor with the file's current content. */
  const [richView, setRichView] = useState<"rendered" | "source" | "edit">("rendered");
  /** Error from the lazy source fetch of an isolated HTML preview: scoped to the source
   *  view — the rendered iframe keeps working no matter what happens to this fetch. */
  const [sourceError, setSourceError] = useState<string | null>(null);
  /** True while the user has an unsaved .md draft (MarkdownEditor mounted). Independent of
   *  `richView`: with editingMd=true the user can pick rendered/source/edit and the body routes
   *  through draftMd in all three — switching view never loses keystrokes. Cleared on cancel,
   *  on navigating away from the file, or when the user picks "Reload" in the conflict modal. */
  const [editingMd, setEditingMd] = useState(false);
  /** Current editor content, kept in sync with MarkdownEditor's onChange. The editor only
   *  takes the initial `value` on mount and reports every keystroke through `onChange`; we
   *  own the draft so the toolbar's Save button (and the Cmd/Ctrl-S keymap that ultimately
   *  fires MarkdownEditor's onSave) both save the same bytes. */
  const [draftMd, setDraftMd] = useState("");
  /**
   * The .docx editor's save handle, filled in by the surface once it mounts.
   *
   * A plain ref written through a callback prop rather than a `ref` on the component: the surface is
   * behind `React.lazy`, and a ref placed on a lazy component never arrives. The panel's Save found
   * `null` and returned in silence — clicking it did nothing at all.
   */
  const docxRef = useRef<DocxSurfaceHandle | null>(null);

  /**
   * A stable identity, because the surface registers its handle from an effect keyed on this prop.
   *
   * An inline arrow would change identity on every render, and the effect would then tear down and
   * re-register on every render — its cleanup sets the handle to `null` first, and `useEffect` runs
   * after paint, so a Save click landing in that window would read `null` and report "unavailable"
   * about an editor that is right there on screen.
   */
  const setDocxHandle = useCallback((handle: DocxSurfaceHandle | null): void => {
    docxRef.current = handle;
  }, []);
  /** Save in flight (disables Save button, shows busy state in the editor). */
  const [savingMd, setSavingMd] = useState(false);
  /** Conflict modal: non-null when the server rejected save with 409 file_conflict. Carries the
   *  two user-facing resolutions (reload = discard edits; overwrite = re-send without If-Match). */
  const [mdConflict, setMdConflict] = useState<null | { path: string }>(null);
  /** Mirror for previewPath: reading previewIsolated through a ref keeps the callback's
   *  identity stable when /api/me refreshes it (previewPath drives the openRequest locate
   *  effect, which must not replay on an auth-context change). */
  const previewIsolatedRef = useRef(previewIsolated);
  previewIsolatedRef.current = previewIsolated;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listWorkspaceFiles(session.sessionId, path)
      .then((res) => {
        if (!cancelled) setData({ base: path, res });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : S.files.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId, path, reloadTick, reloadSignal]);

  // Session switched: back to the root directory with no preview. Reset during render
  // (React's documented "adjust state when a prop changes" pattern), not in an effect —
  // an effect-based reset lets one frame commit in which the old session's preview
  // renders against the new session, flipping the isolated iframe's src to the new
  // session + the old path and firing a doomed request. Bumping previewSeq also
  // invalidates any in-flight previewPath from the old session (its present() guard
  // fails), so a late result can't resurrect old-session content after the reset.
  const [renderedSessionId, setRenderedSessionId] = useState(session.sessionId);
  if (renderedSessionId !== session.sessionId) {
    setRenderedSessionId(session.sessionId);
    setPath("");
    setPreview(null);
    setData(null);
    setSourceError(null);
    previewSeq++;
  }

  // Edge-triggered refresh on the panel's hidden -> visible transition (doesn't count the initial mount: mounting itself already fetches once).
  const prevActive = useRef(active);
  useEffect(() => {
    if (active && !prevActive.current) setReloadTick((t) => t + 1);
    prevActive.current = active;
  }, [active]);

  /** The preview callback goes through a ref: keeps previewPath's useCallback dependency stable,
   *  so even if the parent passes an inline arrow function, the openRequest locate effect doesn't
   *  replay just because previewPath's reference changed. */
  const onPreviewOpenRef = useRef(onPreviewOpen);
  onPreviewOpenRef.current = onPreviewOpen;

  /**
   * Opens `filePath` in the preview. `refresh` re-reads a file already on screen (the
   * settled-turn refresh below): it must not touch the things that belong to the user's
   * hands — the mobile sheet's snap point, the rendered/source choice — and a failed
   * re-read leaves what is on screen alone instead of replacing a working preview with
   * "unsupported".
   */
  const previewPath = useCallback(
    async (filePath: string, opts?: { refresh?: boolean }) => {
      const refresh = opts?.refresh === true;
      if (!refresh) onPreviewOpenRef.current?.();
      const name = filePath.includes("/")
        ? filePath.slice(filePath.lastIndexOf("/") + 1)
        : filePath;
      const ext = extOf(name);
      const nonce = ++previewSeq;
      /** Publishes this call's result unless a newer previewPath call has started since:
       *  two rapid calls interleave across the await, and the late loser must not
       *  overwrite the winner's preview. */
      const present = (p: Preview) => {
        if (nonce === previewSeq) setPreview(p);
      };
      if (!refresh) {
        setRichView("rendered");
        setSourceError(null);
        setEditingMd(false);
        setDraftMd("");
      }
      if (IMAGE_EXTS.has(ext)) {
        present({ path: filePath, name, kind: "image", nonce });
        return;
      }
      // PDF: the server returns it inline as application/pdf, embedded directly in an iframe and rendered by the browser.
      if (ext === "pdf") {
        present({ path: filePath, name, kind: "pdf", nonce });
        return;
      }
      const isHtml = HTML_EXTS.has(ext);
      const isMd = ext === "md";
      // Documents get a converted preview instead of the "unsupported" notice. The server does the
      // conversion; this only asks for it and decides how the payload is shown.
      if (!isHtml && !isMd && DOCUMENT_EXTS.has(ext)) {
        try {
          const { payload, etag } = await api.documentPreview(session.sessionId, filePath);
          // ODF extracts to text rather than to a layout, so it is handed to the Markdown view the
          // app already has — the same pane, one less renderer to maintain.
          if (payload.kind === "markdown") {
            present({
              path: filePath,
              name,
              kind: "md",
              content: payload.markdown,
              truncated: false,
              nonce,
            });
            return;
          }
          present({
            path: filePath,
            name,
            kind: "document",
            document: payload,
            nonce,
            etag: etag ?? undefined,
          });
        } catch {
          // A file that cannot be converted is reported as such rather than as a generic
          // "unsupported type": the user's next question is why, and the notice answers the
          // category at least.
          if (!refresh) present({ path: filePath, name, kind: "unsupported", nonce });
        }
        return;
      }
      if (!isHtml && !TEXT_EXTS.has(ext)) {
        present({ path: filePath, name, kind: "unsupported", nonce });
        return;
      }
      // Isolated HTML: the rendered view is an iframe onto the preview origin and needs no
      // text here, so the iframe mounts with no upfront fetch — a large file isn't
      // downloaded twice, and a transient fetch failure can't downgrade a page the iframe
      // would serve fine. The source text is fetched lazily on the first Source toggle
      // (see the effect below).
      if (isHtml && previewIsolatedRef.current) {
        present({ path: filePath, name, kind: "html", nonce });
        return;
      }
      try {
        // The server downgrades html/svg served inline to text/plain (a same-origin XSS
        // defense); this fetches the raw content back for text/Markdown previews and for
        // the srcDoc fallback rendered view of non-isolated HTML.
        const res = await fetch(api.workspaceFileUrl(session.sessionId, filePath), {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String(res.status));
        // Capture ETag for the edit-mode save round-trip (see Preview.etag).
        const etag = res.headers.get("etag");
        const full = await res.text();
        const truncated = full.length > TEXT_PREVIEW_LIMIT;
        // Oversized Markdown defaults to the source view (benefiting from the unhighlighted
        // highlight=false path): feeding the whole block to remark for parsing is a one-time
        // main-thread cost; the user can still manually switch to "rendered view" as an informed choice.
        if (!refresh && isMd && full.length > HIGHLIGHT_LIMIT && nonce === previewSeq) {
          setRichView("source");
        }
        present({
          path: filePath,
          name,
          kind: isHtml ? "html" : isMd ? "md" : "text",
          content: truncated ? full.slice(0, TEXT_PREVIEW_LIMIT) : full,
          truncated,
          nonce,
          etag: etag ?? undefined,
        });
      } catch {
        // A re-read that fails (the Agent deleted the file mid-turn, a blip) keeps the
        // preview the user is looking at; only a fresh open reports it as unsupported.
        if (!refresh) present({ path: filePath, name, kind: "unsupported", nonce });
      }
    },
    [session.sessionId],
  );

  // Lazy source fetch for isolated HTML previews: previewPath mounted the iframe without
  // downloading the text, so the first switch to the Source view fetches it here (as does
  // the rare case of previewIsolated flipping to false with such a preview open, which
  // strands the srcDoc fallback without content). Failure sets sourceError and touches
  // nothing else — a broken source fetch must not take down the rendered view.
  useEffect(() => {
    if (preview?.kind !== "html" || preview.content !== undefined) return;
    if (richView !== "source" && previewIsolated) return;
    const target = preview.path;
    let cancelled = false;
    setSourceError(null);
    void (async () => {
      try {
        const res = await fetch(api.workspaceFileUrl(session.sessionId, target), {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String(res.status));
        const full = await res.text();
        if (cancelled) return;
        const truncated = full.length > TEXT_PREVIEW_LIMIT;
        // Functional update with its own guard (not `present`): this must only fill the
        // still-current, still-contentless HTML preview for the same path, never revive
        // a preview the user has since navigated away from.
        setPreview((p) =>
          p !== null && p.kind === "html" && p.path === target && p.content === undefined
            ? { ...p, content: truncated ? full.slice(0, TEXT_PREVIEW_LIMIT) : full, truncated }
            : p,
        );
      } catch {
        if (!cancelled) setSourceError(S.files.loadFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, richView, previewIsolated, session.sessionId]);

  // The same settled-turn signal re-reads whatever is open in the preview: watching a file
  // the Agent is editing is the reason this panel sits next to the conversation. Skipped on
  // the first run (the mount already read it) and while no preview is open. Reading the path
  // from a ref keeps this effect keyed on the signal alone — depending on `preview` would
  // re-run it on every preview change and re-read a file that was just read.
  const previewPathRef = useRef<string | null>(null);
  previewPathRef.current = preview?.path ?? null;
  const lastReloadSignal = useRef(reloadSignal);
  useEffect(() => {
    if (reloadSignal === lastReloadSignal.current) return;
    lastReloadSignal.current = reloadSignal;
    const open = previewPathRef.current;
    if (open !== null) void previewPath(open, { refresh: true });
  }, [reloadSignal, previewPath]);

  /**
   * Save the current .md edit. Outcomes:
   * - Success: stay in edit mode (the user is still working — saving is a milestone, not
   *   an exit), patch `preview.etag` from the response so the next save has a fresh
   *   If-Match, and refresh the preview in the background so the saved bytes (which equal
   *   `content`, since that's what we just PUT) flow into `preview.content`. When the user
   *   later toggles to "rendered" / "source" they see the just-saved content; toggling back
   *   to "edit" remounts the editor with `value={draftMd}` (their latest keystrokes).
   * - 409 file_conflict: open the conflict modal — the user picks "reload" (discard edits,
   *   re-fetch the current file from disk) or "overwrite" (force-save by retrying without
   *   If-Match, accepting the clobber). Other errors surface as toasts.
   *
   * `force` skips the If-Match header, used after the user explicitly chose overwrite.
   */
  /**
   * Writes an edited .docx back through the workspace.
   *
   * The bytes come from the editor's own serializer — a complete OOXML package — so this function's
   * whole job is to decide where they go and to refuse to clobber something the user did not mean to
   * overwrite. It is deliberately not part of `saveMdEdit`: that one takes text, this one takes a
   * document, and the two only looked alike because a save used to be a conversion.
   *
   * `docxOutput` names the target when it is not the source (Save as), and `force` means the user
   * answered the conflict modal.
   */
  const saveDocxBytes = useCallback(
    async (bytes: ArrayBuffer, opts?: { force?: boolean; docxOutput?: string }): Promise<void> => {
      if (!preview || preview.kind !== "md" || !preview.docxSource) return;
      const { path: sourcePath, etag } = preview.docxSource;
      const output = opts?.force ? sourcePath : (opts?.docxOutput ?? sourcePath);
      setSavingMd(true);
      try {
        await api.writeDocumentDocx(
          session.sessionId,
          sourcePath,
          bytes,
          output,
          // `force` is the user answering the conflict dialog, so it means overwrite regardless of
          // what is on disk — the If-Match wildcard. Re-sending the stale ETag is what made
          // "overwrite" impossible: the server refused it for the same reason it refused the first
          // attempt, and the dialog reopened forever.
          opts?.force ? "*" : output === sourcePath && etag !== undefined ? etag : undefined,
        );
        setEditingMd(false);
        setDraftMd("");
        toastSuccess(
          output === sourcePath
            ? S.files.docxSavedOver
            : S.files.docxSavedAs(output.split("/").pop() ?? output),
        );
        void previewPath(output, { refresh: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && output === sourcePath) {
          setMdConflict({ path: sourcePath });
        } else {
          toastError(apiErrorText(err));
        }
      } finally {
        setSavingMd(false);
      }
    },
    [preview, session.sessionId, previewPath],
  );

  const saveMdEdit = useCallback(
    async (content: string, opts?: { force?: boolean }): Promise<void> => {
      if (!preview || preview.kind !== "md") return;
      setSavingMd(true);
      try {
        const dataBase64 = btoa(unescape(encodeURIComponent(content)));
        const newEtag = await api.uploadWorkspaceFile(
          session.sessionId,
          preview.path,
          dataBase64,
          !opts?.force ? preview.etag : undefined,
        );
        // Patch the ETag immediately so the next save carries the current version — previewPath's
        // refresh will overwrite preview.etag with the same value once it lands, so this is
        // belt-and-braces against a slow refresh.
        if (newEtag !== null) {
          setPreview((p) => (p && p.path === preview.path ? { ...p, etag: newEtag } : p));
        }
        toastSuccess(S.files.uploaded);
        // Re-fetch the file in the background so the rendered/source views reflect what we
        // just wrote. The editor stays mounted with `value={draftMd}` (still = `content`),
        // so the user can keep typing. A new preview.nonce remounts the editor on a future
        // view toggle; the remount re-snapshots draftMd, not preview.content, so no keystroke
        // is lost.
        void previewPath(preview.path, { refresh: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.code === "file_conflict") {
          setMdConflict({ path: preview.path });
        } else {
          toastError(apiErrorText(err));
        }
      } finally {
        setSavingMd(false);
      }
    },
    [preview, session.sessionId, previewPath],
  );

  /** Discard edits: clear the editor mount (the editor's own onChange buffer goes with it)
   *  and exit edit mode. The Preview.content is left untouched on purpose — it is the
   *  source of truth for the rendered view, and a stray edit would re-mount MarkdownEditor
   *  on a stale value. */
  /**
   * Enter edit mode on a .docx.
   *
   * No content is carried across, which is the point: the editor reads the file itself, from the
   * same URL the preview just rendered, so the document the user edits is the document they were
   * looking at. All this does is re-present the same file as an editable one and remember where the
   * save should go — `docxSource` is that memory, and it is what routes the write and what the
   * response's ETag is checked against.
   *
   * The state is called `md` because a .docx edit reuses the Markdown preview's shape; the editor
   * mounted for it is not the Markdown one.
   */
  const enterDocxEdit = useCallback((): void => {
    if (!preview || preview.kind !== "document") return;
    const payload = preview.document;
    if (payload?.kind !== "html") return;
    setEditingMd(true);
    setRichView("edit");
    setPreview((current) =>
      current?.kind === "document"
        ? {
            ...current,
            kind: "md",
            content: payload.html,
            docxSource: { path: current.path, etag: current.etag },
          }
        : current,
    );
  }, [preview]);

  /** True while the open preview is a .docx being edited through Markdown. */
  const editingDocx = preview?.kind === "md" && preview.docxSource !== undefined;

  /**
   * What the Save action does — the toolbar button and the editor's Cmd/Ctrl-S both call this.
   *
   * They must not diverge, and they did: the toolbar asked where an edited .docx should go while
   * the keymap called `saveMdEdit` with no target, which falls back to the source path. So the same
   * action had two behaviours, and the shortcut was the one that destroyed the original.
   *
   * A .docx saves **in place**, which is what "save" means in a document editor; the copy is the
   * separate action (`saveDocxCopy`). That is safe to offer without a dialog because there is
   * nothing to warn about: the engine stores the document it was given, so a save returns the file
   * the user was looking at rather than a rebuild of it. An earlier version did ask in a modal, and
   * the modal was the part that stopped responding — it opened from a value derived from the
   * preview, and one absent field took the whole handler down with it.
   */
  const requestSave = useCallback((): void => {
    if (!preview || preview.kind !== "md") {
      // Reached only when the toolbar is rendering a preview this handler cannot see, which is a
      // state mismatch rather than a user situation. It must not be silent: "I clicked Save and
      // nothing happened" is the worst possible answer.
      toastError(S.files.editSaveUnavailable);
      return;
    }
    if (!preview.docxSource) {
      void saveMdEdit(draftMd);
      return;
    }
    // Save writes the document in place — the .docx the user opened, which is what "save" means
    // in a document editor. The bytes come from the editor rather than from React state: the
    // engine owns the parse and the serializer, and a second copy here would be a second version.
    // `output === sourcePath` is what makes `saveDocxBytes` send If-Match, so the write still
    // refuses to clobber a version the Agent changed underneath it.
    void (async () => {
      const handle = docxRef.current;
      if (handle === null) {
        // The editor has not registered its handle yet. A different failure from a preview
        // mismatch, and it reports itself as itself so a screenshot says which one it was.
        toastError(S.files.editSaveNoDocument);
        return;
      }
      const bytes = await handle.save();
      if (bytes === null) {
        toastError(S.files.editSaveNoDocument);
        return;
      }
      await saveDocxBytes(bytes, { docxOutput: preview.path });
    })();
  }, [preview, draftMd, saveMdEdit, saveDocxBytes]);

  /**
   * Save as: write a copy beside the original and leave that one alone.
   *
   * The name is derived rather than asked for. A dialog here would be the second time this flow
   * stopped working — the first was a dialog whose open was sequenced after a value derived from
   * the preview, and a preview field that turned out to be absent took the whole handler down with
   * it. Nothing derived is allowed on the path to a visible effect now, and the one thing a
   * derived name can get wrong (a collision) is refused by the server with a message that says so.
   */
  const saveDocxCopy = useCallback((): void => {
    if (!preview || preview.kind !== "md" || !preview.docxSource) return;
    const stem = (preview.name ?? "").replace(/\.docx$/i, "");
    void (async () => {
      const handle = docxRef.current;
      if (handle === null) {
        toastError(S.files.editSaveNoDocument);
        return;
      }
      const bytes = await handle.save();
      if (bytes === null) {
        toastError(S.files.editSaveNoDocument);
        return;
      }
      await saveDocxBytes(bytes, {
        docxOutput: `${stem === "" ? "document" : stem}-edited.docx`,
      });
    })();
  }, [preview, saveDocxBytes]);

  /**
   * The Save button's handler.
   *
   * A `try`/`catch` around it is not defensive padding: an exception thrown inside a React event
   * handler goes to `window.onerror` and nowhere else, so the button simply stops responding with
   * no dialog, no toast and nothing in the UI to explain it. Reporting it here is the difference
   * between a bug that can be diagnosed from a screenshot and one that has to be reproduced with a
   * debugger attached.
   */
  const onSaveClick = useCallback((): void => {
    try {
      requestSave();
    } catch (err) {
      toastError(S.files.editSaveFailed(err instanceof Error ? err.message : String(err)));
    }
  }, [requestSave]);

  const cancelMdEdit = useCallback((): void => {
    setEditingMd(false);
    setDraftMd("");
  }, []);

  /** Enter edit mode: prime the draft with the current rendered content and mount the
   *  editor. The key on MarkdownEditor below uses `preview.nonce` so navigating to a
   *  different file (or saving + reloading) remounts the editor and reseeds CodeMirror. */
  const enterMdEdit = useCallback((): void => {
    setDraftMd(preview?.content ?? "");
    setEditingMd(true);
  }, [preview?.content]);

  // External navigation command (clicking a file chip in a message / a file card): navigates to
  // the directory and previews the target path. Also refreshes the list: the target is most
  // likely a file the Agent just wrote, so the cached list is very likely stale; and when it's
  // the same directory, setPath is a same-value no-op that won't trigger the fetch effect, so it must be explicitly bumped.
  //
  // Each openRequest object is handled exactly once (the ref guard): this effect also
  // re-runs when previewPath's identity changes with session.sessionId, at which point
  // openRequest is still the OLD session's request — the parent clears it only after
  // child effects. Replaying it against the new session would resurrect the preview the
  // session-switch reset just cleared, for isolated HTML as a committed iframe onto a
  // path the new Workspace doesn't have (a raw 404 page). browsePath creates a fresh
  // object per click, so re-clicking the same file still re-triggers.
  const handledOpenRequest = useRef<{ path: string } | null>(null);
  useEffect(() => {
    if (!openRequest || handledOpenRequest.current === openRequest) return;
    handledOpenRequest.current = openRequest;
    const target = openRequest.path;
    const dir = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
    setPath(dir);
    setReloadTick((t) => t + 1);
    void previewPath(target);
  }, [openRequest, previewPath]);

  const doUpload = (files: File[]) => {
    setUploading(true);
    setError(null);
    void (async () => {
      try {
        for (const file of files) {
          const b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const url = reader.result as string;
              resolve(url.slice(url.indexOf(",") + 1)); // Strip the data:...;base64, prefix
            };
            reader.onerror = () => reject(new Error("read failed"));
            reader.readAsDataURL(file);
          });
          await api.uploadWorkspaceFile(session.sessionId, joinWorkspacePath(path, file.name), b64);
        }
        toastSuccess(S.files.uploaded);
        setReloadTick((t) => t + 1);
      } catch (err) {
        toastError(apiErrorText(err));
      } finally {
        setUploading(false);
      }
    })();
  };

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? [...e.target.files] : [];
    e.target.value = "";
    if (files.length === 0) return;
    // Uploads overwrite same-name files: names already present in the loaded listing
    // confirm first (the picker is stashed — confirm continues, cancel drops it).
    const existing = new Set((data?.res.entries ?? []).map((entry) => entry.name));
    const clashes = files.filter((f) => existing.has(f.name)).map((f) => f.name);
    if (clashes.length > 0) setPendingUpload({ files, clashes });
    else doUpload(files);
  };

  const crumbs = path === "" ? [] : path.split("/");
  /**
   * A navigation fetch is in flight: the rendered rows belong to a different directory than
   * the one being loaded. Entry rows and breadcrumbs are disabled for the duration — the
   * base-bound targets above are what make clicks safe regardless of timing; this is the
   * user-visible feedback. Derived, not stored: initial load and same-path refreshes
   * (reloadTick) don't count, and a failed navigation renders `error` instead of rows, so
   * the disabled state can never outlive the fetch that justified it.
   */
  const busy = error === null && data !== null && data.base !== path;

  if (preview !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* flex-wrap: the panel can be dragged down to a 320px minimum width, narrower than this
            row's uncompressible content (back + view toggle + download ~= 370px+); without
            wrapping, the panel's overflow-hidden would clip the right-side buttons off. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
          <button
            type="button"
            onClick={() => {
              // Refreshes in passing when returning to the list: the Agent may have written new files during the preview.
              setPreview(null);
              setReloadTick((t) => t + 1);
            }}
            title={S.files.backToList}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <GlyphIcon d="M15 18l-6-6 6-6" size={ICON_SIZE.rowLead} />
            {S.files.backToList}
          </button>
          {/* Shows only the filename (full path goes into the title hover tooltip): the
              directory prefix and extension badge are both information the filename already
              carries, and on a narrow panel they'd just crowd out the title space. */}
          <span
            className="min-w-0 flex-1 truncate font-mono text-sm font-semibold"
            title={preview.path}
          >
            {preview.name}
          </span>
          {/* Markdown edit-mode toolbar: Save commits the pending edits via
              uploadWorkspaceFile (with If-Match for conflict detection); Cancel drops the
              draft and returns to the rendered view of the saved file. The view-mode pills
              (rendered / source / edit) stay available while editing so the user can preview
              their in-progress draft without losing keystrokes — switching between the three
              views routes the body through `draftMd` (their current text) instead of
              `preview.content` (the last-saved bytes). */}
          {/* A converted document gets one action: edit it. The pane already holds the editing
              basis, so this switches to the Markdown editor the workspace uses for .md files
              rather than introducing a second editor — see `enterDocxEdit`. Only for the HTML
              payload, which is the .docx case; a workbook has its own cell editing and a deck is
              read-only. */}
          {preview.kind === "document" && preview.document?.kind === "html" ? (
            <button
              type="button"
              onClick={enterDocxEdit}
              className="inline-flex shrink-0 items-center rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {S.files.edit}
            </button>
          ) : null}
          {preview.kind === "md" ? (
            <>
              <div className="flex shrink-0 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800">
                {(
                  [
                    ["rendered", S.files.htmlRendered],
                    ["source", S.files.htmlSource],
                    ["edit", S.files.edit],
                  ] as const
                ).map(([key, label]) => {
                  const active =
                    key === "edit" ? editingMd && richView === "edit" : richView === key;
                  const onClick = () => {
                    if (key === "edit") {
                      if (!editingMd) enterMdEdit();
                      setRichView("edit");
                    } else {
                      setRichView(key);
                    }
                  };
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={onClick}
                      className={`rounded px-2 py-0.5 text-xs transition-colors duration-150 ${
                        active
                          ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
                          : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {editingMd && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={cancelMdEdit}
                    disabled={savingMd}
                    className="inline-flex shrink-0 items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                  >
                    {S.files.editCancel}
                  </button>
                  {/* Save writes the document in place; Save as writes a copy. Two buttons rather
                      than one button and a dialog: "save" meaning "overwrite what I opened" is what
                      a document editor does, and the dialog was the part that stopped responding. */}
                  {editingDocx && (
                    <button
                      type="button"
                      onClick={saveDocxCopy}
                      disabled={savingMd}
                      className="inline-flex shrink-0 items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                    >
                      {S.files.docxSaveAsNew}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onSaveClick}
                    disabled={savingMd}
                    className="inline-flex shrink-0 items-center rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {S.files.editSave}
                  </button>
                </div>
              )}
            </>
          ) : preview.kind === "html" ? (
            <div className="flex shrink-0 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800">
              {(
                [
                  ["rendered", S.files.htmlRendered],
                  ["source", S.files.htmlSource],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRichView(key)}
                  className={`rounded px-2 py-0.5 text-xs transition-colors duration-150 ${
                    richView === key
                      ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
                      : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {/* Ghost style, matching the toolbar's upload label (text-xs, transparent until hover) — the bordered secondary look stood out from every neighbor. */}
          {/* rel="noopener noreferrer" is load-bearing, not boilerplate: the preview must
              not keep a handle back to this window, which is the whole point of serving
              it from a separate origin. */}
          {/\.html?$/i.test(preview.name) && (
            <a
              href={api.workspaceFilePreviewUrl(session.sessionId, preview.path)}
              target="_blank"
              rel="noopener noreferrer"
              title={previewIsolated ? undefined : S.files.previewNotIsolatedHint}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              {S.files.openInNewTab}
              {!previewIsolated && (
                <span aria-label={S.files.previewNotIsolatedHint} className={toneInk.attention}>
                  ⚠
                </span>
              )}
            </a>
          )}
          {/* Multi-format export menu (MD / HTML / PDF / DOCX / EPUB / RTF / TXT). PDF and
              Pandoc-backed items gate themselves on capabilities; MD and HTML always run. */}
          {(preview.kind === "md" || preview.kind === "html") && (
            <ExportMenu
              sessionId={session.sessionId}
              filePath={preview.path}
              fileName={preview.name}
              markdown={preview.content ?? ""}
            />
          )}
          <a
            href={api.workspaceFileUrl(session.sessionId, preview.path, true)}
            download={preview.name}
            className="inline-flex shrink-0 items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            {S.files.download}
          </a>
        </div>
        {/* scrollbar-gutter: an SVG carries no pixel size, so its height is whatever its width
            divides to — which makes the content height a function of the scrollbar's presence.
            Without a reserved gutter that closes a loop: content overflows -> scrollbar takes
            width -> the image shrinks -> content fits -> scrollbar goes -> repeat, forever, as
            a visible shake. Reserving it always breaks the feedback path (and is inert where
            scrollbars are overlays). */}
        {/* One scrollbar for the panel, and the editor is the exception that owns it instead.
            Everything else here is content of unknown height — a rendered page, a table, an image —
            so this box scrolls. The .docx editor is not that: it is a fixed-height surface with a
            viewport that scrolls its own pages, and nesting the two produced the worst of both. The
            outer box sized itself to the document, the document grew the panel, and the scrollbar
            ended up on the window while the inner viewport never scrolled at all. */}
        <div
          className={`flex min-h-0 flex-1 flex-col p-3 [scrollbar-gutter:stable] ${
            editingDocx ? "overflow-hidden" : "overflow-auto"
          }`}
        >
          {preview.kind === "image" ? (
            // Keyed on the nonce like the isolated HTML iframe: the src alone is unchanged
            // when the same file is re-read, so only a remount re-requests the bytes the
            // Agent just rewrote.
            <img
              key={preview.nonce}
              src={api.workspaceFileUrl(session.sessionId, preview.path)}
              alt={preview.name}
              className="max-w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : preview.kind === "pdf" ? (
            <iframe
              key={preview.nonce}
              src={api.workspaceFileUrl(session.sessionId, preview.path)}
              title={preview.name}
              className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : preview.kind === "html" && richView === "rendered" ? (
            previewIsolated ? (
              // Same URL and serving path as "open in new tab": the app-origin redirect mints
              // a token and 302s to the separate preview origin, where the document has a real
              // base URL — relative subresources (<img src="foo.png">, app.js, style.css)
              // resolve and load, and storage works, exactly as in the new-page preview.
              // allow-same-origin is safe here precisely because the document IS on a separate
              // origin: it grants the preview origin's identity, not the app's, so the frame
              // still can't reach the app's cookies or DOM. Popups stay sandboxed (no
              // allow-popups-to-escape-sandbox); allow-downloads keeps download links inside
              // the page working, as they do in the new tab. The key remounts the iframe on
              // every previewPath call — its src alone wouldn't change when the same file is
              // re-opened after the Agent rewrote it.
              <iframe
                key={preview.nonce}
                src={api.workspaceFilePreviewUrl(session.sessionId, preview.path)}
                title={preview.name}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
              />
            ) : preview.content === undefined ? (
              // Only reachable when previewIsolated flipped to false after an isolated
              // preview mounted without content: the lazy source effect is already fetching
              // it, and the srcDoc fallback renders once it lands.
              sourceError !== null ? (
                <p className="text-sm text-red-600 dark:text-red-400">{sourceError}</p>
              ) : (
                <SkeletonList rows={6} />
              )
            ) : (
              // No separate preview origin: srcDoc fallback. sandbox allows scripts but
              // **without allow-same-origin**: the iframe has an opaque origin, so scripts can
              // run to fully render the page, yet can't read the app's same-origin cookies /
              // DOM (an XSS defense). The storage shim is injected to avoid a SecurityError
              // when a script accesses localStorage from an opaque origin. srcdoc has no real
              // base URL, so relative subresources cannot resolve here — that's what the
              // isolated branch above fixes.
              <iframe
                srcDoc={withStorageShim(preview.content)}
                title={preview.name}
                sandbox="allow-scripts"
                className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
              />
            )
          ) : preview.kind === "md" && richView === "edit" && editingMd ? (
            // Edit view. A .docx gets the rich-text editor and a .md gets the Markdown one: a Word
            // document is shown as the document reads, and a Markdown file as the source it is.
            // The `key` re-mounts on every new edit (different preview.nonce), which is how either
            // editor picks up the latest content as its initial state — both snapshot `value` on
            // mount and ignore later changes by design. No surrounding `h-full` wrapper: the
            // editors self-size, so a 1-line document isn't padded out to the panel's full height
            // and the outer panel doesn't grow a nested scrollbar (the bug behind #41.2).
            // `gap-2` and a column, because the toolbar sits above an editor that needs a definite
            // height: `min-h-0` on both is what lets the document scroll inside its own viewport
            // instead of growing this column and handing the scrollbar to the panel around it.
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {editingDocx ? (
                <Suspense
                  fallback={
                    <p className="px-1 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {S.files.docxPreviewLoading}
                    </p>
                  }
                >
                  <DocxSurface
                    key={`docx-edit-${preview.nonce}`}
                    sessionId={session.sessionId}
                    path={preview.path}
                    mode="edit"
                    onHandle={setDocxHandle}
                    onSave={(bytes) => void saveDocxBytes(bytes, { docxOutput: preview.path })}
                  />
                </Suspense>
              ) : (
                <MarkdownEditor
                  key={`md-edit-${preview.nonce}`}
                  value={draftMd}
                  onChange={setDraftMd}
                  onSave={requestSave}
                  onCancel={cancelMdEdit}
                  saving={savingMd}
                />
              )}
            </div>
          ) : preview.kind === "md" && richView === "rendered" ? (
            // Rendered view. A .docx has no Markdown to render, so it shows the same surface the
            // edit view uses, in read-only mode: one rendering, toggled rather than swapped. The
            // Markdown path below keeps preferring the in-flight draft over the on-disk content, so
            // toggling to "rendered" while editing shows the user's latest keystrokes.
            editingDocx ? (
              <Suspense
                fallback={
                  <p className="px-1 py-2 text-sm text-gray-500 dark:text-gray-400">
                    {S.files.docxPreviewLoading}
                  </p>
                }
              >
                <DocxSurface
                  key={`docx-view-${preview.nonce}`}
                  sessionId={session.sessionId}
                  path={preview.path}
                  mode="view"
                />
              </Suspense>
            ) : (
              (() => {
                const body = editingMd ? draftMd : (preview.content ?? "");
                return (
                  <>
                    <div className="md-body text-base leading-relaxed text-gray-800 dark:text-gray-100">
                      <RenderedMd
                        body={body}
                        fileNonce={preview.nonce}
                        filePath={preview.path}
                        sessionId={session.sessionId}
                        highlight={body.length <= HIGHLIGHT_LIMIT}
                        // previewPath is itself stable (useCallback with [session.sessionId] —
                        // see previewPathRef comment); pass it directly so the memoized child
                        // never sees a new onLinkClick identity on parent re-renders. An inline
                        // `(t) => void previewPath(t)` would defeat this whole memoization: every
                        // WorkspaceBrowser commit would flip the prop, the useMemo inside would
                        // rebuild the components map, every fenced block would be a new component
                        // type, and MermaidBlock would unmount/remount on each frame.
                        onLinkClick={previewPath}
                      />
                    </div>
                    {preview.truncated && (
                      <p className="mt-1 text-xs text-gray-400">… {S.files.previewTruncated}</p>
                    )}
                  </>
                );
              })()
            )
          ) : preview.kind === "document" && preview.document ? (
            <DocumentPreviewView
              payload={preview.document}
              sessionId={session.sessionId}
              path={preview.path}
              onSaveCells={async (edits) => {
                await api.documentCellEdits(session.sessionId, preview.path, edits, preview.etag);
                // Re-read so the grid shows what is actually on disk — the surgical write
                // normalizes cell formatting (a number stored as text comes back as a number),
                // and a grid still showing the typed value would disagree with the file.
                void previewPath(preview.path, { refresh: true });
              }}
            />
          ) : preview.kind === "text" || preview.kind === "html" || preview.kind === "md" ? (
            preview.content === undefined ? (
              // Isolated HTML reaches the Source view before its lazy fetch lands: show a
              // skeleton (or the fetch's own error) — toggling back to Rendered is
              // unaffected, and re-entering Source retries the fetch.
              sourceError !== null ? (
                <p className="text-sm text-red-600 dark:text-red-400">{sourceError}</p>
              ) : (
                <SkeletonList rows={6} />
              )
            ) : (
              // The source view reuses the message stream's CodeBlock: Shiki dual-theme
              // highlighting + language label + copy button, no line wrapping, horizontal scroll
              // instead (wrapping code is a disaster for readability, see the old mobile styling).
              // While editing, prefer the in-flight draft over the on-disk content so the
              // user sees the bytes they just typed (a preview.content re-read happens on save
              // and lands in the background; the user toggling to source right now should not
              // see yesterday's bytes).
              (() => {
                // A .docx has no "source view": it is a binary package, and the preview's content is
                // the extractor's HTML rather than the file's text. The toggle is hidden for it
                // (`editingDocx`), so this only has to be a defined value, not a useful one.
                const sourceBody = editingMd ? draftMd : preview.content;
                return (
                  <>
                    <CodeBlock
                      language={languageForExtension(extOf(preview.name))}
                      code={sourceBody}
                      highlight={sourceBody.length <= HIGHLIGHT_LIMIT}
                    />
                    {preview.truncated && !editingMd && (
                      <p className="mt-1 text-xs text-gray-400">… {S.files.previewTruncated}</p>
                    )}
                  </>
                );
              })()
            )
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{S.files.previewUnsupported}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: breadcrumbs + actions */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPath("");
          }}
          className="rounded px-1.5 py-0.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {S.files.root}
        </button>
        {crumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-gray-300 dark:text-gray-700">/</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
              className="max-w-32 truncate rounded px-1 py-0.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {seg}
            </button>
          </span>
        ))}
        <span className="flex-1" />
        {/* Details: a popup card showing the full absolute Workspace path (break-all wraps in full, never truncated). */}
        <Dropdown
          open={showPath}
          setOpen={setShowPath}
          menuClass="right-0 top-full mt-1 w-max max-w-72 origin-top-right"
          button={
            <Button
              size="sm"
              variant={showPath ? "primary" : "ghost"}
              onClick={() => setShowPath((v) => !v)}
            >
              {S.files.details}
            </Button>
          }
        >
          <div className="px-3.5 py-2.5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {S.files.workspacePath}
            </p>
            <p className="mt-1 break-all font-mono text-xs leading-5">{session.workspace}</p>
          </div>
        </Dropdown>
        <Button size="sm" variant="ghost" onClick={() => setReloadTick((t) => t + 1)}>
          {S.files.refresh}
        </Button>
        {/* Matches the same visual style and font size (sm = text-xs) as the adjacent ghost Buttons (Details/Refresh): no border, light background on hover. */}
        <label className="inline-flex cursor-pointer items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 focus-within:ring-2 focus-within:ring-gray-400/30 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100">
          <HiddenFileInput multiple onChange={onUpload} disabled={uploading} />
          {uploading ? S.common.saving : S.files.upload}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : data === null ? (
          <SkeletonList rows={6} />
        ) : data.res.entries.length === 0 ? (
          <p className="px-3 py-3 text-sm text-gray-400">{S.files.empty}</p>
        ) : (
          // No "up a level" row: going up a level is done via the toolbar breadcrumbs (root / any segment is clickable).
          // While a navigation is in flight (busy) the stale rows stay visible but dimmed and inert.
          <ul
            aria-busy={busy}
            className={`divide-y divide-gray-100 dark:divide-gray-800/60 ${busy ? "opacity-60" : ""}`}
          >
            {data.res.entries.map((entry) => (
              <li key={entry.name}>
                <div className="group flex items-center gap-2 px-3 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      // Joined against the listing's own base (see the data state comment): a second
                      // click on the same stale row resolves to the same target, not a deeper one.
                      const target = joinWorkspacePath(data.base, entry.name);
                      if (entry.kind === "dir") setPath(target);
                      else void previewPath(target);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={entry.name}
                  >
                    <span className="shrink-0 text-gray-400" aria-hidden>
                      {entry.kind === "dir" ? (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                        >
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                        >
                          <path d="M6 3h8l4 4v14H6zM14 3v4h4" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                  </button>
                  <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
                    {entry.kind === "file" ? formatBytes(entry.sizeBytes) : ""}
                  </span>
                  <span className="hidden shrink-0 font-mono text-xs text-gray-400 sm:block dark:text-gray-500">
                    {entry.mtime ? formatDateTime(entry.mtime) : ""}
                  </span>
                  {entry.kind === "file" && (
                    <a
                      href={api.workspaceFileUrl(
                        session.sessionId,
                        joinWorkspacePath(data.base, entry.name),
                        true,
                      )}
                      download={entry.name}
                      title={S.files.download}
                      className="shrink-0 rounded p-1 text-gray-300 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 group-hover:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                      </svg>
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Upload-overwrite confirmation: same-name files in this directory get replaced. */}
      <ConfirmModal
        open={pendingUpload !== null}
        title={S.files.overwriteTitle}
        tone="primary"
        confirmLabel={S.files.upload}
        onClose={() => setPendingUpload(null)}
        onConfirm={() => {
          if (pendingUpload) doUpload(pendingUpload.files);
          setPendingUpload(null);
        }}
      >
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.files.overwriteConfirm(pendingUpload?.clashes.length ?? 0)}
          </p>
          <ul className="max-h-40 overflow-y-auto rounded-md border border-gray-200 px-3 py-1.5 dark:border-gray-800">
            {(pendingUpload?.clashes ?? []).map((name) => (
              <li key={name} className="truncate py-0.5 font-mono text-xs" title={name}>
                {name}
              </li>
            ))}
          </ul>
        </div>
      </ConfirmModal>

      {/* Save-conflict resolution: server rejected save with 409 file_conflict. The user picks
          Reload (discard edits, re-fetch the latest file from disk; the standard advice) or
          Overwrite (force-save by re-sending without If-Match — only safe if the user has
          confirmed the latest remote content is no longer relevant to them). */}
      <ConfirmModal
        open={mdConflict !== null}
        title={S.files.editConflictBanner}
        tone="danger"
        confirmLabel={S.files.edit}
        secondaryLabel={S.files.editSave}
        onClose={() => setMdConflict(null)}
        onConfirm={() => {
          // Reload: discard the in-memory draft, drop the editor mount, refetch the file.
          const path = mdConflict?.path;
          setMdConflict(null);
          setEditingMd(false);
          setDraftMd("");
          if (path) void previewPath(path, { refresh: true });
        }}
        onSecondary={() => {
          // Overwrite: re-send the same document without If-Match. The force flag bypasses the
          // server's conflict check — once it's done the local ETag is no longer current anyway,
          // so a future If-Match would fail; that's why we drop the modal here.
          setMdConflict(null);
          if (editingDocx) {
            // The bytes are taken again rather than cached: the editor is still mounted behind the
            // modal, and what the user is overwriting with is what is in the editor now.
            void (async () => {
              const bytes = await docxRef.current?.save();
              if (bytes === null || bytes === undefined) return;
              await saveDocxBytes(bytes, { force: true });
            })();
            return;
          }
          void saveMdEdit(draftMd, { force: true });
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.files.editConflictBanner}</p>
      </ConfirmModal>
    </div>
  );
}
