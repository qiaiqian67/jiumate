/**
 * The "add a skill by source" dialog, shared by the two places a skill can enter a Project.
 *
 * Both surfaces install by the same mechanism: the source (a URL, a git repo, a local path, or
 * an `npx skills add <name>` line — see skill-import-source.ts for how the lead sentence is
 * tailored) is compiled into a prompt, and the Agent runs that prompt to do the installing.
 * The prompt is DERIVED from the source rather than held here, so the source itself stays with
 * the caller and there is only ever one copy of it.
 *
 * Two things are deliberately the caller's:
 *
 * `onOpenChat` — opening the chat means picking an Agent, and that is a different answer on
 * each surface (the settings tab means the Agent whose tab it is; the library means the one
 * selected up top). It also carries real side effects — parking whatever the reader had typed
 * so the install prompt cannot clobber it — so it cannot be inferred from here.
 *
 * `extra` — the archive upload. That one writes to an Agent's own directory
 * (`agentSkillArchiveUrl(projectId, agentId, …)`), so it only means anything on a surface that
 * knows which Agent it is for. Rendering it as a slot keeps one dialog on both surfaces without
 * putting a control on the library page that could only install to the wrong place.
 */
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { CopiedStatus, CopyCheckGlyph, useCopied } from "../../components/ui/copy-button";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { S } from "../../lib/strings";
import { buildImportPrompt } from "../agents/skill-import-source";

export function SkillImportDialog({
  open,
  onClose,
  source,
  onSourceChange,
  onOpenChat,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  /** The source text, owned by the caller (the prompt below is derived from it). */
  source: string;
  onSourceChange: (value: string) => void;
  /** Opens a chat that will run the install prompt — the caller picks the Agent it lands on. */
  onOpenChat: () => void;
  /** A caller-only section (the archive upload), rendered under the shared part. */
  extra?: ReactNode;
}) {
  // The prompt tailors its lead sentence to the source kind; the preview substitutes a
  // placeholder token until something is entered.
  const trimmedSource = source.trim();
  const chatPrompt = buildImportPrompt(trimmedSource || S.skills.importSourceToken);

  // Copy feedback lives at the button (the shared copy convention): its glyph flips to the
  // check while copied — no toast, and the button label never changes.
  const promptCopy = useCopied();

  return (
    <Modal open={open} title={S.skills.importSkill} onClose={onClose} widthClass="sm:max-w-lg">
      <div className="space-y-4">
        <section>
          <p className="text-sm font-medium">{S.skills.importChatTitle}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {S.skills.importChatWhy}
          </p>
          <div className="mt-2.5 space-y-2.5">
            <Input
              size="sm"
              label={S.skills.importSourceLabel}
              hint={S.skills.importSourceHint}
              value={source}
              onChange={(e) => onSourceChange(e.target.value)}
              placeholder={S.skills.importSourcePlaceholder}
              autoComplete="off"
            />
            <Textarea
              label={S.skills.importPromptLabel}
              size="sm"
              rows={5}
              readOnly
              value={chatPrompt}
              className="text-gray-600 dark:text-gray-300"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={trimmedSource === ""}
                onClick={() => promptCopy.flash(chatPrompt)}
              >
                <CopyCheckGlyph copied={promptCopy.copied} size={12} />
                {S.skills.importCopyPrompt}
              </Button>
              <CopiedStatus copied={promptCopy.copied} />
              <Button size="sm" variant="primary" onClick={onOpenChat}>
                {S.skills.importOpenChat}
              </Button>
            </div>
          </div>
        </section>

        {extra}
      </div>
    </Modal>
  );
}
