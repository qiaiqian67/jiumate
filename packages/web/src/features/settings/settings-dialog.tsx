/**
 * System settings dialog: one popup holding the settings that used to sit as separate rows
 * in the sidebar user menu, on the PagedDialog shell (left rail of pages, ChatGPT-style
 * rows on the right). The rail is grouped — Personal for the viewer's own preferences,
 * Server for the server-global settings an admin writes — and both the rail and the pane
 * go through visibleSettingsSections, so a viewer neither sees a page they may not open
 * nor lands on one: the active page is re-resolved against that list on every render, and
 * anything not on it falls back to the first page they can actually open.
 */
import { useEffect, useState } from "react";
import { S } from "../../lib/strings";
import {
  resolveSettingsSection,
  settingsGroups,
  visibleSettingsSections,
} from "../../lib/settings-sections";
import type { SettingsGroupKey, SettingsSectionKey } from "../../lib/settings-sections";
import { useAuth } from "../../state/auth";
import { PagedDialog } from "../../components/ui/paged-dialog";
import type { PagedDialogGroup } from "../../components/ui/paged-dialog";
import { Icon } from "../../components/ui/group-list";
import { GEAR_ICON, NAV_ICONS } from "../../components/ui/icons";
import { GeneralSection } from "./general-section";
import { AppearanceSection } from "./appearance-section";
import { ApplicationSection } from "./application-section";
import { AccountSection } from "./account-section";
import { ProxySection } from "./proxy-section";
import { UploadsSection } from "./uploads-section";
import { LogsSection } from "./logs-section";
import { AdminUsersSection } from "../admin/admin-users-page";
import { ModelsPane } from "../models/models-page";
import { useUpdateBadges } from "../../lib/use-update-badges";

/** Rail glyphs, on the shared 24x24 stroke grid (see NAV_ICONS' conventions). */
const SECTION_ICONS: Record<SettingsSectionKey, string> = {
  general: GEAR_ICON,
  /** Sun: appearance. */
  appearance:
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4",
  /** Stacked layers: the model library, same glyph the nav entry used. */
  models: NAV_ICONS.models,
  /** Single person: the signed-in account. */
  account: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  /** Window with a heart: application-level preferences (Petdex desktop pet). */
  application: "M3 5h18v12H3zM3 17l4-4 4 4 4-4 4 4M9 9h.01M15 9h.01M9 13s1 1 3 1 3-1 3-1",
  /** Globe: outbound traffic. */
  proxy:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 0 0 18M12 3a15 15 0 0 1 0 18",
  /** Up arrow over a base: uploads. */
  uploads: "M12 15V4m0 0L7 9m5-5l5 5M4 20h16",
  /** Two people: user management. */
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  /** Text lines: the error log. */
  logs: "M4 6h16M4 11h16M4 16h10",
};

export function SettingsDialog({
  open,
  onClose,
  initialSection = null,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Page to open on. Null keeps the default (the viewer's first page). Used by
   * the desktop pet's context menu, which lands straight on Application.
   */
  initialSection?: SettingsSectionKey | null;
}) {
  // uploadLimits feeds the Upload limits page's "?" (sectionInfo below); the rest pick pages.
  const { user, desktopMode, sessionVia, uploadLimits } = useAuth();
  const sections = visibleSettingsSections({
    isAdmin: user?.isAdmin === true,
    desktopMode,
    sessionVia,
  });
  const [active, setActive] = useState<SettingsSectionKey | null>(null);
  // The anomaly trail's raised todo, read here rather than inside the section because the rail
  // needs it whether or not the 日志 page is the one open. `todos.errors` is the same value the
  // page's own notice uses, dismissal included — so the dot and the notice can never disagree.
  const logsTodo = useUpdateBadges().todos.errors;
  const logsNote = logsTodo === undefined ? null : S.todo.unexpectedErrors(logsTodo.count);

  // Each opening starts on the viewer's first page: clearing the choice lets `current`
  // below resolve it against the live list. Deliberately keyed on `open` alone — re-running
  // on every sections identity change would yank the user off a page they navigated to.
  useEffect(() => {
    if (open) setActive(initialSection);
  }, [open, initialSection]);

  const current = resolveSettingsSection(active, sections);
  if (current === null) return null;

  // Read inside the component: after a language switch remount, these pick up the current dictionary.
  const sectionLabel: Record<SettingsSectionKey, string> = {
    general: S.settings.generalTitle,
    appearance: S.settings.appearanceTitle,
    application: S.settings.applicationTitle,
    models: S.settings.modelsTitle,
    logs: S.logs.title,
    account: S.settings.accountTitle,
    proxy: S.settings.proxyTitle,
    uploads: S.settings.uploadLimitsTitle,
    users: S.admin.users,
  };
  const groupLabel: Record<SettingsGroupKey, string> = {
    personal: S.settings.groupPersonal,
    server: S.settings.groupServer,
  };
  // Page-level explanations, disclosed by the "?" the shell draws beside the pane heading.
  // Pages whose rows explain themselves one by one carry none.
  const sectionInfo: Partial<Record<SettingsSectionKey, string>> = {
    proxy: S.settings.proxyInfo,
    uploads: S.settings.uploadLimitsInfo(uploadLimits.attachmentMaxCount, uploadLimits.imageMaxMb),
  };

  const groups: Array<PagedDialogGroup<SettingsSectionKey>> = settingsGroups(sections).map(
    (group) => ({
      key: group,
      label: groupLabel[group],
      items: sections
        .filter((s) => s.group === group)
        .map((s) => ({
          key: s.key,
          label: sectionLabel[s.key],
          icon: <Icon d={SECTION_ICONS[s.key]} size={16} />,
          ...(sectionInfo[s.key] !== undefined ? { info: sectionInfo[s.key] } : {}),
          // The 日志 page wears the anomaly trail's dot, and its note is the same sentence the
          // rail entry's tooltip carries on the trail it came from (see use-update-badges.ts):
          // the dot means "unexpected errors are waiting", and the row is the only place left
          // that says so once the cost center's badge is gone.
          ...(s.key === "logs" && logsNote !== null ? { note: logsNote, dot: true } : {}),
        })),
    }),
  );

  return (
    <PagedDialog
      open={open}
      onClose={onClose}
      title={S.settings.systemSettings}
      groups={groups}
      active={current}
      onSelect={setActive}
      // The Models pane is the whole model library, hosted here rather than at its own route, and
      // its group headers key their layout off their own `@container` width: at the default
      // 3xl the content column is ~544px, under the 576px `@xl` its vendor names and the
      // 官方推荐 pill hide behind — the headers rendered as bare chevrons. 5xl gives the column
      // ~800px, so the pane shows what the page showed. Every other page keeps the default.
      widthClass={current === "models" ? "sm:max-w-5xl" : undefined}
    >
      {current === "general" && <GeneralSection />}
      {current === "appearance" && <AppearanceSection />}
      {current === "application" && <ApplicationSection />}
      {current === "models" && <ModelsPane />}
      {current === "logs" && <LogsSection />}
      {current === "account" && <AccountSection />}
      {current === "proxy" && <ProxySection />}
      {current === "uploads" && <UploadsSection />}
      {current === "users" && <AdminUsersSection />}
    </PagedDialog>
  );
}
