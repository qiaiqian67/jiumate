/**
 * Marketplace-source management (features/plugins/sources-manager.tsx): where plugins and skills
 * are fetched from.
 *
 * Three source kinds, and the difference between them is not cosmetic:
 *
 * - **Marketplace** — a repository the server indexes. Adding one is remote and can fail.
 * - **Local path** — a directory on the machine running the *server*. This matters more than it
 *   looks: the path is resolved server-side, so a path valid on the developer's laptop can be
 *   absent on a deployed host, and the honest failure mode is to say so rather than to list a
 *   source that will silently contribute nothing.
 * - **Bundled** — the product's own library. Shown for reference and not removable, so the list
 *   says where everything came from rather than implying the user configured it all.
 *
 * **Removal is qualified, not silent.** Removing a source does not remove what was already
 * installed from it, and a confirmation that implied otherwise would teach the user the wrong
 * model of the feature. The text says exactly that: installed items stay, updates stop.
 *
 * Storage is local (see `extension-state.ts`) under the agreed user-level scope. The validation
 * here is shape-level only — a URL that parses, a path that is non-empty — because whether the
 * path exists is a question about the *server's* filesystem, which the browser cannot answer and
 * which the backend endpoint will settle when the backend work lands.
 */
import { useCallback, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastInfo } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import { ExtensionSwitch } from "./extension-ui";

/** What a source points at. Plugins and skills can come from different places. */
export type SourceKind = "plugin" | "skill";

/** Marketplace (indexed repository) or a directory on the server's filesystem. */
export type SourceType = "market" | "local";

export interface ExtensionSource {
  id: string;
  name: string;
  type: SourceType;
  /** The repository URL; null for a local source. */
  url: string | null;
  /** The server-side directory; null for a marketplace. */
  path: string | null;
  /** Which surface this source feeds. */
  kind: SourceKind;
  /** False once a source is added but switched off — kept in the list rather than removed. */
  enabled: boolean;
  /** The product's own library: listed, never removable. */
  builtin?: boolean;
}

/** The product's own library, always present. Its absence would make the list read as empty. */
export const BUILTIN_SOURCE: ExtensionSource = {
  id: "builtin:library",
  name: "官方插件库",
  type: "market",
  url: null,
  path: null,
  kind: "plugin",
  enabled: true,
  builtin: true,
};

const SOURCE_ICON = "M4 7h6v6H4zM14 7h6v6h-6zM4 16h6v3H4zM14 16h6v3h-6z";

/**
 * Shape-level validity of a source.
 *
 * Deliberately shallow: a browser cannot see the server's filesystem, so "is this path real" is
 * not answerable here and pretending otherwise would produce a confident wrong answer. Returns a
 * key into the strings so the message can be localised rather than hard-coded.
 */
export function validateSource(input: {
  type: SourceType;
  url: string;
  path: string;
}): "ok" | "invalid" {
  const value = input.type === "market" ? input.url.trim() : input.path.trim();
  if (value === "") return "invalid";
  if (input.type === "market") {
    // http(s) only: a marketplace is fetched over the network, and accepting `file://` here
    // would be a way to point the server at an arbitrary local file.
    return /^https?:\/\/.+/i.test(value) ? "ok" : "invalid";
  }
  return "ok";
}

/** A stable id for a new source, derived from its target so re-adding does not duplicate. */
export function sourceIdFor(type: SourceType, value: string): string {
  return `${type}:${value.trim().toLowerCase().replace(/\s+/g, "-")}`;
}

export function SourcesManager({
  open,
  onClose,
  sources,
  onAdd,
  onRemove,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  sources: readonly ExtensionSource[];
  onAdd: (source: ExtensionSource) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, on: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<SourceType>("market");
  const [kind, setKind] = useState<SourceKind>("plugin");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ExtensionSource | null>(null);

  const error = useMemo(
    () =>
      target.trim() === ""
        ? null
        : validateSource({ type, url: type === "market" ? target : "", path: target }),
    [type, target],
  );

  const submit = useCallback(() => {
    if (validateSource({ type, url: type === "market" ? target : "", path: target }) !== "ok")
      return;
    const value = target.trim();
    // Name is optional: a bare URL or path is a usable label, and making the user invent one is
    // a field they will type nonsense into.
    onAdd({
      id: sourceIdFor(type, value),
      name: name.trim() || value,
      type,
      kind,
      url: type === "market" ? value : null,
      path: type === "local" ? value : null,
      enabled: true,
    });
    toastInfo(S.plugins.sourceAdded);
    setName("");
    setTarget("");
    setAdding(false);
  }, [type, kind, name, target, onAdd]);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={S.plugins.sourcesTitle}
        widthClass="sm:max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            {adding ? (
              <>
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  {S.common.cancel}
                </Button>
                <Button
                  variant="primary"
                  disabled={error !== null || target.trim() === ""}
                  onClick={submit}
                >
                  {S.common.create}
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={onClose}>
                {S.common.close}
              </Button>
            )}
          </div>
        }
      >
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{S.plugins.sourcesDesc}</p>

        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {sources.map((src) => (
            <li key={src.id} className="flex items-center gap-2 py-2">
              <GlyphIcon d={SOURCE_ICON} size={15} className="shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-800 dark:text-gray-100">{src.name}</p>
                <p className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                  {src.type === "market"
                    ? (src.url ?? S.plugins.sourceTypeMarket)
                    : (src.path ?? S.plugins.sourceTypeLocal)}
                  {" · "}
                  {src.kind === "plugin" ? S.plugins.sourceKindPlugin : S.plugins.sourceKindSkill}
                </p>
              </div>
              {!src.builtin && (
                <>
                  {/* A disabled source stays in the list rather than disappearing: the user
                      switched it off deliberately, and a source that vanishes when toggled reads
                      as though the switch failed to save. */}
                  <ExtensionSwitch
                    on={src.enabled}
                    label={src.name}
                    onToggle={() => onToggle(src.id, !src.enabled)}
                  />
                  <Button size="sm" variant="ghost" onClick={() => setPendingDelete(src)}>
                    {S.plugins.sourceRemove}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>

        {adding && (
          <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={type === "market" ? "primary" : "secondary"}
                onClick={() => setType("market")}
              >
                {S.plugins.sourceTypeMarket}
              </Button>
              <Button
                size="sm"
                variant={type === "local" ? "primary" : "secondary"}
                onClick={() => setType("local")}
              >
                {S.plugins.sourceTypeLocal}
              </Button>
              <span className="flex-1" />
              <Button
                size="sm"
                variant={kind === "plugin" ? "primary" : "secondary"}
                onClick={() => setKind("plugin")}
              >
                {S.plugins.sourceKindPlugin}
              </Button>
              <Button
                size="sm"
                variant={kind === "skill" ? "primary" : "secondary"}
                onClick={() => setKind("skill")}
              >
                {S.plugins.sourceKindSkill}
              </Button>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={S.plugins.sourceNamePlaceholder}
              aria-label={S.plugins.sourceNameLabel}
              className="h-8"
            />
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={
                type === "market" ? S.plugins.sourceUrlPlaceholder : S.plugins.sourcePathPlaceholder
              }
              aria-label={type === "market" ? S.plugins.sourceUrlLabel : S.plugins.sourcePathLabel}
              className="h-8"
            />
            {/* Only shown once something has been typed: an empty form is not yet wrong. */}
            {error === "invalid" && (
              <p className="text-xs text-red-600 dark:text-red-400">{S.plugins.sourceInvalid}</p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={S.plugins.sourceRemove}
        headerless
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {S.common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) {
                  onRemove(pendingDelete.id);
                  toastInfo(S.plugins.sourceRemoved);
                }
                setPendingDelete(null);
              }}
            >
              {S.common.confirm}
            </Button>
          </div>
        }
      >
        {/* Says what does NOT happen, which is the part a user gets wrong otherwise. */}
        <p className="text-sm text-gray-700 dark:text-gray-200">
          {pendingDelete ? S.plugins.sourceRemoveConfirm(pendingDelete.name) : ""}
        </p>
      </Modal>
    </>
  );
}
