/**
 * System settings, as a route (`/settings`) rather than a modal.
 *
 * ## Why it left the dialog
 *
 * It used to open as a `PagedDialog` popup over whatever you were doing. That cost the
 * feature its own place in the window: settings are somewhere you *live* while you change
 * them — you compare a row against the page you came from, you keep one setting open
 * while you go read something else, and you expect the browser's back button and a
 * bookmarkable URL to behave. A modal gives none of that: it traps you, hides the rest of
 * the app behind a scrim, and its state is a boolean in the sidebar rather than anywhere
 * the router can see. So it became a route, and the active page rides in `?section=` so
 * the rail is linkable and the back button walks it.
 *
 * ## Why this file draws only a pane
 *
 * The first cut put the category rail here, beside the form — which put TWO menus on one
 * screen: the app's own sidebar (page nav, session list) on the left, and a second list of
 * near-identical rows in the content area. They compete, and the second one reads as a
 * stranger inside a page.
 *
 * The categories are the app's own navigation, so they belong in the app's own navigation.
 * `components/layout/sidebar.tsx` takes the column over while this route is open — brand
 * row, "← 返回工作区", then the grouped categories — and the normal column (new chat, page
 * nav, session list) steps aside. That is the whole idea of the change: you did not fall
 * into a sub-page, you walked somewhere else and the sidebar says where.
 *
 * So the split is: THIS file resolves and gates the page and renders its content; the
 * sidebar renders the menu. Both read `visibleSettingsSections`, so the menu can never
 * offer a page the pane would refuse.
 */
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { S } from "../../lib/strings";
import {
  resolveSettingsSection,
  visibleSettingsSections,
} from "../../lib/settings-sections";
import type { SettingsSectionKey } from "../../lib/settings-sections";
import { settingsSectionInfo, settingsSectionLabel } from "../../lib/settings-labels";
import { useAuth } from "../../state/auth";
import { useUpdateBadges } from "../../lib/use-update-badges";
import { useDocumentTitle } from "../../lib/use-document-title";
import { InfoPopover } from "../../components/ui/info-popover";
import { GeneralSection } from "./general-section";
import { ProjectSections } from "./project-sections";
import { AppearanceSection } from "./appearance-section";
import { ApplicationSection } from "./application-section";
import { AccountSection } from "./account-section";
import { ProxySection } from "./proxy-section";
import { UploadsSection } from "./uploads-section";
import { LogsSection } from "./logs-section";
import { AdminUsersSection } from "../admin/admin-users-page";
import { ModelsPane } from "../models/models-page";

export function SettingsPage() {
  useDocumentTitle(S.settings.systemSettings);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, desktopMode, sessionVia, uploadLimits } = useAuth();
  const sections = visibleSettingsSections({
    isAdmin: user?.isAdmin === true,
    desktopMode,
    sessionVia,
  });
  // The anomaly trail's raised todo, read here rather than inside the section because the
  // menu in the sidebar needs it whether or not the 日志 page is the one open. `todos.errors`
  // is the same value the page's own notice uses, dismissal included — so the dot on the menu
  // row and the notice in the page can never disagree.
  useUpdateBadges();

  // The requested page lives in the URL (`?section=`), so the browser's back button walks the
  // menu and the address bar names the page you are on. An unknown or forbidden request
  // resolves to the first visible page, and the correction is written back so a reload of a
  // hand-edited URL does not keep showing the same redirect — the same guarantee the modal's
  // local state gave, now visible and shareable.
  const requested = params.get("section");
  const current = resolveSettingsSection(requested, sections);
  useEffect(() => {
    if (current !== null && requested !== current) {
      const next = new URLSearchParams(params);
      next.set("section", current);
      setParams(next, { replace: true });
    }
  }, [current, requested, params, setParams]);

  // Nothing at all to show: no page is visible to this viewer (the rules leave at least the
  // General page, so this is unreachable in practice) — send them back rather than paint an
  // empty shell with no way out. The exit itself is the sidebar's 返回工作区 row; this only
  // covers the case where there is nothing to draw at all.
  useEffect(() => {
    if (current === null) navigate("/chat", { replace: true });
  }, [current, navigate]);

  // Read inside the component: after a language switch these pick up the current dictionary.
  // Both come from lib/settings-labels.ts, which the sidebar's menu reads too — one home for
  // a category's name and its "?", so a label cannot drift between the row and the title.
  const activeLabel = current === null ? S.settings.systemSettings : settingsSectionLabel(current);
  const activeInfo = current === null ? undefined : settingsSectionInfo(current, uploadLimits);

  return (
    // The pane and nothing else. The category menu lives in the app's own sidebar while this
    // route is open (components/layout/sidebar.tsx takes the column over for it) — so this
    // file draws only the selected category's form, which is what stopped it from being a
    // second menu competing with the one you just left.
    // `mx-auto max-w-5xl`, the width the models/plugins/plaza pages use, so a settings row
    // lines up with the tables around it: a pane that filled the whole window would stretch a
    // label-and-control row to 2000px on a wide monitor and read as a different app.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        {/* Just the title: the way out is the sidebar's own "返回工作区" row, not a second one
            here. The title carries its own "?" — the disclosure-anchoring rule puts the mark
            BESIDE the title it modifies, never as a separate control in a row of its own.
            The label is a DIRECT child rather than wrapped for truncation, which the same
            check reads as a title. */}
        <h1 className="mb-4 flex min-w-0 items-center gap-1.5 text-xl font-semibold">
          {activeLabel}
          {activeInfo !== undefined && (
            <InfoPopover label={activeLabel}>{activeInfo}</InfoPopover>
          )}
        </h1>

        <section className="min-w-0">
            {current === "projectManage" && <ProjectSections page="manage" />}
            {current === "projectMembers" && <ProjectSections page="members" />}
            {current === "projectDefaults" && <ProjectSections page="defaults" />}
            {current === "projectSecurity" && <ProjectSections page="security" />}
            {current === "general" && <GeneralSection />}
            {current === "appearance" && <AppearanceSection />}
            {current === "application" && <ApplicationSection />}
            {current === "models" && <ModelsPane />}
            {current === "logs" && <LogsSection />}
            {current === "account" && <AccountSection />}
            {current === "proxy" && <ProxySection />}
            {current === "uploads" && <UploadsSection />}
            {current === "users" && <AdminUsersSection />}
          </section>
      </div>
    </div>
  );
}