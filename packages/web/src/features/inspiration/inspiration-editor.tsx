/**
 * The admin's case editor: create a case from a form, or change one that already exists.
 *
 * ## One dialog for both
 *
 * Only the title says which is happening — the same idiom the shortcut editor and the sidebar's
 * rename dialogs use. What differs is the id field: a create derives it from the title and keeps it
 * editable, an edit shows it read-only, because the id is the directory name and the server refuses
 * the mismatch anyway.
 *
 * ## Built the way every other form dialog in this app is
 *
 * A single `space-y-3` column of `Input` / `Textarea` / `Select`, fields at the default size, footer
 * = cancel then primary — the shape `shortcuts-folder.tsx` and `admin-users-page.tsx` use. The three
 * pickers (Agent, skills, tools) are `FieldLabel` + `FormPicker` over a list panel, which is the
 * shape the Agent create dialog uses for its own seed pickers; there is no hand-rolled control here.
 *
 * **Delete is not in this dialog.** A destructive action belongs on the row that names what it
 * removes, and the gallery's card already carries it.
 *
 * ## Nothing in here is free text where a list exists
 *
 * - **Suggested Agent** is a `Select` over the Project's Agents; what is stored is the id.
 * - **Preselected skills** is the shared multi-select panel over the shipped skill catalog.
 * - **Expected tools** is the same panel over the tools the chosen Agent actually has — its built-in
 *   tool table plus its MCP server names. A case is server-global and an Agent is per-Project, so the
 *   list is read from the Agent the case would run on; with no Agent chosen it falls back to the
 *   Project's current one, so the field is never empty for no reason.
 *
 * ## The cover is a glyph or an image, never both
 *
 * One choice, because the card renders one thing. The box IS the upload control (a `<label>` around
 * the file input, the shape every other upload in this app uses); the glyph field beside it is the
 * zero-asset alternative.
 *
 * ## The preview is pasted text, not an upload
 *
 * A preview is a self-contained HTML document — the thing an Agent produced in a Session, pasted
 * back in. An upload field would invite a whole folder of assets, which the case directory cannot
 * hold. Keeping it a textarea also keeps the size cap visible.
 */
import { useEffect, useId, useMemo, useState } from "react";
import type { SkillMetadataItem } from "@jiumate/server/api";
import { Button } from "../../components/ui/button";
import { Field, FieldHint, FieldLabel } from "../../components/ui/field";
import { FormPicker } from "../../components/ui/form-picker";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { SkillPickList } from "../skills/skill-pick-list";
import type { PickableItem } from "../skills/skill-pick-list";
import { addSkillNames, removeSkillNames, toggleSkillName } from "../skills/skill-selection";
import {
  COVER_EXTENSIONS,
  coverUrl,
  defaultCaseId,
  fileToBase64,
  isCoverFilename,
  isShadowing,
  kindLabel,
} from "./inspiration-service";
import type { InspirationCatalogView } from "./inspiration-service";
import { fetchAgentToolNames, fetchSkillCatalog, saveInspirationCase } from "./inspiration-store";
import type {
  InspirationCase,
  InspirationCaseInput,
  InspirationKind,
} from "@jiumate/inspirations";

/**
 * The field caps, mirrored from the package's `constants.ts`.
 *
 * Duplicated on purpose, like the draft-shortcut caps: the server is what enforces them (a bound
 * that lives only in this form is not a bound), and the numbers here drive the counters and the
 * `maxLength` attributes. `test/inspiration-service.test.ts` fails if the two copies drift.
 */
export const TITLE_LIMIT = 120;
export const DESCRIPTION_LIMIT = 600;
export const PROMPT_LIMIT = 20000;
export const PREVIEW_LIMIT = 1024 * 1024;

/** The kinds, in the order the picker lists them. */
const KINDS: readonly InspirationKind[] = ["app", "agent", "skill", "tool", "prompt"];

/**
 * What the dialog holds. Every field is a string because every field is a text control — a number
 * that is momentarily "1e" while being typed must not be coerced to a number and back.
 *
 * `skills` and `tools` are the exception: they are picked from lists, so they are arrays. `coverFile`
 * holds an uploaded image's bytes (read once, when the file is picked) rather than a string, because
 * re-encoding them on every render would be wasteful.
 */
export interface CaseDraft {
  id: string;
  kind: InspirationKind;
  categoryId: string;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  prompt: string;
  promptZh: string;
  /** The suggested Agent's id, or "" for none. */
  agentId: string;
  skills: string[];
  tools: string[];
  coverKind: "glyph" | "image";
  glyph: string;
  /**
   * The image cover the case already has on disk, when it has one. Carried in the draft because the
   * save body has to name it: a cover is a discriminated union on the wire, so "keep the image I
   * already have" is only expressible by naming the file.
   */
  coverFilename: string | null;
  /** A newly picked image, held until save. Null means "keep whatever the case already has". */
  coverFile: { filename: string; dataBase64: string; objectUrl: string } | null;
  previewHtml: string;
  /** Whether the case currently has a preview on disk — drives the "remove preview" behaviour. */
  hasPreview: boolean;
  featured: boolean;
  order: string;
  enabled: boolean;
}

/** An empty draft for a new case: filed under `categoryId`, glyph-covered, nothing picked. */
export function emptyCaseDraft(categoryId: string, prefill: Partial<CaseDraft> = {}): CaseDraft {
  return {
    id: "",
    kind: "app",
    categoryId,
    title: "",
    titleZh: "",
    description: "",
    descriptionZh: "",
    prompt: "",
    promptZh: "",
    agentId: "",
    skills: [],
    tools: [],
    coverKind: "glyph",
    glyph: "✨",
    coverFilename: null,
    coverFile: null,
    previewHtml: "",
    hasPreview: false,
    featured: false,
    order: "0",
    enabled: true,
    ...prefill,
  };
}

/** The draft that edits an existing case, carrying its stored values. */
export function caseDraftOf(one: InspirationCase): CaseDraft {
  return {
    id: one.id,
    kind: one.kind,
    categoryId: one.categoryId,
    title: one.title,
    titleZh: one.titleZh,
    description: one.description,
    descriptionZh: one.descriptionZh,
    prompt: one.prompt,
    promptZh: one.promptZh,
    agentId: one.agentId ?? "",
    skills: [...one.skills],
    tools: [...one.tools],
    coverKind: one.cover.kind,
    glyph: one.cover.kind === "glyph" ? one.cover.glyph : "✨",
    coverFilename: one.cover.kind === "image" ? one.cover.filename : null,
    coverFile: null,
    previewHtml: "",
    hasPreview: one.previewFilename !== null,
    featured: one.featured,
    order: String(one.order),
    enabled: one.enabled,
  };
}

/**
 * The draft that captures a Session as a case — "add this to the library".
 *
 * The session's opening prompt goes into **both** language fields, and its title too, rather than
 * into one of them. Which language a conversation was held in is not something the app knows, and
 * putting the text in both is the honest representation of that: the case reads the same in either
 * UI, and the admin translates whichever side they care about.
 *
 * The suggested Agent is the session's own, and its skills and tools are left empty on purpose: what
 * a run happened to touch is not a statement about what a case needs. The admin picks those.
 */
export function capturedCaseDraft(
  categoryId: string,
  session: { title: string | null; prompt: string; agentId: string | null },
): CaseDraft {
  const title = session.title ?? "";
  return emptyCaseDraft(categoryId, {
    title,
    titleZh: title,
    prompt: session.prompt,
    promptZh: session.prompt,
    agentId: session.agentId ?? "",
    id: defaultCaseId(title),
  });
}

/** An integer read back out of the order field; anything unparseable is 0 (the server's default). */
export function parseOrder(raw: string): number {
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

/** Which rule a draft breaks, as a dictionary key; null when it is saveable. */
export type CaseDraftError =
  "titleRequired" | "idRequired" | "categoryRequired" | "previewTooLarge";

/**
 * Validates a draft the way the server validates a write, so Save is refused here rather than by a
 * 400. The title is required in at least one language — the other side is filled from it on the way
 * in, which is what keeps a case authored in one language readable in both UIs.
 */
export function caseDraftError(draft: CaseDraft): CaseDraftError | null {
  if (draft.title.trim() === "" && draft.titleZh.trim() === "") return "titleRequired";
  if (draft.id.trim() === "") return "idRequired";
  if (draft.categoryId.trim() === "") return "categoryRequired";
  if (new TextEncoder().encode(draft.previewHtml).byteLength > PREVIEW_LIMIT) {
    return "previewTooLarge";
  }
  return null;
}

/** The body a save sends: the case fields, plus the two things that cannot ride on them. */
export function caseSaveBody(draft: CaseDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: draft.id.trim(),
    kind: draft.kind,
    categoryId: draft.categoryId,
    title: draft.title,
    titleZh: draft.titleZh,
    description: draft.description,
    descriptionZh: draft.descriptionZh,
    prompt: draft.prompt,
    promptZh: draft.promptZh,
    agentId: draft.agentId.trim() === "" ? null : draft.agentId.trim(),
    skills: [...draft.skills],
    tools: [...draft.tools],
    cover:
      draft.coverKind === "glyph"
        ? { kind: "glyph", glyph: draft.glyph.trim() === "" ? "✨" : draft.glyph.trim() }
        : draft.coverFile !== null
          ? { kind: "image", filename: draft.coverFile.filename }
          : { kind: "image", filename: draft.coverFilename ?? "cover.png" },
    featured: draft.featured,
    order: parseOrder(draft.order),
    enabled: draft.enabled,
  };
  if (draft.coverFile !== null) {
    body["coverUpload"] = {
      filename: draft.coverFile.filename,
      dataBase64: draft.coverFile.dataBase64,
    };
  }
  // Three intents: a non-empty string writes a preview, an empty one removes it, and leaving the
  // key off keeps whatever is on disk. The editor loads the stored document into the field, so an
  // untouched save writes back what is there rather than dropping it.
  if (draft.previewHtml.trim() !== "") {
    body["previewHtml"] = draft.previewHtml;
  } else if (draft.hasPreview) {
    body["previewHtml"] = null;
  }
  return body;
}

/** The picker panels a `FormPicker` needs open state for. */
type OpenPicker = "skills" | "tools" | null;

export function CaseEditorDialog({
  open,
  one,
  catalog,
  capture,
  onClose,
}: {
  open: boolean;
  /** The case being edited, or null for a create. */
  one: InspirationCase | null;
  catalog: InspirationCatalogView;
  /**
   * A create seeded from a Session ("add this conversation to the library"). Ignored when `one` is
   * set — an edit always opens on the case's own values.
   */
  capture?: { title: string | null; prompt: string; agentId: string | null } | undefined;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const { currentProject, agents, currentAgent } = useProject();
  const [draft, setDraft] = useState<CaseDraft>(() => emptyCaseDraft(""));
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<OpenPicker>(null);
  const [skills, setSkills] = useState<PickableItem[] | null>(null);
  const [tools, setTools] = useState<string[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  /** Id for the glyph input, so the cover field's title can be associated with it by `htmlFor`. */
  const glyphInputId = useId();
  /** Id for the hidden file input the cover box wraps — the box is a label, so it names it itself. */
  const coverInputId = useId();

  // Reset on open rather than on mount: the dialog is mounted for the lifetime of the page, and a
  // draft left over from the previous edit would flash the wrong values into the next one.
  useEffect(() => {
    if (!open) return;
    const categoryId = catalog.categories[0]?.id ?? "webapps";
    setDraft(
      one !== null
        ? caseDraftOf(one)
        : capture !== undefined
          ? capturedCaseDraft(categoryId, capture)
          : emptyCaseDraft(categoryId),
    );
    setSaving(false);
    setPicker(null);
    setLoadingPreview(one !== null && one.previewFilename !== null);
  }, [open, one, capture, catalog.categories]);

  // The shipped skill catalog, read once per open (it is a small metadata list).
  useEffect(() => {
    if (!open || skills !== null) return;
    void fetchSkillCatalog()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, [open, skills]);

  // The stored preview document, so an untouched save writes it back rather than deleting it.
  useEffect(() => {
    if (!open || one === null || one.previewFilename === null) return;
    let cancelled = false;
    void import("./inspiration-service")
      .then(({ fetchInspirationPreview }) => fetchInspirationPreview(one.id))
      .then((html) => {
        if (cancelled || html === null) return;
        setDraft((current) => ({ ...current, previewHtml: html }));
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, one]);

  /**
   * The tools the case would have: the chosen Agent's, or the current Agent's when none is chosen.
   * Re-read whenever the choice changes, since the list is the Agent's own.
   */
  const toolAgentId = draft.agentId !== "" ? draft.agentId : (currentAgent?.agentId ?? "");
  useEffect(() => {
    if (!open || currentProject === null || toolAgentId === "") {
      setTools(null);
      return;
    }
    let cancelled = false;
    setTools(null);
    void fetchAgentToolNames(currentProject.projectId, toolAgentId)
      .then((names) => {
        if (!cancelled) setTools(names);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentProject, toolAgentId]);

  const error = caseDraftError(draft);
  const creating = one === null;
  const existingCover =
    one !== null && one.cover.kind === "image" && draft.coverFile === null ? coverUrl(one) : null;
  const previewBytes = useMemo(
    () => new TextEncoder().encode(draft.previewHtml).byteLength,
    [draft.previewHtml],
  );

  const save = () => {
    if (error !== null || saving) return;
    setSaving(true);
    void saveInspirationCase(creating ? null : one.id, caseSaveBody(draft))
      .then(() => {
        toastSuccess(creating ? S.inspiration.created : S.inspiration.saved);
        onClose();
      })
      .catch((err: unknown) => toastError(apiErrorText(err)))
      .finally(() => setSaving(false));
  };

  const pickCover = (file: File | undefined) => {
    if (file === undefined) return;
    if (!isCoverFilename(file.name)) {
      toastError(S.inspiration.coverExtensionError(COVER_EXTENSIONS.join(" / ")));
      return;
    }
    void fileToBase64(file)
      .then((dataBase64) => {
        setDraft((current) => ({
          ...current,
          coverKind: "image",
          coverFile: { filename: file.name, dataBase64, objectUrl: URL.createObjectURL(file) },
        }));
      })
      .catch((err: unknown) => toastError(apiErrorText(err)));
  };

  const skillsPicked =
    draft.skills.length === 0
      ? S.inspiration.pickerNone
      : S.inspiration.pickerPicked(draft.skills.length);
  const toolsPicked =
    draft.tools.length === 0
      ? S.inspiration.pickerNone
      : S.inspiration.pickerPicked(draft.tools.length);

  return (
    <Modal
      open={open}
      title={creating ? S.inspiration.createTitle : S.inspiration.editTitle}
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={error !== null || saving} onClick={save}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {one !== null && isShadowing(one) && (
          <p className="mb-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-400">
            {S.inspiration.shadowBuiltinHint}
          </p>
        )}
        <Input
          label={S.inspiration.fieldTitleZh}
          required={draft.title.trim() === ""}
          value={draft.titleZh}
          maxLength={TITLE_LIMIT}
          autoFocus
          onChange={(event) => {
            const titleZh = event.target.value;
            setDraft((current) => ({
              ...current,
              titleZh,
              // The id follows the title until the admin touches the id themselves; after that it
              // is theirs, because it is the directory name.
              id:
                creating && (current.id === "" || current.id === defaultCaseId(current.titleZh))
                  ? defaultCaseId(titleZh)
                  : current.id,
            }));
          }}
        />
        <Input
          label={S.inspiration.fieldTitleEn}
          required={draft.titleZh.trim() === ""}
          value={draft.title}
          maxLength={TITLE_LIMIT}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
        <Input
          label={S.inspiration.fieldId}
          hint={S.inspiration.fieldIdHint}
          value={draft.id}
          maxLength={64}
          disabled={!creating}
          onChange={(event) => setDraft({ ...draft, id: event.target.value })}
        />

        <Select
          label={S.inspiration.fieldKind}
          value={draft.kind}
          onChange={(event) => setDraft({ ...draft, kind: event.target.value as InspirationKind })}
        >
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel(kind)}
            </option>
          ))}
        </Select>

        <Select
          label={S.inspiration.fieldCategory}
          value={draft.categoryId}
          onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
        >
          {catalog.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {/* One language, the active one — the admin is filing a case, not comparing a
                  bilingual label. Coercion guarantees a name is present in at least one. */}
              {locale === "zh" && category.nameZh !== "" ? category.nameZh : category.name}
            </option>
          ))}
        </Select>

        {/* The Agent is a pick over the Project's Agents; what is stored is its id. */}
        <Select
          label={S.inspiration.fieldAgent}
          hint={S.inspiration.fieldAgentHint}
          value={draft.agentId}
          onChange={(event) => setDraft({ ...draft, agentId: event.target.value })}
        >
          <option value="">{S.inspiration.agentNone}</option>
          {agents.map((agent) => (
            <option key={agent.agentId} value={agent.agentId}>
              {agentDisplayName(agent)}
            </option>
          ))}
        </Select>

        <Textarea
          label={S.inspiration.fieldDescriptionZh}
          value={draft.descriptionZh}
          rows={2}
          maxLength={DESCRIPTION_LIMIT}
          onChange={(event) => setDraft({ ...draft, descriptionZh: event.target.value })}
        />
        <Textarea
          label={S.inspiration.fieldDescriptionEn}
          value={draft.description}
          rows={2}
          maxLength={DESCRIPTION_LIMIT}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
        <Textarea
          label={S.inspiration.fieldPromptZh}
          info={S.inspiration.fieldPromptInfo}
          infoLabel={S.inspiration.fieldPromptZh}
          value={draft.promptZh}
          rows={6}
          maxLength={PROMPT_LIMIT}
          onChange={(event) => setDraft({ ...draft, promptZh: event.target.value })}
        />
        <Textarea
          label={S.inspiration.fieldPromptEn}
          value={draft.prompt}
          rows={6}
          maxLength={PROMPT_LIMIT}
          onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
        />

        {/* Preselected skills: the shared multi-select panel over the shipped skill catalog — the
            same rows the composer's dropdown and the Agent create dialog offer. */}
        <div>
          <FieldLabel>{S.inspiration.fieldSkills}</FieldLabel>
          <FormPicker
            open={picker === "skills"}
            setOpen={(next) => setPicker(next ? "skills" : null)}
            label={skillsPicked}
            muted={draft.skills.length === 0}
            title={S.inspiration.fieldSkills}
            ariaLabel={S.inspiration.fieldSkills}
            menuClass="w-[26rem]"
          >
            <SkillPickList
              skills={skills ?? []}
              selected={draft.skills}
              onToggle={(name) =>
                setDraft((current) => ({
                  ...current,
                  skills: toggleSkillName(current.skills, name),
                }))
              }
              onSelectAll={(names) =>
                setDraft((current) => ({
                  ...current,
                  skills: addSkillNames(current.skills, names),
                }))
              }
              onSelectNone={(names) =>
                setDraft((current) => ({
                  ...current,
                  skills: removeSkillNames(current.skills, names),
                }))
              }
              emptyHint={skills === null ? S.common.loading : S.inspiration.skillsEmpty}
              searchPlaceholder={S.chat.skillsSearchPlaceholder}
            />
          </FormPicker>
          <FieldHint>{S.inspiration.fieldSkillsHint}</FieldHint>
        </div>

        {/* Expected tools: the chosen Agent's own tool list. */}
        <div>
          <FieldLabel>{S.inspiration.fieldTools}</FieldLabel>
          <FormPicker
            open={picker === "tools"}
            setOpen={(next) => setPicker(next ? "tools" : null)}
            label={toolsPicked}
            muted={draft.tools.length === 0}
            title={S.inspiration.fieldTools}
            ariaLabel={S.inspiration.fieldTools}
            menuClass="w-80"
          >
            <ToolPickList
              names={tools ?? []}
              selected={draft.tools}
              onToggle={(name) =>
                setDraft((current) => ({
                  ...current,
                  tools: toggleSkillName(current.tools, name),
                }))
              }
              emptyHint={
                tools === null
                  ? S.common.loading
                  : toolAgentId === ""
                    ? S.inspiration.toolsNoAgent
                    : S.inspiration.toolsEmpty
              }
            />
          </FormPicker>
          <FieldHint>{S.inspiration.fieldToolsHint}</FieldHint>
        </div>

        {/*
          Cover: one choice, two ways of drawing it. The box itself is the upload control — a
          `<label>` wrapping the file input, the shape every other upload in this app uses — and the
          glyph field beside it is the zero-asset alternative. The `info` layout (rather than a plain
          Field) is what keeps the file input reachable by name: a wrapping `<label>` binds to the
          FIRST labelable descendant, so the field's own wrapper would name the glyph input and leave
          the upload control nameless.
        */}
        <Field
          label={S.inspiration.fieldCover}
          hint={S.inspiration.fieldCoverHint}
          info={S.inspiration.fieldCoverInfo}
          infoLabel={S.inspiration.fieldCover}
          controlId={glyphInputId}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor={coverInputId}
              title={S.inspiration.coverUpload}
              className="group flex h-20 w-32 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-gray-300 bg-gray-50 transition-colors duration-150 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800/60 dark:hover:border-gray-500 dark:hover:bg-gray-800"
            >
              {draft.coverKind === "image" && draft.coverFile !== null ? (
                <img
                  src={draft.coverFile.objectUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : existingCover !== null ? (
                <img src={existingCover} alt="" className="h-full w-full object-cover" />
              ) : (
                <span aria-hidden className="text-3xl leading-none">
                  {draft.glyph === "" ? "✨" : draft.glyph}
                </span>
              )}
            </label>
            <HiddenFileInput
              id={coverInputId}
              accept="image/*"
              aria-label={S.inspiration.coverUpload}
              onChange={(event) => {
                pickCover(event.target.files?.[0]);
                // Cleared so picking the same file twice fires again.
                event.target.value = "";
              }}
            />
            <div className="flex flex-col gap-2">
              <Input
                id={glyphInputId}
                label={S.inspiration.fieldGlyph}
                className="w-28"
                value={draft.glyph}
                maxLength={8}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    glyph: event.target.value,
                    coverKind: "glyph",
                    coverFile: null,
                  })
                }
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {S.inspiration.coverUploadHint}
              </span>
              {draft.coverKind === "image" && (
                <button
                  type="button"
                  className="self-start text-xs text-gray-500 underline hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                  onClick={() =>
                    setDraft({ ...draft, coverKind: "glyph", coverFile: null, glyph: "✨" })
                  }
                >
                  {S.inspiration.coverUseGlyph}
                </button>
              )}
            </div>
          </div>
        </Field>

        <Textarea
          label={S.inspiration.fieldPreview}
          info={S.inspiration.fieldPreviewInfo}
          infoLabel={S.inspiration.fieldPreview}
          hint={
            loadingPreview
              ? S.common.loading
              : S.inspiration.previewHint(previewBytes, PREVIEW_LIMIT)
          }
          error={error === "previewTooLarge" ? S.inspiration.previewTooLarge : undefined}
          value={draft.previewHtml}
          rows={4}
          placeholder={draft.hasPreview ? S.inspiration.previewKeepHint : undefined}
          onChange={(event) => setDraft({ ...draft, previewHtml: event.target.value })}
        />

        <Input
          label={S.inspiration.fieldOrder}
          hint={S.inspiration.fieldOrderHint}
          value={draft.order}
          onChange={(event) => setDraft({ ...draft, order: event.target.value })}
        />

        <div className="flex flex-wrap items-center gap-6 pt-1">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <Switch
              checked={draft.featured}
              onChange={(featured) => setDraft({ ...draft, featured })}
            />
            {S.inspiration.fieldFeatured}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <Switch
              checked={draft.enabled}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
            />
            {S.inspiration.fieldEnabled}
          </label>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The expected-tools panel: the same row shape `SkillPickList` draws, over plain names.
 *
 * A separate component rather than a reuse of the skill panel because the rows are different things
 * — a tool has no description or icon to show, and pretending it does would mean inventing one. The
 * toggle semantics, the scroll cap and the search box are kept identical, which is what makes the two
 * pickers read as one control.
 */
function ToolPickList({
  names,
  selected,
  onToggle,
  emptyHint,
}: {
  names: string[];
  selected: string[];
  onToggle: (name: string) => void;
  emptyHint: string;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle === "" ? names : names.filter((n) => n.toLowerCase().includes(needle));
  return (
    <>
      <div className="border-b border-gray-100 px-2 pb-1.5 pt-0.5 dark:border-gray-800">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={S.inspiration.toolsSearchPlaceholder}
          aria-label={S.inspiration.toolsSearchPlaceholder}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none dark:text-gray-200 dark:placeholder:text-gray-500"
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {names.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-gray-400">{emptyHint}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.inspiration.toolsNoMatch}</p>
        ) : (
          filtered.map((name) => {
            const on = selected.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(name)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  on
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-600 dark:text-gray-400"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
                <span className="w-3 shrink-0 text-center">{on ? "✓" : ""}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

/** Re-exported for the tests that pin the request body against the server's caps. */
export { DESCRIPTION_LIMIT as PACKAGE_DESCRIPTION_LIMIT, TITLE_LIMIT as PACKAGE_TITLE_LIMIT };
export type { InspirationCaseInput };
