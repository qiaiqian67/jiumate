/**
 * English dictionary (constrained by the `Strings` type to the same shape as zh):
 * locale switching goes through state/locale.tsx.
 * Keep domain terms capitalized — Workspace, Token, Task, Session, Project, Trace.
 * "agent" is a common noun: lowercase mid-sentence, capitalized only at the start
 * of a label/sentence or in a proper name (Agent State, AgentHub).
 */
import type { Strings } from "./strings";

export const en: Strings = {
  appName: "JiuMate",

  nav: {
    chat: "Chat",
    newChat: "New session",
    appCenter: "Plaza",
    agents: "Agents",
    plugins: "Plugins & Skills",
    models: "Models",
    machines: "Machines",
    usage: "Tokens",
    traces: "Trajectories",
    benchmark: "Evaluation Center",
    // Collapsed-rail tooltip (product-specified wording; 新会话 reuses chat.newSessionMenu, the other pages reuse the page names above).
    lastConversation: "Last conversation",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    collapseGroup: "Collapse",
    expandGroup: "Expand",
    pinGroup: "Pin group",
    unpinGroup: "Unpin group",
  },

  /** Machines page: the server's own ssh hosts, and installing this build on one. */
  machines: {
    pageTitle: "Machines",
    pageDesc:
      "The hosts declared in this server's own ~/.ssh/config. Pick one to install this build of JiuMate on it: the machine is probed, a matching Node runtime rides along only if it needs one, and the image is copied over and installed there. The config is read, never written, and the install uses the server account's own ssh keys.",
    /** Version line under the title; `version` is what would be pushed. */
    imageVersion: (version: string) => `Installs version ${version}`,
    noImage:
      "This server has no install image to push. A packaged or tarball install carries one; a source checkout gets one from its first hot push.",
    empty: "No hosts in ~/.ssh/config.",
    /** The picker: an ssh config can declare hundreds of hosts, so the panel is a fuzzy search over aliases. */
    pick: "Choose a machine\u2026",
    search: "Search hosts\u2026",
    noMatch: "No host matches that.",
    /** How many matches the visible rows leave out — a silent truncation would read as "not in my config". */
    more: (count: number) => `${count} more \u2014 keep typing to narrow it down.`,
    /** Heading of the standing list of machines this server has installed on. */
    installedTitle: (count: number) => `Installed machines (${count})`,
    /** What the selected machine already carries, remembered on the server across restarts. */
    installedAt: (version: string, when: string) => `${version} installed here on ${when}.`,
    install: "Install",
    installing: "Installing\u2026",
    reinstall: "Reinstall",
    /** Terminal states of a finished job. */
    installed: (version: string) => `Installed ${version}.`,
    alreadyInstalled: (version: string) => `Already on ${version} \u2014 nothing to install.`,
    failedAt: (step: string) => `The install failed while trying to ${step}.`,
    /** The progress log's own heading, so the block is not an unlabelled wall of text. */
    output: "Install output",
    adminOnly: "Only an admin can install on a machine.",
  },

  /** Server-side terminal (the in-app dock and the standalone /terminal page). */
  terminal: {
    title: "Terminal",
    newShell: "New shell",
    /** Tab strip ×: kills the shell itself (server-side), unlike closing the dock. */
    killShell: "Kill this terminal",
    /** Boundary drag handle between the dock and the main content (double-click resets). */
    /** Hover menu when the user has no live terminal yet. */
    /** Pane body when creating/attaching a shell failed (the server message follows). */
    createFailed: "Could not start a terminal",
    /** A create that 404s: the server predates the terminal API (or the shell attached to an older one). */
    noTerminalApi:
      "this server has no terminal API: the running runtime predates it. A hot push replaces the platform and Web App, but the terminal endpoints are runtime-owned — the runtime itself has to be updated (restarting will not help)",
    /** Codex-style handoff: opens /terminal?id=… in a new window, the dock lets go. */
    detach: "Open in new window",
    status: {
      connecting: "connecting",
      ready: "ready",
      exited: "exited",
      error: "error",
    },
    /** Suffix shown after `status.exited`; `code` is the shell's numeric exit code. */
    exitedWithCode: (code: string): string => `exit code ${code}`,
  },

  /** The agent browser's dock panel: the pages the agent drives, and the ones the user opened. */
  browser: {
    title: "Browser",
    /** The panel's empty state: no page is open. */
    empty: "No page open",
    emptyHint: "Ask the agent to open a page, or type an address above",
    /** The address bar's placeholder. */
    addressPlaceholder: "Type an address",
    /** The address bar's go button. */
    go: "Go",
    /** The strip's +: a new blank page. */
    newTab: "New tab",
    /** A tab that has no title yet shows this. */
    untitled: "New tab",
    /** The panel's body when the host has no browser at all. */
    unavailable: "This device has no browser",
    unavailableHint: "The built-in browser is part of the desktop app.",
    /** A tab whose renderer died; the page is reloaded when the user asks for it. */
    crashed: "The page crashed",
    /** The strip ×: closes the tab. */
    closeTab: "Close tab",
    /** The back/forward buttons, and the reload one. */
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    /** The overflow menu's button. */
    more: "More",
    /** The overflow menu's import entry. */
    import: "Import from a system browser",
    /** The import dialog's title. */
    importTitle: "Import from a system browser",
    importHint:
      "Bring a system browser's sign-ins over, so the agent can open the pages you are signed in to.",
    /** What to import. */
    importCookies: "Sign-ins (cookies)",
    importHistory: "Browsing history",
    /** The "only these sites" field. */
    importDomains: "Only these sites (empty means all)",
    importDomainsPlaceholder: "e.g. github.com, mail.google.com",
    /** What the import brought. */
    importDone: "Imported {cookies} sign-ins and {history} history entries",
    importSkipped: "Skipped {count}",
    importNone: "No system browser to import from was found",
    importFailed: "The import failed",
    /** The clear-data entry. */
    clearData: "Clear browsing data",
    clearDataHint:
      "Clear this browser's sign-ins and caches. The sign-ins an import brought go too.",
    /** The headless browser's notice: its pages are not on the screen. */
    headlessNotice:
      "The headless browser's pages are not on your screen. Here is what the agent is working on.",
  },

  dock: {
    addTab: "Add panel",
    closeTab: "Close panel",
    hideDock: "Hide sidebar",
    moveToRight: "Move to the right",
    moveToBottom: "Move to the bottom",
    resize: "Resize panel",
    rightDock: "Right sidebar",
    bottomDock: "Bottom panel",
    draftEmpty: "Available once the conversation starts",
    killConfirmTitle: "Close this terminal?",
    killConfirmBody: (name: string): string =>
      `This ends the shell "${name}" — it cannot be restored.`,
  },

  tracePanel: {
    empty: "No traces yet",
    emptyHint: "This session has not produced a Trace file yet",
    loadFailed: "Failed to load traces",
  },

  /** Floating pet window: the speech bubble hanging off the pet, and its menus. */
  pet: {
    statusThinking: "Thinking",
    statusWriting: "Writing",
    statusUsingTools: "Using tools",
    statusCompacting: "Compacting context",
    statusWaitingApproval: "Waiting for approval",
    statusWorking: "Working",
    statusCompleted: "Completed",
    statusFailed: "Failed",
    statusInterrupted: "Interrupted",
    menuSwitchPet: "Switch pet",
    menuClosePet: "Hide pet",
    menuCloseBubble: "Dismiss",
    composerOpen: "Reply",
    composerPlaceholder: "Reply to this session…",
    composerSend: "Send",
    composerCancel: "Cancel",
  },

  settings: {
    language: "Language",
    languageInfo: "Interface language; can follow the browser.",
    /** Application page of the settings dialog (Petdex desktop pet, …). */
    applicationTitle: "Application",
    applicationInfo:
      "Application-level preferences such as the desktop pet. Switching them does not affect the JiuMate workflow.",
    applicationEnablePet: "Show desktop pet",
    applicationEnablePetInfo: "Opens the floating pet window in the desktop app.",
    applicationPetPicker: "Pet appearance",
    applicationPetSizeLabel: "Pet size",
    applicationPetSizeInfo: "Scale the floating desktop pet window.",
    applicationPetSizeSmall: "Small",
    applicationPetSizeMedium: "Medium",
    applicationPetSizeLarge: "Large",
    applicationPetDelete: "Delete",
    applicationPetImport: "Import",
    applicationPetImporting: "Importing…",
    applicationPetRefresh: "Refresh list",
    applicationPetRefreshing: "Refreshing…",
    applicationPetListFailed: "Could not read the pet list.",
    applicationPetExternalTitle: "Import from Codex",
    applicationPetExternalInfo:
      "Read the pets bundled with the Codex desktop app on this machine and import the ones you pick.",
    applicationPetExternalScan: "Rescan",
    applicationPetExternalScanning: "Scanning…",
    applicationPetExternalEmpty: "No bundled pets were found in a Codex install on this machine.",
    applicationPetExternalImport: "Import",
    applicationPetExternalImported: "Imported",
    applicationPetExternalBuiltin: "Built in",
    applicationPetExternalCopyModified: "Copy edited",
    applicationPetExternalSourceChanged: "Source updated",
    applicationPetExternalFailed: "Could not import this pet.",
    applicationPetImportHint:
      "Pick a local Petdex folder that contains pet.json and a spritesheet.",
    applicationPetImportDesktopOnly: "Importing a Petdex package requires the desktop app.",
    applicationPetImportFailed: "Could not import the pet.",
    applicationPetImported: (name: string) => `Imported “${name}”`,
    applicationPetDeleted: "Pet deleted.",
    /** Sidebar user-menu row opening the System settings page. */
    systemSettings: "System settings",
    /** The full-page settings' own exit row: the modal's close button had no equivalent. */
    backToWorkspace: "Back to workspace",
    /** Rail headings: the viewer's own preferences vs. the whole server's. */
    groupPersonal: "Personal",
    groupServer: "Server",
    /** Personal pages of the settings dialog. */
    generalTitle: "General",
    appearanceTitle: "Appearance",
    accountTitle: "Account",
    /** Trace import: the two pickers' accessible names, the pick-a-file action, and its outcomes. */
    importTrace: "Import Trace",
    importTraceInfo:
      "Upload a .jsonl Trace exported from another install and it becomes a conversation of the chosen Agent. Both halves of the destination are picked here: the endpoint is per-Agent — a Trace file's own session_meta cannot name a local Agent, since its agent_state path belongs to the machine that exported it — and the Project is asked for because this dialog does not show which one is open, which also means a Trace can go to a Project other than the open one. Exporting happens in a conversation's Trace panel.",
    importTraceProject: "Import into project",
    importTraceAgent: "Import into agent",
    importTracePick: "Choose file",
    importTraceRunning: "Importing…",
    importTraceDone: (target: string) => `Trace imported into ${target}`,
    importTraceTooLarge: "The file exceeds the 14MB limit.",
    /**
     * The Models page, hosted as a settings pane rather than a nav entry: the whole model
     * library (providers, keys, pricing, grouping) is per-user configuration, so it belongs
     * beside the rest of it. The pane is the same component the old /models route renders.
     */
    modelsTitle: "Models",
    /** Admin-only sub-page (server-global); its explanation is disclosed at the pane heading. */
    proxyTitle: "Proxy options",
    proxyInfo:
      "Server-global, and in force the moment it is saved — nothing to restart. Loopback addresses always go direct.",
    /** The two switches: the server's own outbound traffic / agent command subprocess environments. */
    proxyForApp: "Application uses the proxy",
    proxyForAgent: "Agent environment uses the proxy",
    /** The shared explicit proxy address (empty = follow the proxy environment variables). */
    proxyAddress: "Proxy address",
    proxyAddressPlaceholder: "Empty = follow system proxy",
    /** Admin-only sub-page (server-global). */
    uploadLimitsTitle: "Upload limits",
    /** Its two number fields, both in whole MB. */
    attachmentMaxMb: "Max attachment size (MB)",
    attachmentTotalMb: "Max total per message (MB)",
    /** Accepted range for each field: read while typing, so it stays under the field. */
    attachmentMaxMbHint: (min: number, max: number): string => `${min}–${max} MB`,
    attachmentTotalMbHint: (min: number, max: number): string =>
      `${min}–${max} MB, and not below the per-file limit`,
    /** What these two numbers do NOT govern — disclosed at the pane heading. */
    uploadLimitsInfo: (count: number, imageMb: number): string =>
      `A message may carry at most ${count} attachments. Images placed inline in the ` +
      `conversation keep a separate ${imageMb}MB limit that this setting does not raise — an ` +
      `inline image enters the conversation and the Trace, where its size is paid again on ` +
      `every history page and resume.`,
    mode: "Appearance",
    modeInfo: "Light or dark look of the app.",
    themeLight: "Light",
    themeDark: "Dark",
    followSystem: "System",
    terminalTheme: "Terminal theme",
    terminalThemeInfo: "Colors of the terminal panel; follows the app theme by default.",
    followAppTheme: "App",
    langZh: "中文",
    langEn: "English",
    fontSize: "Font size",
    fontSizeInfo: "Overall interface font size.",
    fontSmall: "S",
    fontMedium: "M",
    fontLarge: "L",
    accent: "Accent",
    accentInfo: "Interface accent color.",
    themeTitle: "Theme",
    themeInfo:
      "A theme is a palette and a picture. The palette is the ten roles its author declared, and the whole gray scale the interface uses is derived from it — so switching themes recolors everything. A theme states which shell it holds up under: a single-shell one pins the appearance above, while one marked “follows the light/dark setting” works in both.",
    themePinsMode: (mode: string): string => `Pins ${mode}`,
    themeFollowsMode: "Follows the light/dark setting",
    themeNoneNote: "No theme",
    themeMissing: "Not on this machine",
    themeNone: "The app's own look",
    themeOwnsAccent: (name: string): string => `Set by the ${name} theme`,
    themePackagesTitle: "Import a theme",
    themePackagesInfo:
      "Import from a folder on this machine. Put a Codex-Dream-Skin theme.json in it with a background image beside it — that is this app's native format, so nothing is converted. What you import joins the gallery above, and removing it is on its card there.",
    themeImportPlaceholder: "Full path to the theme folder",
    themeImportPick: "Choose folder…",
    themeImportArchive: "Upload .zip",
    themeImportAction: "Import",
    themeImporting: "Importing…",
    themeImported: (name: string): string => `Imported the ${name} theme`,
    themeImportWarnings: "Import notes:",
    themeImportFailed: "Could not import the theme",
    themeDelete: "Delete",
    themeDeleted: "Theme deleted",
    themeDeleteFailed: "Could not delete the theme",
    themeRefresh: "Refresh",
    themeRefreshing: "Refreshing…",
    themeSurfaceAlpha: "Surface transparency",
    themeSurfaceAlphaInfo:
      "How see-through the surfaces the theme declares are. More transparent shows more of the artwork; at 100% the panels are fully opaque and the artwork only appears around them.",
    themeSurfaceAlphaInactive:
      "The active theme declares no surfaces, so this does not apply to it.",
    themeBackgroundDimInactive: "The active theme has no artwork, so this does not apply to it.",
    themeBackgroundDim: "Artwork dimming",
    themeBackgroundDimInfo:
      "A scrim over the artwork, so a busy image does not compete with the text in the gaps between panels. 0 leaves it undimmed.",
    currencyInfo: "Display currency for prices; storage is always USD.",
    /**
     * Chat prose font size. Deliberately a SEPARATE setting from Appearance's 字号
     * (fontSize / fontSmall…): that one scales the whole interface via the html root font
     * size, this one scales only the Markdown in the message stream. The `chat` prefix keeps
     * the two apart; they coexist without either affecting the other.
     */
    chatFontSize: "Chat text size",
    chatFontSizeInfo:
      "Font size of conversation text. The interface and code blocks are unaffected.",
    chatFontSmall: "Small",
    chatFontMedium: "Medium",
    chatFontLarge: "Large",
    /** Which browser the agent drives. */
    browserBackend: "Agent browser",
    browserBackendInfo:
      "Which browser the agent works in. The built-in one is the browser you can see; the headless one is the server's own, which you cannot see but which needs no desktop app.",
    browserBuiltin: "Built-in",
    browserBuiltinHint:
      "The desktop app's browser. You see every page the agent opens, and you can take over.",
    browserHeadless: "Headless",
    browserHeadlessHint:
      "A browser the server starts for itself. It takes none of your screen, and it works without the desktop app.",
    browserChrome: "My Chrome",
    browserChromeHint: "Takes over your own Chrome through an extension. Not implemented yet.",
    changePasswordInfo: "Change this account's sign-in password.",
    accentNames: {
      neutral: "Neutral",
      blue: "Blue",
      green: "Green",
      violet: "Violet",
      rose: "Rose",
      amber: "Amber",
    } as Record<string, string>,
  },

  /**
   * The software-update flow (lib/update-flow.ts): the one modal for both the server release
   * and the desktop client, the account-menu row, the version-line badge, and the toasts for
   * outcomes that land while the modal is closed. Null version = the backend named none.
   */
  update: {
    /** Version-line date label; `date` is formatMonthDay output, e.g. "Last updated Jul 26". */
    lastUpdated: (date: string) => `Last updated ${date}`,
    /** The version line's superscript, a button into the modal; the other two follow the flow. */
    newVersionBadge: "New version available",
    badgeDownloading: "Downloading update",
    badgeReady: "Restart to update",
    /** A release offered: the row's label and the avatar badges' sentence. */
    newVersion: (v: string) => `New version v${v} available`,
    /** A release downloaded / installed and waiting for the restart: the row's label and the badges' sentence. */
    restartToUpdate: (v: string | null) =>
      v !== null ? `Restart to update to v${v}` : "Restart to finish updating",
    /** The combined wording for an anchor covering several update trails at once. */
    updatesAvailable: "Updates available",
    // —— the account-menu row ——
    checkNow: "Check for updates",
    checking: "Checking…",
    rowDownloading: (v: string | null, percent: number | null) =>
      `Downloading${v !== null ? ` v${v}` : " update"}${percent !== null ? ` ${percent}%` : "…"}`,
    rowRestarting: "Restarting…",
    rowUnsupported: "Cannot update from here",
    // —— the modal ——
    title: "Software Update",
    currentVersion: (v: string) => `Current version v${v}`,
    checkingBody: "Checking for updates…",
    upToDate: "You're on the latest version",
    checkFailed: "Update check failed — try again later",
    checkDisabled: "Update checks are disabled (JIUMATE_UPDATE_CHECK=off)",
    releaseNotes: "Release notes",
    openReleases: "Open the Releases page",
    /** What "download and update" does, per backend. */
    availableBodyRelease:
      "Downloads the latest release and installs it into the install directory on the server (the data directory is not touched). You can close this window while it downloads; restart the service afterwards to run it.",
    availableBodyClient:
      "Downloads the new version. You can close this window and keep working while it downloads; restart the app once it is ready to finish updating.",
    /** Shown to non-admins in place of the body above (they can read the notes but cannot run the update). */
    adminOnly: "Only an administrator can run the update from here.",
    downloadAndInstall: "Download and update",
    later: "Later",
    background: "Continue in background",
    downloading: (v: string | null) =>
      v !== null ? `Downloading v${v}…` : "Downloading the update…",
    /** The progress bar's accessible name. */
    downloadProgress: "Download progress",
    /** The server job's stages, shown under the bar while it carries no percentage. */
    phaseResolving: "Resolving the release…",
    phaseDownloading: "Downloading the package…",
    phaseInstalling: "Verifying and installing…",
    ready: (v: string | null) => (v !== null ? `v${v} is ready` : "The update is ready"),
    readyBodyRelease:
      "Restart the service to run the new version. Running tasks will be interrupted; this page reloads once the service is back.",
    /** Mirrors the shell's native restart prompt: the interruption warning must not disappear on the web path. */
    readyBodyClient: "JiuMate will restart to finish updating. Running tasks will be interrupted.",
    /** Nothing supervises the server process (not started through jiumate web / jiumate server), so the restart is the user's. */
    readyBodyManual:
      "The new version is installed. This service is not supervised by jiumate web or jiumate server, so it cannot be restarted from here: re-run jiumate web (or jiumate server) in a terminal.",
    restartNow: "Restart and update",
    restarting: "Restarting…",
    restartingBodyRelease: "This page reloads once the service is back.",
    restartingBodyClient: "The app is about to restart.",
    failed: "Update failed",
    retry: "Retry",
    /** Why this install cannot update itself. */
    unsupportedDev: "A dev run does not update itself",
    unsupportedNonAppImage:
      "Only the AppImage build updates itself on Linux — update a package install through your package manager",
    unsupportedNotViaCli:
      "This service was not started through jiumate web or jiumate server, so it cannot be updated from here",
    unsupportedCli: "This install cannot be updated from the web UI",
    // —— toasts: outcomes that land while the modal is closed ——
    foundNew: (v: string) => `New version v${v} found — open the update entry to download it`,
    foundNewUnnamed: "New version found — open the update entry to download it",
    readyToast: (v: string | null) =>
      v !== null ? `v${v} is ready — restart to update` : "The update is ready — restart to update",
    failedToast: "Update failed — open the update entry for details",
    unsupportedToast: "This install cannot be updated from the web UI",
    /** The shell's own updater failure text — a failed download or signature check, not only a failed lookup. */
    clientUpdateFailed: (detail: string) => `Client update failed: ${detail}`,
    /** A download / restart request failed before the backend could act; `detail` is apiErrorText output. */
    requestFailed: (detail: string) => `Could not run the update action: ${detail}`,
    restartTimedOut:
      "The service has not come back — check jiumate web's output in the terminal, then reload this page",
  },

  /**
   * The four DISMISSIBLE badge trails (Agents / Skill library / model library / cost center),
   * the controls that clear them and the control that acts on all of one at once. The tooltip
   * sentences below are what each dot says; the page notice restates the same count in its own
   * `changes*` wording, since a block that can act needs to say what it would act on.
   */
  todo: {
    pluginUpdates: (n: number) => (n === 1 ? "1 plugin update" : `${n} plugin updates`),
    presetUpdates: (n: number) =>
      n === 1 ? "1 preset model to sync" : `${n} preset models to sync`,
    unexpectedErrors: (n: number) => (n === 1 ? "1 unexpected error" : `${n} unexpected errors`),
    /** Combined anchor whose trails are not all updates — an unexpected error is not one. */
    pending: "Something needs attention",
    /** Clears an update the user has decided not to take now (a later one raises the badge again). */
    dismiss: "Dismiss",
    /** The cost center's wording: nothing is being updated there, the errors are simply read. */
    markRead: "Mark as read",

    // —— The page notice's own line and its bulk action (components/ui/todo-notice.tsx) ——

    /** The notice line where the trail can separate genuinely new things from upgradable ones (Models only). */
    changesWithAdded: (added: number, updated: number): string =>
      `Changes detected: ${added} new, ${updated} to upgrade`,
    /** The same line where the trail has only one honest count — no padded zero (Agents, Plugins). */
    changesUpgradable: (updated: number): string => `Changes detected: ${updated} to upgrade`,
    /** Updates every object the notice counts, behind the page's own confirmation. */
    updateNow: "Update now",
    /** Heading of the confirmation's list of exactly what the batch would write to. */
    willTouch: "This will touch:",
    /** Bulk kernel update confirmation; the body reuses agent.kernelUpdateConfirmBody verbatim. */
    agentsConfirmTitle: (n: number): string => `Update the kernel of ${n} agent(s)`,
    /** Bulk plugin update confirmation. Same warning as the per-plugin confirm, with no single subject. */
    pluginsConfirmTitle: (n: number): string => `Update ${n} plugin(s)`,
    pluginsConfirmBody:
      "Updating reinstalls the library copy over each agent's installed skill and hook files — any local edits are lost. Export a backup first if you need them.",
    /** Bulk preset sync confirmation; the body reuses models.syncCatalogHint verbatim. */
    modelsConfirmTitle: (n: number): string => `Sync ${n} preset model(s)`,
    /** Every target of the batch was written. Counted in agents: both pages that use this
     * send one request per agent, and the partial-failure line below names agents too. */
    bulkDone: (ok: number): string => `${ok} agent${ok === 1 ? "" : "s"} updated`,
    /** Some targets were written and some were not — the failed ones are named, never just counted. */
    bulkPartial: (ok: number, failed: string): string =>
      `${ok} agent${ok === 1 ? "" : "s"} updated; these did not: ${failed}`,
    /** Separator between named targets in the two strings above. */
    listSeparator: ", ",
  },

  /** Desktop task-completion notifications (window unfocused; desktop-shell sessions only). */
  notify: {
    taskCompleteTitle: "Task completed",
    /** `session` is the Session title (defaultSessionTitle when unnamed). */
    taskCompleteBody: (session: string): string => `"${session}" has finished — click to view`,
  },

  common: {
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    back: "Back",
    all: "All",
    previous: "Previous",
    next: "Next",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    settings: "Settings",
    confirm: "Confirm",
    loading: "Loading…",
    saved: "Saved",
    saving: "Saving…",
    /** Clicking save with nothing changed: an info toast instead of a silent no-op. */
    noChangesToSave: "No changes to save",
    /** Confirm-before-save dialog shared by the settings forms (writes go to server-side config files). */
    confirmSaveTitle: "Save changes",
    confirmSaveBody:
      "Save these changes? They will be written to the configuration files on the server.",
    none: "(none)",
    retry: "Retry",
    unknownError: "Request failed, please try again later",
    requiredField: "This field is required",
    copied: "Copied",
    /** Accessible name of the circled "?" that discloses a section or field explanation. */
    moreInfo: "More info",
    /** The same, named for what it explains — so the trigger never repeats the heading it sits in. */
    moreInfoAbout: (subject: string) => `More info: ${subject}`,
    /** Accessible name of the warning-tone popover (circled "!"). Kept apart from "More info":
        a warning announced under that name understates exactly what it warns about. */
    warningAbout: (subject: string) => (subject ? `Warning: ${subject}` : "Warning"),
    name: "Name",
    username: "Username",
    role: "Role",
    actions: "Actions",
    created: "Created",
    cost: "Cost",
    time: "Time",
  },

  auth: {
    usernameHint:
      "2–32 chars: starts with a lowercase letter; lowercase letters, digits and underscores only",
    password: "Password",
    passwordHint: "At least 8 characters",
    showPassword: "Show password",
    hidePassword: "Hide password",
    login: "Sign in",
    /** The line under the login page's title: says what the page wants, not what it is called. */
    loginSubtitle: "Enter your username and password",
    logout: "Sign out",
    admin: "Admin",
    defaultAdminNote:
      "First run: the server prints a first-login link in its startup output — open it to claim the built-in admin “admin” and set a password. No initial password exists to type here",
    /** Login footer line 2: the offline rescue for a forgotten admin password (other users ask the admin instead). */
    forgotAdminNote:
      "Forgot the admin password? Stop the server and run jiumate server reset-admin-password to issue a fresh initial one",
  },

  account: {
    changePassword: "Change password",
    oldPassword: "Current password",
    oldPasswordHint:
      "The password this account currently signs in with — checked before the new one takes effect",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    passwordMismatch: "New passwords do not match",
    initialPasswordBanner: "This account is using its initial password. Please change it soon.",
    changeNow: "Change now",
  },

  admin: {
    users: "Users",
    roleAdmin: "Admin",
    roleUser: "User",
    createUser: "Add user",
    initialPassword: "Initial password",
    initialPasswordFlag: "initial password",
    defaultProjectNote: (id: string): string => `A default Project will be created: ${id}`,
    resetPassword: "Reset password",
    resetPasswordTitle: (u: string): string => `Reset password for ${u}`,
    resetPasswordNote:
      "All sign-in sessions of this user will be revoked; they must sign in with the new password",
    deleteUserTitle: (u: string): string => `Delete user ${u}`,
    deleteUserConfirm: (u: string): string =>
      `This deletes user ${u} and every Project they own (including data directories). This cannot be undone.`,
  },

  project: {
    switcher: "Project",
    /**
     * The built-in Project's label. Its id (`default_project`) is a system constant shared with
     * the CLI, and the admin's copy is provisioned with no display name — so without this the id
     * itself surfaced in the switcher. A label rather than a seeded `name`: the name is data the
     * owner can edit, and writing one at signup would freeze whichever language that install
     * happened to run in.
     */
    defaultProjectName: "Default project",
    /** Project-level roles, as the switcher's badge shows them. */
    roleOwner: "Owner",
    roleMember: "Member",
    create: "New Project",
    createTitle: "New Project",
    id: "Project id",
    idHint:
      "2–64 chars: starts with a lowercase letter; lowercase letters, digits and underscores only. Cannot be changed later.",
    idPrefixHint:
      "The id is prefixed with your username and a hyphen; append lowercase letters, digits or underscores. Cannot be changed later.",
    displayName: "Display name",
    /** Create dialog only: leaving the name empty falls back to the id. In Project settings the saved name cannot be blanked. */
    displayNameHint: "Leave empty to use the Project id as the name",
    settingsTitle: "Project settings",
    members: "Members",
    addMember: "Add member",
    removeMember: "Remove",
    /** New-chat defaults section (Project settings): prefill for every new chat. */
    chatDefaultsTitle: "New chat defaults",
    chatDefaultsHint:
      "Prefilled defaults for every new chat: agent, working directory, approval mode, thinking level and default model.",
    chatDefaultsAgent: "Agent",
    chatDefaultsNotSet: "Not set",
    chatDefaultsApprovalNotSet: "Not set (defaults to allow all)",
    chatDefaultsThinkingNotSet: "Not set (follow the agent's config)",
    /** The model default is single-sourced with the Models page (the same default_model); this is just another entry point. */
    chatDefaultsModelHint: "Same default model as the Models page",
    /** Settings dialog tab rail. */
    settingsTabGeneral: "General",
    settingsTabMembers: "Members",
    settingsTabDefaults: "Defaults",
    settingsTabSecurity: "Security policy",
    /**
     * The 「项目」heading in the System settings menu and its four pages. The Project
     * settings' 「通用」is renamed 「管理」— it is not general preferences but the three
     * operations on the Project ITSELF (rename, create, delete), which "General" never said.
     */
    settingsGroupProject: "Project",
    settingsTabManage: "Project",
    settingsTabManageInfo: "Project name, creation and deletion.",
    newProject: "New project",
    newProjectInfo: "Create a new project and switch to it.",
    /** Shown on the 「项目」settings pages when there is no current Project (they all need one). */
    noCurrentProject: "No current project. Pick or create one from the sidebar first.",
    projectIdLabel: "Project ID",
    deleteProjectDesc: "The project directory is removed recursively and cannot be recovered.",
    /** Security-policy page (Project settings): disclosed by the "?" beside the tab heading. */
    commandPolicyInfo:
      "The command text is normalized for whitespace and quoting, then matched against each enabled rule's regular expression; a hit is refused outright whatever the approval mode allows. It is an accident guardrail: a command assembled at run time is not covered.",
    commandPolicyEnable: "Enable policy",
    commandPolicyEnableDesc: "When off, no rule blocks anything.",
    commandPolicyRules: "Rules",
    commandPolicyRestore: "Restore defaults",
    commandPolicyAddRule: "Add rule",
    commandPolicyEditRule: "Edit",
    commandPolicyApplyRule: "Apply",
    commandPolicyEmpty: "No rules.",
    commandPolicyOn: "Enabled",
    commandPolicyOff: "Disabled",
    commandPolicyRuleName: "Name",
    commandPolicyRulePattern: "Regular expression",
    commandPolicyRuleDesc: "Description",
    commandPolicyInvalidPattern: "Invalid regular expression",
    deleteProject: "Delete Project",
    deleteConfirm:
      "Delete this Project? Its directory will be removed recursively and cannot be recovered.",
    deleteLastForbidden:
      "This is the last Project on this account; create another Project before deleting it",
    deleteDefaultForbidden:
      "default_project is shared with the CLI and cannot be deleted from the web. Its directory is deleted recursively and cannot be recovered.",
    noCredentialTitle: "No model credential configured",
    noCredentialBody:
      "The default model of this Project has no API key yet. Configure it on the Models page before chatting.",
    goToModels: "Go to Models",
    later: "Later",
  },

  agent: {
    savedTakesEffect:
      "Saved. New conversations pick it up right away; running ones after their next compaction.",
    takesEffectSuffix:
      " — new conversations pick it up right away, running ones after their next compaction",
    listTitle: "Agents",
    searchPlaceholder: "Search agents: name / id / description",
    noMatch: "No matching agents",
    create: "Create agent",
    createTitle: "Create agent",
    id: "Agent id",
    idHint:
      "2–64 chars: starts with a lowercase letter; lowercase letters, digits and underscores only. Cannot be changed later.",
    nameHint: "Leave empty to use the agent id as the name",
    description: "Description",
    createPlugins: "Plugins",
    createPluginsPlaceholder: "No plugins selected",
    createPluginsPicked: (n: number): string => `${n} plugin${n === 1 ? "" : "s"} selected`,
    createPluginsHint:
      "Installed into the agent at creation (skills and hook packages); add or remove them later in its Skills and Hooks tabs.",
    createPluginsEmpty: "The plugin library has nothing to install.",
    /** The directory-skills picker's trigger (the field's own label is createDirSkills). */
    createSkillsPlaceholder: "No skills selected",
    createSkillsPicked: (n: number): string => `${n} skill${n === 1 ? "" : "s"} selected`,
    createDirSkills: "Import Skills from a project directory",
    createDirSkillsPick: "No directory selected",
    createDirSkillsHint:
      "Pick a project directory to read the Skills under its .agents/skills and .claude/skills",
    createDirSkillsEmpty: "This directory carries no installable Skills",
    createDirSkillsFound: (n: number): string =>
      `${n} skill${n === 1 ? "" : "s"} found in this directory`,
    createDirSkillsClear: "Clear the selected directory",
    createSnapshot: "Initialize from a snapshot",
    createSnapshotPick: "Choose a snapshot package",
    createSnapshotHint:
      "Pick an exported Agent State snapshot package (.tar.gz) to start the new agent from its state; name and description left empty keep the package's values.",
    createSnapshotSkillsOff:
      "The snapshot package carries its own skills and hooks, so plugin seeding is unavailable.",
    createSnapshotClear: "Remove the selected package",
    sessionCount: (n: number): string => `${n} session${n === 1 ? "" : "s"}`,
    toolCount: (n: number): string => `${n} tool${n === 1 ? "" : "s"}`,
    vaultKeyCount: (n: number): string => `${n} vault key${n === 1 ? "" : "s"}`,
    scheduleCount: (n: number): string => `${n} scheduled task${n === 1 ? "" : "s"}`,
    memoryCount: (n: number): string => (n === 1 ? "1 memory" : `${n} memories`),
    updatedAt: "Last modified",
    activity: (days: number): string => `${days}-day session activity`,
    settings: "Agent settings",
    backToList: "Back to Agents",
    tabOverview: "Overview",
    tabPrompt: "System Prompt",
    tabMemory: "Memory",
    tabRuntime: "Runtime",
    tabTools: "Tools",
    tabSkills: "Skills",
    tabHooks: "Hooks",
    tabVault: "Vault",
    tabSchedules: "Schedules",
    stateDir: "State path",
    copyStateDir: "Copy State path",
    agentsMd: "AGENTS.md",
    systemPrompt: "system_prompt template",
    placeholdersTitle: "Available placeholders (click to insert)",
    insertPlaceholder: "Insert at the system_prompt cursor",
    /** Order must match the default system prompt (core default-config.ts DEFAULT_SYSTEM_PROMPT). Inner tokens ({{VAULT_KEYS}} etc.) live in each feature tab's promptPlaceholders instead. */
    placeholders: [
      ["{{AGENTS_MD}}", "Injects the AGENTS.md content"],
      [
        "{{VAULT}}",
        "Injects the vault block (vault.prompt with the key-name list); empty when its toggle is off",
      ],
      [
        "{{SKILLS}}",
        "Injects the skills block (skills.prompt with installed-skill metadata); empty when its toggle is off",
      ],
      [
        "{{MEMORY}}",
        "Injects the memory block: memory.prompt plus memory.workspace_prompt (persistent workspaces only); empty when memory is off",
      ],
      [
        "{{SCHEDULES}}",
        "Injects the scheduled-tasks block (schedules.prompt with the task-name roster); empty when its toggle is off",
      ],
      ["{{PLATFORM}}", "Runtime platform"],
      ["{{OS_VERSION}}", "Operating system version"],
      ["{{SHELL}}", "Shell used to run commands"],
      ["{{DATE}}", "Current date"],
      [
        "{{PROJECT_DIR}}",
        "JiuMate app data root — all agents' data and project-level data; not the task working directory",
      ],
      ["{{AGENT_ID}}", "Current agent id"],
      ["{{CWD}}", "Absolute Workspace path"],
      ["{{PROVIDER}}", "Model provider group"],
      ["{{MODEL_ID}}", "Upstream model id"],
      ["{{SESSION_ID}}", "Current Session id"],
    ] as ReadonlyArray<readonly [string, string]>,
    maxTurns: "max_turns (max turns per Task, -1 = unlimited)",
    maxTokens: "model.max_tokens",
    thinkingLevel: "model.thinking_level",
    thinkingLevelOptions: [
      ["", "Send no override — keep whatever is currently configured."],
      ["low", "Enables a lower tier of extended reasoning."],
      [
        "medium",
        "Enables a medium tier of extended reasoning (the default tier for a newly created agent).",
      ],
      ["high", "Enables a higher tier of extended reasoning; slower responses."],
      [
        "xhigh",
        "Enables an extended tier of reasoning beyond high; identical to high on some models.",
      ],
      [
        "max",
        "Enables the deepest tier of extended reasoning; slowest and identical to xhigh on some models.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    thinkingLevelNoneKept:
      "Stored legacy tier: new selections no longer offer the off tier (many models cannot disable thinking).",
    timeoutMs: "model.timeoutMs",
    timeoutMsHint: "Idle budget between upstream events, ms — not a cap on the whole request",
    compaction: "Context compaction",
    maxContextLength: "max_context_length",
    maxContextLengthHint: "Context threshold that triggers compaction",
    maxSessionTurns: "max_session_turns",
    maxSessionTurnsHint: "Turn threshold that triggers compaction",
    compactionMode: "mode (compaction strategy)",
    compactionModeOptions: [
      ["", "Send no override — keep whatever is currently configured."],
      [
        "summarize",
        "Summarizes the old context with the model, then continues from that summary in a fresh window (default).",
      ],
      [
        "discard",
        "Drops the old context without summarizing; the next turn starts fresh in a new window.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    /**
     * Deliberately empty: the values (`summarize`, `discard`) already read as English, so the rows
     * show the raw value with no annotation — exactly what this menu showed before the zh names
     * existed. `optionRows` falls back to the value, so an empty table is a complete answer.
     */
    compactionModeNames: {} as Readonly<Record<string, string>>,
    compactionPrompt: "prompt (summarization prompt)",
    maxTurnsInvalid: "max_turns must be > 0 or -1",
    timeoutInvalid: "timeoutMs must be > 0 or -1",
    toolFieldInvalid: (name: string, field: string) =>
      `${name}: ${field} must be a positive integer or -1`,
    toolPermission: "permission",
    permissionReadLabel: "Read-only",
    permissionReadDescription: "Only reads. Auto-approved when the approval mode is read-only.",
    permissionReadWriteLabel: "Read & write",
    permissionReadWriteDescription:
      "Can modify things. Needs manual confirmation when the approval mode is read-only.",
    toolTimeout: "timeoutMs",
    toolMaxOutput: "maxOutputLength",
    toolCallDescription: "call_description",
    callDescriptionHint:
      "call_description: when on (the default), the tool's schema keeps the optional description argument — a model-written sentence about each call, shown to the user while it runs; when off, the argument is filtered out of the schema at assembly. Only tools whose parameters declare a description property can be toggled.",
    mcpServers: "MCP Servers",
    mcpDesc:
      "Connect external MCP Servers: their tools join this agent's toolset as mcp__<name>__<tool>. Changes in this block save immediately.",
    mcpEmpty: "No MCP Servers configured yet",
    mcpAdd: "Add MCP Server",
    mcpPick: "Add from registry",
    mcpPickTitle: "Add from the Project registry",
    mcpPickDesc:
      "Pick from the MCP servers registered under Plugins · Skills → Connectors. What gets added is a copy: editing it here later changes neither the registry nor any other Agent.",
    mcpPickEmpty:
      "The registry has no MCP servers yet — add one under Plugins · Skills → Connectors first.",
    mcpPickAllAdded: "Every MCP server in the registry is already added.",
    mcpPickAdd: "Add",
    mcpPickAdded: "Added",
    mcpEditTitle: "Edit MCP Server",
    mcpRemove: "Remove",
    mcpName: "name",
    mcpNameHint: "Tool-name prefix: mcp__<name>__<tool>; letters, digits, _ and - only",
    mcpTransport: "transport",
    mcpTransportStdio: "Local process: spawns command and talks over stdin/stdout",
    mcpTransportHttp: "Streamable HTTP: the current spec's remote transport",
    mcpTransportSse: "Legacy HTTP+SSE: kept for servers that have not migrated",
    mcpTarget: "command / url",
    mcpCommand: "command",
    mcpArgs: "args",
    mcpArgsHint: "One argument per line",
    mcpEnv: "env",
    mcpEnvHint: "One KEY=value per line; the Agent vault is not injected into MCP Server processes",
    mcpCwd: "cwd",
    mcpCwdHint: "Leave empty to use the Session's Workspace",
    mcpUrl: "url",
    mcpHeaders: "headers",
    mcpHeadersHint: "One Header-Name: value per line (auth headers such as Authorization)",
    mcpPermission: "permission",
    mcpPermissionAuto: "auto",
    mcpPermissionAutoLabel: "Auto (readOnlyHint)",
    mcpPermissionAutoDescription:
      "Each tool gets the level its own readOnlyHint annotation implies: read-only when it declares one, read & write otherwise.",
    mcpPermissionReadDescription:
      "Treat every tool of this server as read-only, whatever it declares. Auto-approved when the approval mode is read-only.",
    mcpPermissionReadWriteDescription:
      "Treat every tool of this server as read & write, whatever it declares. Needs manual confirmation when the approval mode is read-only.",
    mcpPermissionHint:
      "Only the read-only approval mode reads this level; allow-all, deny-all and always-ask ignore it. It never restricts what the server itself can do — marking a server read-only that is not one only drops the confirmation read-only mode would have asked for.",
    mcpConnectTimeout: "connectTimeoutMs",
    mcpBudgetsHint:
      "Leave empty for defaults: connectTimeoutMs is the connect + tool-discovery budget (default 10000); timeoutMs / maxOutputLength bound every tool of this Server.",
    mcpNameInvalid: "Letters, digits, _ and - only, starting with a letter or digit",
    mcpUrlInvalid: "Must be a valid http(s) URL",
    mcpLineInvalid: (line: number): string => `Line ${line} is not valid`,
    mcpNumberInvalid: "Must be an integer > 0",
    mcpDuplicateName: "A server with this name already exists",
    mcpTest: "Test connection",
    mcpTesting: "Testing…",
    mcpTestOk: (toolCount: number, latencyMs?: number): string => {
      const timing = latencyMs !== undefined ? ` (${(latencyMs / 1000).toFixed(1)}s)` : "";
      return toolCount === 0
        ? `Connected, but the server exposes no tools${timing}`
        : `Connected — ${toolCount} tool${toolCount === 1 ? "" : "s"}${timing}`;
    },
    mcpTestFail: (detail: string): string => `Connection failed: ${detail}`,
    mcpTestAllConfirm: (n: number): string =>
      `Connects to ${n === 1 ? "the configured MCP server" : `each of the ${n} configured MCP servers`} in turn and runs tool discovery (real connections, nothing is saved); results land on each row.`,
    mcpTestAllStart: "Start test",
    mcpTestPending: "Testing…",
    mcpTestBadge: (toolCount: number, latencyMs?: number): string =>
      `${toolCount} tool${toolCount === 1 ? "" : "s"}${latencyMs !== undefined ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ""}`,
    mcpTestBadgeFail: "Connection failed",
    mcpDeleteTitle: "Delete MCP Server",
    mcpDeleteConfirm: (name: string): string =>
      `Delete MCP Server "${name}"? Its tools stop being available from the next Session on.`,
    defaultValue: "(default)",
    deleteAgent: "Delete agent",
    builtinUndeletable: "Built-in agents cannot be deleted",
    deleteConfirm: (name: string): string =>
      `Delete agent "${name}"? Its directory (including all Traces) will be removed recursively and cannot be recovered.`,
    stateTitle: "Agent State",
    stateVersion: "Agent State version",
    transferDesc:
      "Export the current Agent State snapshot (tar.gz); importing overwrites the whole directory and adopts the version inside the package.",
    exportSnapshot: "Export snapshot",
    importSnapshot: "Import snapshot",
    importing: "Importing…",
    importDone: (v: number): string => `Import finished, Agent State version v${v}`,
    importConflictTitle: "Version conflict",
    importConflictBody:
      "The snapshot's version is not newer than the current one; importing will overwrite the existing Agent State. Continue?",
    resetConfigTitle: "Restore default configuration",
    resetConfigAction: "Restore default configuration",
    resetConfigConfirmBody:
      "This overwrites the agent's existing configuration with the current defaults: the custom system prompt, tool list, model/compaction settings and MCP servers are all replaced, keeping only name and description. Like a skill update this cannot be undone. Continue?",
    resetConfigDone: "Configuration restored to the current defaults",
    kernelTitle: "Kernel",
    kernelLegacy: "predates kernel versioning",
    kernelOutdatedHint: "Kernel update available",
    kernelUpdateNeeded: "Kernel update needed",
    kernelUpToDate: "Up to date",
    kernelUpdateTitle: "Update kernel",
    kernelCurrent: "current",
    kernelLatest: "latest",
    kernelUpdateAction: "Update kernel",
    kernelUpdateConfirmBody:
      "Settings tabs you have not customized will be updated to the current built-in defaults; a tab you have edited stays unchanged in full and is listed in the result. Name, description, the State version and MCP servers are unaffected. Continue?",
    kernelUpdateDone: (version: string, advanced: number): string =>
      advanced > 0
        ? `Kernel updated to ${version}; ${advanced} tab(s) now follow the new defaults`
        : `Kernel updated to ${version}; every tab was already current or kept as customized`,
    kernelUpdateKeptIntro: "Kept whole because customized:",
    kernelListSeparator: ", ",
  },

  models: {
    title: "Models",
    addCustom: "Add custom model",
    addToGroup: "Add model",
    editTitle: "Model settings",
    addTitle: "Add model (OpenAI protocol)",
    addTitleVendor: "Add model",
    addProtocolHint:
      "New models use the OpenAI Chat Completions protocol; set the base URL to a compatible endpoint",
    vendorProtocolHint: (vendor: string): string =>
      `Only ${vendor}'s official API protocol is supported; use a custom model group for OpenAI-compatible endpoints.`,
    autoRouteNone:
      "This model ID cannot be routed with the current provider protocol. If it uses an OpenAI-compatible endpoint, move it to Custom.",
    useCustomGroup: "Move to Custom",
    addGroup: "Add group",
    addGroupTitle: "Add group",
    addGroupDesc:
      'User-defined groups share Custom semantics. "Import models" detects (or lets you pick) the endpoint\'s protocol, then imports every model it serves in one go; "Create only" adds models one by one after the group. Groups live on model entries — the group appears once its first model is saved.',
    groupModeCreate: "Create only",
    groupModeImport: "Import models",
    groupImportAll: "Import all models",
    groupImportNeedUrl: "Fill in a valid base URL first (http/https)",
    groupImportKeyHint: "Leave empty to read the protocol's OPENAI_* / ANTHROPIC_* env vars",
    groupImportListing: "Fetching model list…",
    groupImportSaving: (n: number): string => `Importing ${n} models…`,
    groupImportUnsupported: "This protocol cannot list models — add them manually",
    groupImportFailed: "Fetching the model list failed",
    groupImportEmpty: "No models to import from this endpoint",
    groupImported: (added: number, skipped: number): string =>
      skipped > 0
        ? `Imported ${added} models, skipped ${skipped} entries`
        : `Imported ${added} models`,
    groupNameLabel: "Group name",
    groupNameHint: "Starts with a lowercase letter / digit; may contain - and _",
    groupNameInvalid:
      "Group names may only use lowercase letters, digits, - and _ (starting with a letter or digit), up to 32 characters",
    groupNameExists: "This name is taken by a built-in group or an existing entry",
    groupEmptyHint: "No models in this group yet; use “Add model” to create one",
    deleteGroup: "Delete group",
    deleteGroupTitle: "Delete group",
    deleteGroupConfirm: (label: string, n: number): string =>
      `Delete the group “${label}”? Its ${n} models and their API key configuration will be removed.`,
    groupDeleted: (n: number): string => `Group deleted (${n} models)`,
    searchPlaceholder: "Search models: id / name / provider",
    noSearchResults: "No matching models",
    syncCatalog: "Sync presets",
    syncCatalogHint:
      "Update preset models from the built-in catalog: add missing entries and reset differing ones to the catalog's fields; locally added models and API keys are left untouched",
    syncDone: (added: number, updated: number) =>
      `Presets synced: ${added} added, ${updated} updated`,
    syncUpToDate: "Presets are already up to date",
    homepage: "Model page",
    speedTest: "Speed test",
    speedTestTitle: "Speed test",
    speedTestConfirm: (n: number): string =>
      `This sends one real request to each of the ${n} models in this group, one at a time, to measure time-to-first-token (TTFT) and output rate (TPS). It consumes a small amount of API quota. Continue?`,
    speedTestStart: "Start",
    speedPending: "Testing…",
    speedFailed: "Test failed",
    ttftTitle: "Time to first token (TTFT)",
    tpsTitle: "Output rate (TPS)",
    modelCount: (n: number): string => `${n} model${n === 1 ? "" : "s"}`,
    modelId: "Model ID",
    modelIdHint: "The upstream API model id, e.g. gpt-5.5",
    displayName: "Display name",
    displayNameHint: "Defaults to the model ID",
    providerGroup: "Group",
    contextWindow: "Context window",
    tokenUnit: "Token",
    contextWindowHint: "Leave empty if unknown",
    maxTokens: "Max output tokens",
    maxTokensHint: "Empty = inherit agent setting",
    maxTokensTitle:
      "Caps output tokens per request; leave empty to inherit the agent setting — lower it for small-context models",
    maxTokensInvalid: "Must be a positive integer",
    clientTypeLocked: (t: string): string => `Protocol: ${t} (kept as configured; not editable)`,
    protocol: "Protocol",
    protocolNames: {
      "openai-responses": "OpenAI Responses",
      "ant-messages": "Anthropic Messages",
      "openai-chat": "OpenAI Chat Completions",
    } as Record<string, string | undefined>,
    protocolTriggerTitle: (name: string): string => `Protocol: ${name}. Click to change it.`,
    /** Suffix placeholder while no protocol is selected — never a protocol name, so nothing looks pre-chosen. */
    protocolUnset: "Select protocol",
    detectProtocol: "Detect",
    detectProtocolHint: "Probe the base URL and apply the protocol it serves",
    detecting: "Detecting…",
    /** Success toast; the protocol itself then shows in the base URL field's suffix. */
    detectedProtocol: (name: string): string => `Detected ${name}; applied`,
    /** The ONE failure toast: every mode collapses to it, naming only what the user can act on. */
    detectFailedBody: "Could not detect the protocol. Please check the API key and the base URL.",
    /** Save-time detection came back empty: the save proceeds on the compatible client. */
    detectFellBack: "Protocol not detected; saved as OpenAI Chat Completions",
    addProtocolHintDetect:
      "Pick the protocol from the base URL field's suffix (OpenAI Responses / Anthropic Messages / OpenAI Chat Completions), or press Detect to probe the endpoint — saving without one detects it first",
    addTitleCustom: "Add model",
    vision: "Vision support",
    /** Detect action beside the vision switch. */
    detectVision: "Detect",
    detectingVision: "Testing…",
    detectVisionHint:
      "Send one tiny test image to see whether this model accepts images (uses your API key)",
    detectVisionNeedsId: "Fill in the model id first, then detect.",
    detectVisionOk: "This model accepts images; vision turned on",
    detectVisionNo: "This model does not accept images; vision left off",
    visionOffProxyHint: "Images are read via the vision proxy model",
    fastMode: "Fast mode",
    fastModeHint:
      "Faster output, billed at the provider's premium tier; the Tokens page still counts it at the entry's standard prices",
    fastModeUnsupported:
      "This model does not support fast mode — turn it off, or its requests will fail",
    fastModeConfirmTitle: "Enable fast mode",
    fastModeConfirmBody:
      "Fast mode is billed at the provider's premium price list (MiniMax charges 1.5x standard; OpenAI and Anthropic publish separate premium rates). The entry's recorded per-token prices are not adjusted, so the Tokens page will under-report this usage.",
    fastModeConfirmPreview:
      "Anthropic's fast mode is a limited research preview: until your organization is granted access, requests return a 429 rate-limit error.",
    fastModeBadge: "Fast",
    visionBadge: "Vision",
    freeBadge: "Free",
    /**
     * Rides the group's own collapse bar, which on this group carries five actions — the most
     * crowded row on the page. One word, because the vendor name beside it is what a reader
     * needs first and is the element that truncates.
     */
    recommendedGroup: "Recommended",
    discountBadge: (pct: number): string => `-${pct}%`,
    discountTitle: (pct: number): string => `Promotion: ${pct}% off the list price`,
    offPeakTitle: (pct: number): string =>
      `Off-peak rate: ${pct}% off list. Peak hours bill at list price — 09:00–12:00 and 14:00–18:00 Beijing time, Monday to Friday`,
    visionModelBadge: "Proxy vision",
    usedTokens: (v: string) => `${v} toks`,
    usedTokensTitle: "Tokens this model has used, all time",
    setVisionModel: "Set as proxy vision model",
    visionModelHint: "Describes images via describe_image for models without vision",
    priceUnitShort: "/M tok",
    testConnection: "Test connection",
    testing: "Testing…",
    testOk: (ms: number): string => `Connected (${ms} ms)`,
    testFailed: (msg: string): string => `Failed: ${msg}`,
    priceCacheRead: "Cache read price",
    priceCacheWrite: "Cache write price",
    priceOutput: "Output price",
    currency: "Currency",
    currencyUsd: "USD $",
    currencyCny: "CNY ¥",
    apiKey: "API key",
    apiKeyKeepHint: "Leave empty to keep the current key",
    apiKeyEnvHint: (envKey: string): string => `Leave empty to use the ${envKey} env var`,
    keyConfigured: "Key configured",
    clearApiKey: "Clear stored API key",
    baseUrl: "Custom base URL",
    baseUrlHint: "Leave empty to use the provider default",
    baseUrlSuffixTitle:
      "The client appends the protocol path shown at the field's right edge to the base URL",
    baseUrlRequired: "A base URL is required",
    contextWindowDefaultHint: (n: number): string => `Defaults to ${n} if empty`,
    confirmDeleteTitle: "Delete model",
    confirmDelete: (name: string): string =>
      `Delete "${name}"? Its configuration and API key will be removed.`,
    groupApiKey: "Set key",
    groupApiKeyTitle: (label: string): string => `Set the API key for ${label}`,
    groupApiKeyHint: (n: number): string =>
      `Applies to all ${n} models in this group; leave empty to keep them unchanged.`,
    getApiKey: "Manage keys",
    getModelIds: "Get model IDs",
    groupKeyApplied: (n: number): string => `API key set for ${n} models`,
    oauthKey: "Authorize key",
    oauthTitle: (label: string): string => `Authorize a new ${label} API key`,
    oauthIntro: (label: string, n: number): string =>
      `A new API key will be created on your ${label} account and written to all ${n} models in this group, replacing the key they use now.`,
    oauthAuthorize: "Open authorization page",
    oauthWaiting: "Waiting for the authorization to finish in the other tab…",
    /**
     * The dialog's own report once the key has landed. It names the provider as well as the
     * count, because the user is reading it after a trip to another tab and may not remember
     * which authorization they just finished.
     */
    oauthAppliedBody: (provider: string, n: number): string =>
      `Authorized. ${provider}'s API key is set on ${n} model${n === 1 ? "" : "s"} and ready to use.`,
    oauthManualSwitch: "Page can't redirect back? Enter the code by hand",
    oauthCallbackSwitch: "Go back to the automatic redirect",
    oauthManualHint: "Open the authorization page, then paste the one-time code it shows you here.",
    oauthCodeLabel: "Authorization code",
    oauthSubmitCode: "Submit code",
    oauthTimedOut: "The authorization never came back. Enter the code by hand, or start again.",
    oauthRetry: "Start again",
    oauthErrors: {
      invalid_request: "The authorization request was rejected. Start again.",
      code_rejected:
        "That authorization is no longer valid: it expired or was already used. Start again.",
      upstream_failed: "The provider returned no usable key. Start again.",
      unreachable: "The provider could not be reached. Check the network and start again.",
      apply_failed:
        "A key was created but could not be saved. Authorize again, then delete the unused key in the provider's console.",
    },
    providerEnvNotes: {
      zhipu:
        "Defaults to the Z.AI global endpoint (api.z.ai); keys from bigmodel.cn need base URL https://open.bigmodel.cn/api/paas/v4",
      moonshot:
        "Defaults to the China endpoint (api.moonshot.cn); keys from platform.kimi.com need base URL https://api.moonshot.ai/v1",
    },
    confirmVisionModelTitle: "Set as proxy vision model",
    confirmVisionModel: (name: string): string =>
      `Make "${name}" the proxy vision model? Models without vision will read images through it via describe_image.`,
    confirmSaveTitle: "Save model settings",
    confirmSave: (name: string): string => `Save the changes to "${name}"?`,
    confirmDefaultTitle: "Set as default model",
    confirmDefault: (name: string): string =>
      `Make "${name}" the default model? New sessions will use it by default.`,
    default: "Default",
    setDefault: "Set as default model",
    remove: "Delete model",
    readOnlyHint: "Members have read-only access; only owners can change models and credentials",
    empty: "No models configured yet",
    noKey: "No key",
    readFromEnv: "Read from environment variable",
    showModelsWithoutKey: (n: number): string =>
      `Show model${n === 1 ? "" : "s"} without a key (${n})`,
    modelIdExists: "This model id already exists",
    pricingAllOrNone: "Fill all three prices",
    pricingInvalid: "Must be a number",
    contextWindowInvalid: "Must be a number",
  },

  memory: {
    desc: "Long-term memory across Sessions (stored in agent_state/memory/): the agent saves what is worth keeping as it works, and you can also just ask it to remember something. User memory applies to all of this agent's sessions; workspace memory is kept per workspace. Memory edits are made by the agent in chat. Turning the switch off only stops memory from being used and deletes nothing.",
    enable: "Enable memory",
    userScope: "User memory",
    templateMissing:
      "The prompt template has no {{MEMORY}} placeholder, so memory never enters the context.",
    insertPlaceholder: "Insert the {{MEMORY}} placeholder",
    insertPlaceholderDone: "Inserted",
    promptSection: "Memory prompt",
    promptSectionHint:
      "What the template's {{MEMORY}} placeholder expands to. The main prompt is injected into every session; the workspace addendum only in sessions with a persistent workspace.",
    promptLabel: "Main prompt",
    workspacePromptLabel: "Workspace addendum",
    /**
     * Memory-prompt placeholder reference; a chip inserts into whichever field was focused
     * last. The two indexes plus the workspace directory — the user directory stays a literal
     * pattern in the prompt, resolvable from the Environment section.
     */
    promptPlaceholders: [
      [
        "{{USER_MEMORY_INDEX}}",
        "Content of the user MEMORY.md index (at most 200 lines and 25,000 characters total)",
      ],
      [
        "{{WORKSPACE_MEMORY_INDEX}}",
        "Content of the workspace MEMORY.md index (at most 200 lines and 25,000 characters total); effective only in the workspace addendum",
      ],
      [
        "{{WORKSPACE_MEMORY_DIR}}",
        "Absolute path of the current workspace's memory directory; effective only in the workspace addendum",
      ],
    ],
    insertToken: "Insert at the cursor",
    itemCount: (n: number): string => (n === 1 ? "1 item" : `${n} items`),
    emptyScope:
      "No memories for this Workspace yet — the agent saves what is worth keeping as it works",
    emptyUserScope: 'No user memories yet — say "remember …" in a chat and the agent will save it',
    add: "Add",
    addScopeLabel: (scope: string): string => `Add to ${scope}`,
    addTitle: "Add memory",
    addWhy:
      "The agent organizes and saves memories in a chat: fill in the content, open a new conversation, and the agent does the rest.",
    addContentLabel: "Content or source to remember",
    addContentPlaceholder: "Paste the content to remember, or a file path / URL",
    /** Prefilled draft for the add-via-chat flow, per scope kind; the required content follows on the next line. */
    addPromptLead: {
      user: "Please turn the following into memories in user memory:",
      workspace: "Please turn the following into memories in this workspace's memory:",
    },
    view: "View",
    edit: "Edit",
    editTitle: "Edit memory",
    editWhy:
      "Content edits are made by the agent in a chat: confirm the prompt to open a new conversation, and the agent updates the memory file and its MEMORY.md index together.",
    editRequirementLabel: "What to change",
    editRequirementPlaceholder: "Describe the change — you can finish it in the chat",
    editPromptLabel: "Prompt preview",
    editCopyPrompt: "Copy prompt",
    editOpenChat: "Open a new chat",
    delete: "Delete",
    deleteTitle: "Delete this memory?",
    deleteConfirm: (name: string): string =>
      `This deletes "${name}" and removes its index line from MEMORY.md. This cannot be undone.`,
    deleteDone: "Deleted",
    /** Prefilled draft for the edit-via-chat flow; the user completes the trailing requirement line before sending. */
    editPromptLead: (title: string): string => `Please update a memory: ${title}`,
    editPromptTail: "What to change: ",
    exportScope: "Export",
    exportScopeHint: "Download every memory in this group as one JSON document",
    exportScopeLabel: (scope: string): string => `Export ${scope}`,
    importScope: "Import",
    importScopeHint: "Restore memories into this group from an exported JSON document",
    importScopeLabel: (scope: string): string => `Import into ${scope}`,
    importTitle: "Import memories",
    importWhy:
      "Reads a memory group exported from this or another agent: a JSON file holding the memories and the group's MEMORY.md index.",
    importFile: (name: string, count: number): string => `${name} — ${count} memories`,
    importModeLabel: "When this group already has a memory of the same name",
    importModeSkip: "Keep the one that is here",
    importModeSkipHint: "Adds only what this group does not have. Nothing here is lost.",
    importModeOverwrite: "Take the file's version",
    importModeOverwriteHint: "Memories the file does not carry are left alone.",
    importModeReplace: "Replace the whole group",
    importModeReplaceHint: "Every memory the file does not carry is deleted.",
    importAction: "Import",
    importInvalidFile: "This file is not a memory export.",
    importEmptyFile: "This file carries no memories.",
    importConfirmTitle: "Confirm the import",
    importWillOverwrite: (names: string[]): string =>
      `${names.length} memories will be overwritten: ${names.join(", ")}`,
    importWillRemove: (names: string[]): string =>
      `${names.length} memories will be deleted: ${names.join(", ")}`,
    importWillReplaceIndex: "The group's MEMORY.md index will be replaced.",
    importIrreversible: "This cannot be undone.",
    importDone: (added: number, overwritten: number, removed: number): string =>
      `Imported: ${added} added, ${overwritten} replaced, ${removed} deleted`,
    importNothingNew: "Nothing to import — this group already has every memory in the file",
  },

  vault: {
    desc: "Environment variables owned by this agent (stored in agent_state/.vault.toml), injected into the environment of its shell commands (exec_command); key names are shared with the model, values never enter the model context. Subagents use their own vaults and do not inherit this one. Saved changes take effect from the next task (a task already running is unaffected).",
    key: "Name",
    value: "Value",
    valueMasked: "Value (masked)",
    add: "Add",
    addTitle: "Add variable",
    remove: "Remove",
    deleteTitle: "Delete variable",
    deleteConfirm: (key: string): string =>
      `Delete variable "${key}"? Its value cannot be recovered.`,
    overwriteTitle: "Overwrite existing variable",
    overwriteConfirm: (key: string): string =>
      `"${key}" already exists — saving will overwrite its value, which cannot be recovered.`,
    empty: "No variables configured yet",
    readOnlyHint: "Members are read-only; only the owner can edit the vault",
    keyHint: "Letters, digits and underscores; must not start with a digit",
    keyInvalid: "Invalid name: only letters, digits and underscores, not starting with a digit",
    valueRequired: "Value must not be empty",
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable vault",
      templateMissing:
        "The prompt template has no {{VAULT}} placeholder, so the vault section never enters the context.",
      legacyTemplate:
        "The template still carries the legacy hardcoded # Vault section: one-click migration replaces it in place with the {{VAULT}} placeholder, wording unchanged, after which it is editable below.",
      insertPlaceholder: "Insert the {{VAULT}} placeholder",
      migrate: "Migrate to the {{VAULT}} placeholder",
      promptSection: "Vault prompt",
      promptSectionHint:
        "What the template's {{VAULT}} placeholder expands to; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{VAULT_KEYS}}",
          'Vault key-name list (one "- KEY" line per key, names only — values are never injected; empty when no keys)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  schedule: {
    desc: "Scheduled tasks (agent_state/schedule/*.toml): the prompt is sent to the target Session on schedule; files can also be edited by hand, and changes made here take effect immediately.",
    readOnlyHint: "Members are read-only; only the owner can modify schedules",
    colStatus: "Status",
    colPeriod: "Period",
    colTarget: "Target",
    colFireTimes: "Next / last fired",
    colQueued: "Queue",
    statusNames: {
      active: "Active",
      disabled: "Disabled",
      expired: "Expired",
      done: "Done",
      missed: "Missed",
      invalid: "Invalid",
    } as Record<string, string>,
    queued: "Queued",
    once: "One-off",
    newSession: "New session",
    invalidFiles: "Files that failed to parse (skipped by the scheduler)",
    empty: "No scheduled tasks yet",
    enable: "Enable",
    disable: "Disable",
    addTitle: "New scheduled task",
    editTitle: (name: string): string => `Edit scheduled task "${name}"`,
    nameHint: "The file name (without .toml); cannot be changed later",
    prompt: "Prompt",
    enabled: "Enabled",
    startAt: "Start at",
    endAt: "End at",
    period: "Period",
    periodPlaceholder: "30m / 12h / 7d; leave empty for a one-off task",
    target: "Target",
    targetNew: "New session each time",
    targetSession: "Bound Session",
    sessionId: "Session",
    /** Bind-Session picker (searchable dropdown): trigger placeholder, search box, and empty states. */
    chooseSession: "Choose a Session to bind",
    sessionSearch: "Search title or Session id…",
    sessionNoMatch: "No matching Session",
    sessionEmpty: "This agent has no Sessions yet",
    workspace: "Workspace",
    model: "Model",
    modelDefault: "Project default",
    deleteTitle: "Delete scheduled task",
    deleteConfirm: (name: string): string => `Delete scheduled task "${name}"?`,
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable schedules",
      templateMissing:
        "The prompt template has no {{SCHEDULES}} placeholder, so the scheduled-tasks section never enters the context.",
      insertPlaceholder: "Insert the {{SCHEDULES}} placeholder",
      promptSection: "Schedules prompt",
      promptSectionHint:
        "What the template's {{SCHEDULES}} placeholder expands to — teaches the model to manage scheduled tasks with its file tools; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{SCHEDULE_LIST}}",
          'Current task-name list (one "- name" line per task; an empty-roster note when none exist)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  /**
   * Plaza (features/inspiration/*): the built-in cases plus the ones admins authored,
   * filed into categories. The built-in cases' own copy is NOT here — it travels with the case, as
   * the `title`/`titleZh` fields in `@jadelau/inspirations/presets`, which is what lets
   * an admin's case and a built-in one be the same kind of thing. This group carries the chrome.
   */
  inspiration: {
    pageTitle: "Plaza",
    /** 新会话页输入框下方那条封面卡片条的标题。 */
    stripTitle: "From inspiration",
    /** 卡片条右上角的按钮：换下一组卡片。 */
    shuffle: "Shuffle",
    /** 卡片条上分类选项卡的第一个：显示所有分类的案例。 */
    allCategories: "All",
    pageDesc:
      "Built-in prompts, agents, skills and tools — one click fills the composer and you are started.",
    /** The card's and the detail modal's star. */
    favorite: "Add to favourites",
    unfavorite: "Remove from favourites",
    /** The badge on a built-in case: ships with the product, and cannot be edited or deleted. */
    official: "Official",
    /** The badge on a case an admin parked (`enabled: false`) — only an admin sees those cards. */
    hiddenBadge: "Disabled",
    /** The tab strip: All / Featured / one per category / Favourites. */
    tabAll: "All",
    tabFeatured: "Featured",
    tabFavorites: "Favourites",
    /** The search box (title, description, prompt, skill and tool names; both languages match). */
    searchLabel: "Search inspirations",
    searchPlaceholder: "Search inspirations",
    /** The card's and the detail modal's action. */
    invoke: "Make one like this",
    /**
     * The label on the card's own button. The same action as the detail modal's `invoke`, and worded
     * to match; shorter on the card, where it shares a row with the kind and official badges.
     *
     * "It fills, it does not send" is left to the draft row's `fillHint` — that is where a user meets
     * the behaviour first, and the only place with room to spell it out.
     */
    invokeHint: "Make this",
    openDetail: "View detail",
    /** Second tooltip line on a draft-screen row: the click fills, it does not send. */
    fillHint: "Click to fill the composer — edit it if you like, then send",
    /** The draft picker's last row: into the full library. Carries the count when there is one. */
    browseAll: (total?: number) =>
      total === undefined ? "Browse all inspirations →" : `Browse all inspirations (${total}) →`,
    /** Empty states. */
    empty: "No cases here yet.",
    favoritesEmpty: "Nothing starred yet. Tap the heart on a card to keep it here.",
    searchEmpty: (query: string) => `No case matches "${query}".`,
    /** Shown when the server's catalog could not be read (only the built-ins are listed). */
    offlineHint:
      "Could not read the plaza catalog from the server — showing the built-in cases only.",
    /** Detail modal section headings. */
    previewLabel: "Preview",
    promptLabel: "Prompt",
    skillsLabel: "Preselected skills",
    toolsLabel: "Expected tools",
    agentLabel: "Suggested agent",
    noneHint: "(none)",
    metaLine: (category: string) => `Category: ${category}`,
    /** The kind badge (shared by the card and the detail modal). */
    kind: {
      app: "App",
      agent: "Agent",
      skill: "Skill",
      tool: "Tool",
      prompt: "Prompt",
    },
    /** Admin: capture a Session into the library (the details card's bottom row). */
    capture: "Add to the library",
    captureHint: "Save this conversation's opening prompt as a reusable case",
    captureNoPrompt: "This conversation has no user prompt yet — say something first",
    /** Admin: create / edit / delete a case. */
    newCase: "New case",
    createTitle: "New case",
    editTitle: "Edit case",
    /**
     * 编辑内置案例时表单顶部的一句话。保存会写一份同 id 的管理员案例把内置那份遮住，
     * 内置本身不动——删掉这份就会回到内置，所以这不是一句可有可无的说明。
     */
    shadowBuiltinHint:
      "This is a built-in. Saving writes your own copy under its id and puts that in its place; the built-in itself is untouched, and deleting your copy brings it back.",
    manageCategories: "Categories",
    created: "Case created",
    saved: "Case saved",
    deleted: "Case deleted",
    deleteTitle: "Delete case",
    deleteConfirm: (title: string) =>
      `Delete "${title}"? Its directory — cover and preview included — goes with it.`,
    /** Form fields. */
    fieldTitleZh: "Name (Chinese)",
    fieldTitleEn: "Name (English)",
    fieldId: "Id",
    fieldIdHint:
      "Lowercase letters, digits, dash or underscore; it is also the case's directory name and cannot change after creation",
    fieldKind: "Kind",
    fieldCategory: "Category",
    fieldDescriptionZh: "Summary (Chinese)",
    fieldDescriptionEn: "Summary (English)",
    fieldPromptZh: "Prompt (Chinese)",
    fieldPromptEn: "Prompt (English)",
    fieldPromptInfo:
      "Clicking “Make one like this” puts this text into the composer verbatim and sends nothing. Say what to build and the constraints the result would be wrong without — the Agent works out the steps.",
    fieldAgent: "Suggested agent",
    fieldAgentHint:
      "A case is global and an agent belongs to a project, so only the id is stored — an id that is not in the user's project falls back to the agent they are on",
    /** First entry of the suggested-agent picker: nothing suggested. */
    agentNone: "Not specified (use the current agent)",
    fieldSkills: "Preselected skills",
    fieldSkillsHint:
      "Picked from the shipped skill catalog; “Make one like this” preselects only those the chosen Agent has installed",
    skillsEmpty: "The skill catalog is empty",
    fieldTools: "Expected tools",
    fieldToolsHint:
      "Taken from the chosen Agent's own tools; shown only — nothing is installed or reconfigured",
    toolsEmpty: "This Agent has no tools",
    toolsNoAgent: "Create an Agent in this project first — its tools are what this list offers",
    toolsSearchPlaceholder: "Search tools",
    toolsNoMatch: "No tool matches",
    /** The multi-select trigger's label: nothing picked / N picked. */
    pickerNone: "None picked",
    pickerPicked: (n: number) => `${n} picked`,
    fieldCover: "Cover",
    fieldCoverHint: "A glyph uses an emoji; uploading an image replaces it",
    fieldCoverInfo:
      "A glyph and an image are one choice — the card draws only one of them. Uploading an image clears the glyph; going back to a glyph deletes the uploaded file.",
    coverUpload: "Upload cover",
    coverUploadHint: "Click the box to upload an image",
    fieldGlyph: "Glyph",
    coverUseGlyph: "Back to a glyph",
    coverExtensionError: (exts: string) => `A cover must be one of: ${exts}`,
    fieldPreview: "Preview (HTML)",
    fieldPreviewInfo:
      "Paste a self-contained HTML document: it renders in the detail modal's sandboxed iframe (scripts run, but the app's cookies and storage are out of reach). Saving with this empty removes an existing preview.",
    previewHint: (bytes: number, limit: number) => `${bytes} / ${limit} bytes`,
    previewKeepHint: "Saving with this empty removes the existing preview",
    previewTooLarge: "The preview exceeds the 1MB limit",
    fieldFeatured: "Show under Featured",
    fieldEnabled: "Enabled (a disabled case is visible to admins only)",
    fieldOrder: "Order",
    fieldOrderHint: "Position within its category; the lower number comes first",
    /** Admin: the category manager. */
    categoriesTitle: "Categories",
    categoriesDesc:
      "Categories are the library's tabs. The three that ship are written into a fresh library once and are yours from then on — rename, reorder or delete them like any other. The one thing that holds one in place is the cases filed under it.",
    categoriesEmpty: "No categories yet. Add one and the library gets its first tab.",
    categoryNew: "New category",
    categoryNameZh: "Name (Chinese)",
    categoryNameEn: "Name (English)",
    categoryId: "Id",
    categoryIdHint:
      "Lowercase letters, digits, dash or underscore; it is also the category's file name and cannot change after creation",
    categorySaved: "Category saved",
    categoryDeleted: "Category deleted",
    categoryDeleteTitle: "Delete category",
    categoryDeleteConfirm: (name: string) => `Delete the category "${name}"?`,
  },

  /** Plugin library page (features/plugins/plugins-page.tsx): one card per library plugin, installed on agents as a whole. */
  plugins: {
    pageTitle: "Plugins & Skills",

    // —— Origin and state (shared by plugins / skills / connectors) ——
    /** The three origin tabs plus All. Skills add a fourth; see filtersFor. */
    filterAll: "All",
    filterBuiltin: "Built-in",
    filterUser: "Installed by you",
    /** Skills only: shipped inside a plugin — removable only with the plugin, switchable alone. */
    filterBundled: "Bundled",
    originBuiltin: "Built-in",
    originUser: "Installed by you",
    originBundled: "Bundled",
    /** Why a bundled skill cannot be uninstalled on its own. */
    bundledSkillNote:
      "Bundled skill: can't be uninstalled on its own — it goes with its plugin, but can be switched on or off alone.",
    /**
     * Skills still installed under a name the library has since renamed. Shown as a banner with one
     * action rather than as a per-card fix, because the rename applies to every Agent at once —
     * offering it per card would suggest it only affects that one.
     */
    legacyTitle: (n: number): string => `${n} skill${n === 1 ? "" : "s"} can be renamed`,
    legacyBody: (name: string, to: string): string =>
      `“${name}” is now “${to}” in the library. Renaming puts it back with its plugin; the old directory is backed up first.`,
    legacyRenameAction: (to: string): string => `Rename to ${to}`,
    legacyRenameConfirmTitle: (name: string, to: string): string => `Rename ${name}`,
    legacyRenameConfirmBody: (name: string, to: string, agents: string): string =>
      `Rename “${name}” to “${to}”, affecting ${agents}. The old directory is backed up as a copy first, so this is reversible; the skill's contents are unchanged.`,
    legacyRenameDone: (from: string, to: string, agents: string): string =>
      `Renamed to ${to} (was ${from}) · ${agents}`,
    legacyRenamePartial: (from: string, to: string, skipped: string): string =>
      `${from} → ${to} done, but skipped on ${skipped} (the new name is already taken)`,
    legacyRenameFailed: (name: string): string => `Renaming ${name} failed`,
    /** Why a built-in cannot be uninstalled. */
    builtinSkillNote: "Built-in skill: can't be uninstalled.",
    enable: "Enable",
    disable: "Disable",
    enabled: "Enabled",
    disabled: "Disabled",
    enableHint: "Agents can use it once enabled",
    disableHint: "Agents will not be able to use it",

    // —— Affected-Agent confirmation ——
    /** Heading above the Agent list in the impact dialog. */
    affectedAgentsCount: (n: number): string =>
      `${n === 1 ? "1 agent is" : `${n} agents are`} using it:`,
    /** Overflow line — never left implicit, so a truncated list is never read as the whole one. */
    affectedAgentsMore: (n: number): string => `${n} more not listed.`,
    /** Why an Agent is affected: installed, versus actively selected (the urgent one). */
    agentReasonInstalled: "Installed",
    agentReasonSelected: "Selected",
    /** Shown when nothing depends on the item — the change is safe and the dialog says so. */
    noAffectedAgents: "No agent is using this — safe to proceed.",
    /** Empty state for a search that matched nothing. Distinct from "nothing installed". */
    noSearchResult: "No matches",
    noSearchResultDesc: "Try a different term, or switch the filter tab above.",
    /** Empty state for the origin filter the user selected. */
    noItemsInFilter: "Nothing in this category",

    // —— Category management ——
    categoryUncategorized: "Uncategorized",
    manageCategories: "Manage categories",
    /** Its tooltip on the plugins tab: what opening it actually does. */
    manageCategoriesHint: "Create, rename and delete the category tags plugins and skills share",
    addCategory: "New category",
    /** Per-skill filing select: follow the plugin's own category. */
    categoryInherit: "Follow plugin",
    /** Per-skill filing select: no category at all, which is not the same as following. */
    categoryNone: "Uncategorised",
    /** The three tabs of Add-plugin, by source. */
    addFromUrl: "Repository URL",
    addFromArchive: "Archive",
    addFromLocal: "On this machine",
    addFromUrlHint:
      "Paste a repository archive URL. The server downloads it, validates it and unpacks it into the local plugin directory. On GitHub the /archive/refs/heads/main.zip form works.",
    addFromUrlLabel: "Archive URL",
    addFromUrlBadScheme: "Only http and https URLs are supported.",
    addFromUrlAction: "Fetch and add",
    addFromArchiveHint:
      "Choose a plugin archive. The server checks for path traversal, size and manifest before unpacking anything into the local plugin directory.",
    addFromArchivePick: "Click to choose a .zip",
    addFromArchiveHint2: "Up to 64MB",
    addFromArchiveChange: "Click to change",
    addFromArchiveTooLarge: "The file is over 64MB.",
    addFromArchiveAction: "Import and add",
    addFromLocalHint:
      "Scan plugins already installed by other Agents on this machine and copy the ones you pick into the local plugin directory. You can also type a plugin directory's full path.",
    addFromLocalLabel: "Plugin directory",
    addFromLocalScan: "Scan",
    addFromLocalNone:
      "No plugins found. Type the full path to a plugin directory above and try again.",
    addFromLocalProbed: "Directories checked",
    pluginImported: "Plugin added",
    pluginApply: "Add",
    pluginReimport: "Replace",
    pluginAlreadyAdded: "Added",
    categoryNamePlaceholder: "Category name",
    categoryRename: "Rename",
    categoryDelete: "Delete",
    /** Confirm text for deleting a category; {n} = how many items will fall back to Uncategorized. */
    categoryDeleteConfirm: (n: number): string =>
      n === 0
        ? "Delete this category? This cannot be undone."
        : `Delete this category? Its ${n} item(s) will move to “Uncategorized”; the items themselves are not deleted.`,
    /** Built-in categories cannot be deleted; this explains why on the disabled button. */
    categoryBuiltinLocked: "Built-in categories can't be deleted",
    categoryRenamed: "Category renamed",
    categoryAdded: "Category created",
    categoryDeleted: "Category deleted",

    /** Add-whole-directory: import every plugin in the directory the user pointed at. */
    addWholeDir: "Add whole directory",
    addWholeDirHint:
      "Add every plugin in this directory to this machine. All of them start disabled — enable one before an agent can call it.",
    addedWholeDir: (n: number, names: string): string =>
      `Added ${n} plugin${n === 1 ? "" : "s"} to this machine: ${names} (disabled)`,
    addWholeDirPartial: (detail: string): string => `These plugins could not be added: ${detail}`,

    // —— Plugin card actions: install / delete / enable / disable / upgrade ——
    /** Machine-level uninstall: delete it from this machine's disk, and report who was using it. */
    /** Agent-level: put it in the current Agent and switch it on. */
    enableForAgent: "Enable",
    enableForAgentHint: "Install into the current agent and enable it, so the agent can call it",
    /** Agent-level: switch off for this agent only; the files stay on the machine. */
    disableForAgent: "Disable",
    disableForAgentHint:
      "The current agent stops calling it. The files stay on this machine, ready to re-enable.",
    /** Machine-level: delete from this machine entirely. */
    deleteFromMachine: "Uninstall",
    deleteFromMachineHint:
      "Delete from this machine. Agents it was installed in will lose the plugin.",
    /** The card's "more" menu, named after its subject — a menu needs a name of its own, not just an ellipsis glyph. */
    cardActions: (name: string): string => `Actions for ${name}`,
    /** Upgrade: return to where the plugin was installed from and fetch a newer version. */
    upgradeAction: "Upgrade",
    upgradeHint:
      "Check the original install source for a newer version, and download over this one if there is one",
    /** No recorded source — a plugin added from a folder has nothing to check against. */
    upgradeNoSource:
      "This plugin was added from a folder on this machine, so there is no source to check",
    /** Checked, and the installed version is already current. */
    upgradeUpToDate: "Already up to date",
    upgradeDone: (v: string): string => `Upgraded to ${v}`,
    /** The delete confirm: which Agents lose access. */
    deleteAffectsAgents: (names: string): string =>
      `These agents are using it and will lose it when it is deleted: ${names}`,
    deleteAffectsNone: "No agent is using it right now.",
    deleteConfirmTitle: (name: string): string => `Uninstall “${name}” from this machine?`,
    deleteConfirmBody: (name: string): string =>
      `“${name}” will be deleted from this machine's disk. This cannot be undone.`,
    deletedToast: (name: string): string => `Uninstalled ${name} from this machine`,

    pageDesc:
      "Built-in plugin library: each plugin ships skills and/or a hook package — browse, quick-start a chat, or install to agents.",
    /** Machine-level: off means no Agent can install it, and an Agent that already has it stops using it. */
    disableMachine: "Disable",
    disableMachineHint:
      "Disabled for this machine: no Agent can install it or use it, and an installed copy stops taking effect",
    enableMachine: "Enable",
    enableMachineHint: "Enabled for this machine: it can be installed to an agent and used there",
    /** Why the install button is disabled. */
    installNeedsMachineEnabled:
      "This plugin is disabled for this machine — enable it before installing to an agent",
    // —— 添加技能：三种来源 ——
    addSkillCategory: "Add to category",
    addSkillUrlHint:
      "Paste a repository address — the bare repo, one with .git, a /tree/main link, a deep link into a file: all of them resolve to the same branch. Added skills stay pending until mounted to an agent and enabled.",
    addSkillUrlInvalid: "Enter an address starting with http or https.",
    addSkillArchiveHint:
      "Pick a zip. Skills can be a directory holding SKILL.md, or sit under .agents/skills or .claude/skills. Added skills stay pending.",
    addSkillArchiveTooBig: "The archive exceeds the 20MB limit.",
    addSkillDirectoryHint:
      "Scan the skill directories of the agents on this machine, then add a whole group to the machine store. Skills already in the store are unticked by default — overwriting one has consequences, and ticking it is the moment you decide that.",
    addSkillNoneAdded: "No skills were added.",
    /**
     * Nothing was added, and the server gave a per-skill reason. Kept apart from
     * `addSkillNoneAdded`: that one is the fallback for "not even a reason came back", while this
     * one speaks the reasons the server already computed. With only the generic sentence the user
     * has nothing they can act on.
     */
    addSkillAllFailed: (reasons: string): string => `No skills were added: ${reasons}`,
    addSkillDone: (n: number, names: string): string =>
      `Added ${n} skill(s) to this machine (pending): ${names}`,
    scanAgents: "Scan this machine's agents",
    scanAgentsNone: "No agent with a skill directory was found.",
    scanAgentEmpty: "This agent has no skills installed",
    alreadyInLibrary: "already in the store",
    applyToLibrary: "Add to machine store",
    applyNeedsUnadded: "Tick at least one skill that is not in the store yet",
    upgradeSkill: "Upgrade",
    upgradeSkillNeedsSource:
      "This skill has no recorded source (archive, or copied by hand), so there is nowhere to check",
    upgradeSkillUpToDate: "Already up to date",
    upgradeSkillDone: (v: string): string => `Upgraded to ${v}`,
    upgradeSkillFailed: "The check failed; the installed version was kept",
    skillMountDisabled:
      "This skill is off for this machine — enable it before mounting it to an agent",
    pluginCount: (n: number): string => (n === 1 ? "1 plugin" : `${n} plugins`),
    /** Content badge for each hook point a plugin's hook package answers at (e.g. "stop hook"); also the chips on the settings Hooks tab. */
    hookBadge: (event: string): string => `${event} hook`,
    searchPlaceholder: "Search skills",
    /** Search box on the library page itself (accessible name). */
    searchLabel: "Search skills",
    /** The connectors tab's search box (the registry is a list of its own). */
    searchConnectorsPlaceholder: "Search connectors",
    searchConnectorsLabel: "Search connectors",
    /** The leading category chip: no filter. */
    allCategories: "All",
    /** Add-a-skill button in the header: opens the same source dialog the Agent's Skills tab uses. */
    addSkill: "Add skill",
    /** Plugin tab: opens the sources manager (adding a plugin means adding somewhere to get one). */
    addPlugin: "Add plugin",
    addPluginHint: "Add a plugin from a repository URL, an archive, or a folder on this machine",
    /** Connectors tab: opens the registry's own add dialog. */
    addConnector: "Add connector",
    addConnectorHint: "Add an MCP service",
    addSkillHint: "Add a skill by source: the Agent selected up top runs the install in chat",
    /** Why the button is disabled: the install prompt has to land on some Agent. */
    addSkillNeedsAgent: "Select an Agent above first — the install prompt needs someone to run it",
    /** Shown in place of the groups when a search matches nothing. */
    noMatch: (query: string): string => `No plugin matches “${query}”`,
    /** Section labels of the plugin detail Modal. */
    detailSkills: "Skills",
    /** 详情弹窗那两栏数据的标题。 */
    statVersion: "Version",
    statUsedBy: "Usage",
    /** 钥匙图标的说明：列出这个插件的技能各自还差哪些环境变量。 */
    needsEnv: (names: string[]): string => `Needs: ${names.join(", ")}`,
    /** API key section of the plugin detail Modal. */
    credentialsTitle: "API keys",
    credentialsSubtitle: "Stored in the selected agent's key vault, effective from its next task",
    /** Names the Agent the key lands in — it reaches that one agent and no other. */
    credentialsForAgent: (agent: string): string => `Saved to agent “${agent}”'s key vault`,
    /** No Agent selected: refuse rather than guess one and configure a credential nobody finds. */
    credentialsNeedsAgent:
      "Select an agent at the top first — the key is stored in that agent's vault",
    /** An already-configured key: plaintext is never sent back, so empty means "leave it alone". */
    credentialsAlreadySet: "Configured — leave empty to keep it",
    /** 已装在几个 Agent 上（总数在第二位，便于对照）。 */
    onAgents: (n: number, total: number): string =>
      total <= 1 ? "installed" : `${n} / ${total} agents`,
    /** 目录选项卡。 */
    tabCatalog: "Installed skills",
    catalogCount: (skills: number, agents: number): string => `${skills} skills · ${agents} agents`,
    /**
     * The installed-skills page title. It counts **skills**, not install units: a plugin and a
     * skill are different things, and folding both into one number is what made "19 skills against
     * 11 plugins — where did the other 8 go?" unanswerable.
     */
    installedTitle: (skills: number): string => `Installed (${skills})`,
    /** The connector tab's count badge, in the same slot and shape as the skills one. */
    connectorsCount: (n: number): string => `Connected (${n})`,
    /** Sub-label for the skills tab (the flat member view inside the library). */
    viewSkills: "Skills",
    /** A hook card's meta line: the hook points it answers at. */
    hookPoints: (points: readonly string[]): string => `Hooks: ${points.join(", ")}`,
    /** The full-screen page's search box. */
    searchInstalledPlaceholder: "Search installed skills",
    searchInstalledLabel: "Search installed skills",
    /** The full-screen page's batch-manage entry. */
    batchManage: "Batch manage",
    /** The full-screen page's back arrow. */
    back: "Back",
    /** The three group headings: which one a skill falls in is decided by how it was installed. */
    groupFromPlugins: "From plugins",
    groupStandalone: "Installed individually",
    groupImported: "Your own",
    groupPluginsCount: (n: number): string => `From plugins (${n})`,
    groupStandaloneCount: (n: number): string => `Installed individually (${n})`,
    groupImportedCount: (n: number): string => `Your own (${n})`,
    /** On a plugin card: how many Skills it brought. */
    pluginSkills: (n: number): string => `${n} ${n === 1 ? "skill" : "skills"}`,
    pluginHooks: (n: number): string => `${n} ${n === 1 ? "hook" : "hooks"}`,
    /** Shown when a plugin is only partly installed: present / total. */
    pluginPartial: (present: number, total: number): string => `${present} / ${total} skills`,
    /**
     * The "inferred" mark. A Skill installed before the provenance record existed cannot be told
     * apart on disk from one installed on its own, so the source is said to be deduced rather
     * than presented as a record.
     */
    inferredBadge: "inferred",
    inferredHint:
      "This origin was deduced, not recorded: it was installed before provenance tracking.",
    pluginUninstall: "Uninstall this plugin",
    pluginUninstallConfirm: (name: string, n: number): string =>
      `Uninstall ${name} from these Agents? Its ${n} skills are removed with it.`,
    catalogEmpty: "No skills installed yet",
    catalogEmptyHint:
      "Install one from the Skill library, or add your own. Everything an Agent can use shows up here.",
    detailHooks: "Hooks",
    usedByAgents: (n: number): string =>
      n === 0 ? "not used yet" : n === 1 ? "used by 1 agent" : `used by ${n} agents`,
    /**
     * 卡片底部那行的版本：`2026-08-04` 是日期，`.1` 是修订号，括号里是相对时间。
     * 三者放一起是因为分开成两行会让卡片底部高出同行卡片；`v2026-08-04.1` 那种写法看不出
     * 哪段是日期，正是要解决的问题。
     */
    versionLabel: (date: string, revision: number | null, relative: string): string =>
      revision === null || Number.isNaN(revision)
        ? `${date} (${relative})`
        : `${date}.${revision} (${relative})`,
    /** Title on a disabled quick-start button: it pre-selects one of the plugin's skills on the currently selected agent, so the plugin has to be installed there first. */
    quickInvokeNeedsInstall: "Install this plugin on the current agent first to quick-start",
    installedToast: (plugin: string, agent: string): string => `Installed ${plugin} to ${agent}`,
    uninstalledToast: (plugin: string, agent: string): string =>
      `Uninstalled ${plugin} from ${agent}`,
    /** Top toast after the plugin's on/off switch; the switch keeps the files either way. */
    enabledToast: (plugin: string): string => `Enabled ${plugin}`,
    disabledToast: (plugin: string): string => `Disabled ${plugin}`,
    updateOutdated: (n: number): string => `Update available: update ${n} agent install(s)`,
    /** Tooltip of the upgrade button when nothing is waiting (the button stays visible but disabled). */
    upToDate: "Already up to date",
    updateConfirmTitle: (name: string): string => `Update ${name}`,
    updateConfirmWarning: (name: string): string =>
      `Updating ${name} reinstalls the library copy over each agent's installed skill and hook files — any local edits are lost. Export a backup first if you need them.`,
    updatedToast: (plugin: string, n: number): string =>
      `Updated ${plugin} to the latest version (${n} agent(s))`,
    /** Uninstall confirmation: removing the installed copy deletes its files (local edits included). */
    uninstallConfirmTitle: (name: string): string => `Uninstall ${name}`,
    uninstallConfirmBody: (plugin: string, agent: string): string =>
      `Uninstall ${plugin} from ${agent}? Its installed skill and hook files (local edits included) will be deleted.`,
    /** The page's two tabs. "Skills" is the plugin library flattened to what actually lands on an agent. */
    tabSkills: "Skills",
    tabPlugins: "Plugins",
    tabConnectors: "Connectors",
    // No `connectorsDesc` / `connectorsEmpty` / `connectorsReadOnly`. See the Chinese note: all
    // three stated as prose what the tab's name and the surrounding chrome already said, and the
    // empty state is drawn by `SettingsEmpty`, which never used the string.
    connectorsSavedToast: "Saved — agents can now pick it in their tools settings",
  },

  /** Agent settings "Hooks" tab (features/agents/hooks-tab.tsx): the hook packages installed on one agent. */
  hooks: {
    agentTabDesc:
      "Hook packages installed on this agent (agent_state/hooks/) — scripts the harness runs at the loop's hook points, e.g. after every Task; uninstalling deletes the whole package directory.",
    agentTabEmpty: "No hook packages installed yet",
    /** The agents page's hook-count stat (hover title / accessible name). */
    hookCount: (n: number): string => (n === 1 ? "1 hook package" : `${n} hook packages`),
    uninstallConfirmTitle: (name: string): string => `Uninstall ${name}`,
    uninstallConfirmBody: (name: string, agent: string): string =>
      `Uninstall the ${name} hook package from ${agent}? All of its scripts (local edits included) will be deleted.`,
    uninstalledToast: (name: string, agent: string): string =>
      `Uninstalled the ${name} hook package from ${agent}`,
  },

  agentApi: {
    tabLabel: "API",
    tabDesc:
      "Let programs outside the Web App call this Agent: create a key, and the program presents it. Turning the switch off takes effect immediately — the keys stay valid.",
    enable: "Enable the Agent API",
    enableHint:
      "While off, every outside request gets a 404 straight away. Keys are kept, so switching back on restores access with the same keys.",
    /** Shown when the admin has turned the whole feature off server-side; the switch cannot work. */
    serverOff:
      "An administrator has turned the Agent API off for this whole server. This Agent's switch will not admit requests either.",
    open: "Allow keyless access",
    openHint:
      "With this on, a request without a key can call the Agent too. Suitable for a fully trusted local machine — anything that can reach this server could use it.",
    approvalMode: "Approval mode",
    approvalHint: "The mode sessions created through the API start under.",
    approvalAllowAll: "Allow all",
    approvalDenyAll: "Deny all",
    approvalReadOnly: "Read only",
    approvalAlwaysAsk: "Ask each time",
    model: "Model",
    modelHint: "Empty follows the Project's default model.",
    modelProjectDefault: "Follow the Project default",
    thinkingLevel: "Thinking level",
    thinkingDefault: "Default",
    workspace: "Workspace",
    workspaceHint:
      "Empty creates a temporary Workspace per run. A value must be a directory that already exists.",
    workspacePlaceholder: "Empty = a new temporary Workspace per run",
    maxConcurrentRuns: "Concurrent runs",
    maxConcurrentHint:
      "How many requests this Agent runs at once. Beyond that, new requests get a 429 with Retry-After. Counted per Agent, not per key.",
    saved: "Saved",
    keysTitle: "Keys",
    keysEmpty: "No keys yet",
    keysDesc:
      "A key is shown once, at creation, and cannot be read again. If it is lost, create another.",
    keyName: "Key name",
    keyNamePlaceholder: "For example: local script",
    createKey: "Create key",
    keyCreated: "Key created",
    /** The one-time reveal: the secret, plus the explicit warning that it will not be shown again. */
    keySecretLabel: "Key (shown only this once)",
    keySecretWarning: "Once you close this dialog the key cannot be shown again. Copy it now.",
    keyCopied: "Copied to the clipboard",
    keyLastUsed: (when: string): string => `Last used: ${when}`,
    keyNeverUsed: "Never used",
    keyCreatedAt: (when: string): string => `Created ${when}`,
    deleteKey: "Delete key",
    deleteKeyConfirmTitle: (name: string): string => `Delete the key ${name}`,
    deleteKeyConfirmBody: (name: string): string =>
      `Requests presenting this key will be refused (401) immediately afterwards. This cannot be undone.`,
    keyDeleted: (name: string): string => `Deleted the key ${name}`,
    humanRequired:
      "This needs the signed-in person. An Agent's own local token cannot change how that Agent is exposed.",
    notExposedYet:
      "This Agent is not exposed and has no keys. Turn on the switch above to create one.",
  },

  skills: {
    quickInvoke: "Quick start",
    // No quickInvokeText: it used to pre-fill "use the <name> skill" into the composer body
    // alongside the skill pill, saying the same thing twice in two shapes. The pill is the whole
    // message — the user can remove it before sending, which a sentence in the body cannot be.
    selectAll: "Select all",
    selectNone: "Select none",
    selectedCount: (n: number): string => `${n} selected`,
    manageInstall: "Manage installs",
    manageInstallTitle: (name: string): string => `Manage installs: ${name}`,
    install: "Install",
    installed: "Installed",
    uninstall: "Uninstall",
    skillCount: (n: number): string => (n === 1 ? "1 skill" : `${n} skills`),
    /** The plugin library's per-agent update button, and the confirm buttons of every update dialog. */
    updateAction: "Update",
    /** Settings Skills tab: toast after uninstalling one skill. */
    uninstalledToast: (skill: string, agent: string): string =>
      `Uninstalled ${skill} from ${agent}`,
    /** A Skill's 管理安装, after mounting it onto an Agent. */
    mountedToast: (skill: string, agent: string): string => `Mounted ${skill} to ${agent}`,
    /** A Skill's 管理安装, after unmounting it from one Agent. */
    unmountedToast: (skill: string, agent: string): string => `Unmounted ${skill} from ${agent}`,
    /** Uninstall confirmation: removing the installed copy deletes its files (local edits included). */
    uninstallConfirmTitle: (name: string): string => `Uninstall ${name}`,
    uninstallConfirmBody: (skill: string, agent: string): string =>
      `Uninstall ${skill} from ${agent}? Its installed files (local edits included) will be deleted.`,
    /** Agent settings "Skills" tab (installed list + import modal). */
    agentTabDesc:
      "Skills installed on this agent (agent_state/skills/ — the files are the source of truth): metadata is injected into the system prompt and the body is read by the model on demand; uninstalling deletes the whole skill directory.",
    agentTabEmpty: "No skills installed yet",
    exportSkill: "Export",
    importSkill: "Import skill",
    /** Library picker on the Agent's Skills tab: install one of the Project's library skills. */
    pickFromLibrary: "Pick from library",
    pickFromLibraryDesc:
      "Skills install with their plugin: picking one installs its plugin on this Agent and makes that skill the default.",
    pickFromLibraryTitle: "Pick a skill from the library",
    pickFromLibraryEmpty: "The library has no installable skill yet",
    pickComesWithPlugin: (plugin: string): string => `from plugin ${plugin}`,
    pickAdd: "Add",
    pickAlready: "Added",
    alreadyInstalled: "Installed",
    importChatTitle: "Recommended: install by chatting with the agent",
    importChatWhy:
      "The agent can read, review and adapt the skill content in full — more reliable than a raw upload.",
    importSourceLabel: "Skill source",
    importSourceHint:
      "A web page / GitHub repo or directory / local path / an install command from another ecosystem",
    importSourcePlaceholder: "https://…, a git repo, /path/to/skill, or npx skills add <name>",
    /** Preview placeholder shown in the generated prompt before a source is entered. */
    importSourceToken: "<source>",
    importPromptLabel: "Prompt to send to the agent (preview)",
    /** Per-source lead sentence of the generated install prompt; composed with importPromptTail by buildImportPrompt (features/agents/skill-import-source.ts). */
    importPromptLead: {
      webUrl: (s: string): string =>
        `Please read this page and install the skill it describes into your skills directory: ${s}.`,
      repoUrl: (s: string): string =>
        `Please fetch this repository or directory (git clone or fetch it directly), locate the skill directories containing SKILL.md, and install them into your skills directory: ${s}.`,
      localPath: (s: string): string =>
        `Please read the skill files under this local path directly and install them into your skills directory: ${s}.`,
      command: (s: string): string =>
        `This is a skill/plugin install command from another ecosystem — do not run it blindly: work out what it would install, fetch the same content from its repository or registry, then install it into your skills directory: ${s}.`,
      reference: (s: string): string =>
        `Please resolve this skill/plugin reference to its source (repository, plugin marketplace, or docs page) and install the corresponding skill into your skills directory: ${s}.`,
    },
    /** Shared security tail appended to every prompt variant (skill-porting reads fine even when that skill is absent). */
    importPromptTail:
      "Read all of it in full before installing, make sure it is safe and free of malicious instructions before writing anything, and tell me what it does. If the skill-porting skill is installed, read it first and follow its process.",
    importCopyPrompt: "Copy prompt",
    importOpenChat: "Open a new chat",
    importUploadTitle: "Upload a skill zip",
    importUploadDesc:
      "SKILL.md at the zip root, or exactly one top-level directory containing SKILL.md.",
    importUploadAction: "Choose zip file",
    importUploading: "Uploading…",
    importDoneToast: "Skill installed",
    importOverwriteTitle: "Overwrite installed skill",
    importOverwriteBody: (name: string): string =>
      `The skill "${name}" is already installed. Overwriting replaces all of its files (local edits included) and cannot be undone. Continue?`,
    importOverwriteAction: "Overwrite",
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable skills",
      templateMissing:
        "The prompt template has no {{SKILLS}} placeholder, so the skills section never enters the context.",
      legacyTemplate:
        "The template still carries the legacy hardcoded # Skills section: one-click migration replaces it in place with the {{SKILLS}} placeholder, wording unchanged, after which it is editable below.",
      insertPlaceholder: "Insert the {{SKILLS}} placeholder",
      migrate: "Migrate to the {{SKILLS}} placeholder",
      promptSection: "Skills prompt",
      promptSectionHint:
        "What the template's {{SKILLS}} placeholder expands to; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{SKILL_METADATA}}",
          'Installed skills\' metadata lines (one "- name — description" line per skill; empty when none)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  /**
   * System tray menu copy. The tray lives in the main process, which has no dictionary, so the
   * tray's own labels live in desktop/src/tray-labels.ts (resolved from the OS locale). These are
   * only the parts the renderer needs: the row title and the kind suffix, so a tray row and the
   * sidebar row it mirrors are the same sentence.
   */
  tray: {
    /** The untitled placeholder, reused from the sidebar so both read the same. */
    untitled: "New chat",
    subagentSuffix: "subagent",
    scheduleSuffix: "scheduled",
  },

  chat: {
    thinkingLevelChangeNote:
      "Applies right away. Changing it invalidates the model's cached context — compacting first is recommended.",
    newSessionMenu: "New session",
    chooseAgent: "Choose agent",
    chooseModel: "Choose model",
    thinkingLevel: "Thinking level",
    /** Tier names for the thinking-level controls: the wire value itself, so the label names the value actually sent (per maintainer request). `none` exists purely to display a stored legacy value — it is never offered as a choice (many models cannot disable thinking). */
    thinkingLevelNames: {
      none: "none",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    /** English has no trigger/menu split to make: the name above already IS the wire value, so a menu row annotating it would only repeat itself. Taking just the name (the second parameter is dropped) is how this locale says "same text on every surface". */
    thinkingLevelMenuName: (name: string): string => name,
    thinkingSwitchTitle: "Switch thinking level",
    thinkingSwitchBody: (to: string): string =>
      `Switch the thinking level to "${to}"? Switching mid-conversation lowers the prompt-cache hit rate and raises cost; compacting the context first is cheaper.`,
    thinkingSwitchBusyHint: "This conversation is still working — compaction has to wait for it.",
    thinkingSwitchCompactFirst: "Compact, then switch",
    thinkingSwitchConfirm: "Switch anyway",
    thinkingSwitchCompacting: "Compacting the context — the thinking level switches when it ends.",
    thinkingSwitchApplied: (to: string): string =>
      `Context compacted; thinking level switched to "${to}".`,
    thinkingSwitchCompactFailed:
      "The compaction did not finish; the thinking level was switched anyway.",
    workspaceUseThis: "Use this dir",
    workspaceUp: "Parent dir",
    workspaceNoSubdirs: "No subdirectories",
    workspaceAuto: "Temporary workspace",
    workspaceClear: "Use a temporary workspace instead",
    /**
     * The menu's newer parts: the search field, the recently-used list, and the desktop
     * shell's native folder chooser. The size of the recent list is decided in
     * `workspace-select.tsx` — mentioned here so the reason is traceable.
     */
    workspaceSearch: "Search workspaces",
    workspaceSearchEmpty: "No matching workspaces",
    workspaceRecent: "Recently used",
    workspaceOpenLocal: "Open local folder",
    workspaceOpenLocalHint: "Choose a folder on this computer as the workspace",
    workspaceDirInvalid: "Directory does not exist or is inaccessible; reverted",
    /** Sidebar conversation-list grouping toggle (workspace is the default) + workspace groups. */
    groupByWorkspace: "Group by workspace",
    groupByAgent: "Group by agent",
    groupByTime: "Group by time",
    /** Time-mode bucket names (last day / last month / older), by last activity. */
    timeGroups: {
      day: "Past day",
      month: "Past month",
      earlier: "Earlier",
    },
    /** Session-list section header controls: search / list settings / mode-dependent create (the created object follows the grouping mode). */
    searchSessions: "Search chats",
    searchSessionsPlaceholder: "Search chats…",
    searchClear: "Clear search",
    /** Zero hits: the filter only sees already-loaded conversations, so the copy says so rather than claiming none exist. */
    searchNoMatches: "No matches among loaded chats",
    listSettings: "List options",
    groupModeSection: "Group by",
    sortModeSection: "Sort by",
    sortManual: "Manual order",
    sortRecent: "Most recent",
    newWorkspaceEntity: "New workspace",
    /** Registry-backed workspace group's overflow (… right of the header "+"): alias rename + sidebar-only removal. */
    workspaceMenu: "Workspace options",
    renameWorkspace: "Rename workspace",
    renameWorkspaceLabel: "Name",
    renameWorkspaceHint: "Leave empty to use the folder name",
    deleteWorkspace: "Remove workspace",
    deleteWorkspaceConfirm: (name: string) =>
      `Remove "${name}"? This only removes the workspace group from the sidebar — the directory on disk and existing chats are untouched, and it can be re-added anytime.`,
    tempWorkspaces: "Temporary workspaces",
    newSessionInWorkspace: "New chat in this workspace",
    draftSubtitle: "The teammate who knows your rhythm and works in step with you.",
    /** The draft screen's picker's last tab: prompts the user saved themselves (see user-shortcuts.ts). */
    shortcuts: {
      folder: "My shortcuts",
      /** 药丸行上的短标签，比 folder 短：那一行窄，「我的」两个字省下来给药丸。 */
      pills: "Shortcuts",
      /** 行尾齿轮的提示：进入管理态，每个药丸上出现编辑/删除。 */
      manage: "Manage shortcuts",
      /** 收起药丸行 / 展开药丸行的箭头上的提示文字。 */
      collapse: "Collapse shortcuts",
      expand: "Expand shortcuts",
      new: "New shortcut",
      newFromComposer: "Starts from whatever is in the composer",
      createTitle: "New shortcut",
      editTitle: "Edit shortcut",
      titleLabel: "Name",
      titleHint: (max: number) => `At most ${max} characters`,
      promptLabel: "Prompt",
      promptHint: (max: number) => `At most ${max} characters`,
      promptInfo:
        "Clicking this shortcut puts the text into the composer verbatim and sends nothing; Skills stay a separate pick in the composer.",
      titleTooLong: (max: number) => `The name may be at most ${max} characters`,
      promptTooLong: (max: number) => `The prompt may be at most ${max} characters`,
      deleteTitle: "Delete shortcut",
      deleteConfirm: (title: string) =>
        `Delete "${title}"? The shortcut disappears from every device you use.`,
    },
    /**
     * The /app-center page: the same examples the draft screen shows, but the whole catalog
     * at once so a returning user can browse by category instead of opening one folder at a
     * time. Sharing the same data shape as the draft tabs means a click here is the same fill
     * the draft folder does — a parked draft conversation is created and the chat opens on
     * the new-chat route with the canned prompt pre-filled.
     */
    sessionList: "Sessions",
    defaultSessionTitle: "New chat",
    agent: "Agent",
    model: "Model",
    workspace: "Workspace",
    workspaceHint:
      "Leave empty for an auto-created temporary workspace; if set, it must be an existing directory on the server",
    /** The same rule as `workspaceHint`, short enough to sit under a form field. */
    workspaceHintShort: "Leave empty for a temporary workspace",
    approvalMode: "Approval mode",
    approvalModeNames: {
      "allow-all": "Approve everything",
      "deny-all": "Deny everything",
      "read-only": "Approve read-only",
      "always-ask": "Ask every time",
    } as Record<string, string>,
    approvalModes: {
      "allow-all": "Approve everything (allow-all)",
      "deny-all": "Deny everything (deny-all)",
      "read-only": "Approve read-only (read-only)",
      "always-ask": "Ask every time (always-ask)",
    } as Record<string, string>,
    statusRunning: "Running",
    statusCompacting: "Compacting",
    /** Settled Session that finished since the user last opened it (the unread dot; a Session already read shows no glyph, so it needs no label). */
    statusCompletedUnread: "Done, unread",
    pendingApprovals: (n: number) => `${n} pending approval${n > 1 ? "s" : ""}`,
    jumpToLatest: "Jump to latest",
    /** Top-of-stream affordance while the previous history window is being fetched (scroll-up backfill). */
    loadingEarlier: "Loading earlier messages…",
    /** Top-of-stream affordance after a backfill failure: click to retry fetching the previous window. */
    loadEarlierRetry: "Failed to load earlier messages — click to retry",
    /** Top-of-stream marker once the loaded history reaches the very beginning (shown only after a backfill happened). */
    historyBeginning: "Beginning of conversation",
    /** Conversation minimap (tick rail over the stream's left gutter): rail aria-label. */
    outlineTitle: "Outline",
    /** Tick accessible name: turn number + the question (or the no-text placeholder). */
    outlineTickLabel: (n: number, question: string) => `Turn ${n}: ${question}`,
    /** Entry label when the prompt had no text body (image / attachment-only message). */
    outlineNoText: "(image or attachment)",
    /** Answer-preview placeholder while the latest turn is still running with no reply text yet. */
    outlineAnswering: "Answering…",
    inputPlaceholder: "Type a message. Enter to send, Shift+Enter for newline, paste images",
    inputPlaceholderShort: "Type a message…",
    /** Placeholder while a Task is running (mid-run steering): the message is delivered between turns with the next request. */
    steerPlaceholder: "Message the running agent — delivered with the next turn",
    steerPlaceholderShort: "Message the running agent…",
    steerSend: "Send to the running agent",
    /** Queued hint shown after a successful steer, until the steering message appears in the stream. */
    steerQueuedIndicator: "Steering queued — delivered with the next turn",
    /** Same hint, with the queued message's content (from the server's undelivered-steering mirror; survives reloads). */
    steerQueuedItem: (content: string) =>
      `Steering queued — delivered with the next turn: ${content}`,
    /** Label of the [user_steering] chip (a mid-run user message delivered between turns). */
    userSteering: "User steering",
    /** Mid-run send-mode setting: steer (delivered mid-run) vs follow-up (queued until the run ends). */
    steerModeLabel: "Mid-run send mode",
    steerModeSteer: "Steer",
    steerModeSteerHint: "Steer now: delivered to the running agent with the next turn",
    steerModeFollowUp: "Queue",
    steerModeFollowUpHint:
      "Queue a follow-up: sent automatically as a new message when this run finishes",
    followUpPlaceholder: "Queue as the next message — sent automatically when this run finishes",
    followUpPlaceholderShort: "Queue as the next message…",
    followUpSend: "Queue as the next message",
    /** Server-side queued follow-up count (auto-sent once the current run finishes). */
    followUpQueuedChip: (n: number) =>
      `${n} follow-up ${n === 1 ? "message" : "messages"} queued — sent when this run finishes`,
    /** One queued follow-up's hint line, with its content (per-entry variant of followUpQueuedChip). */
    followUpQueuedItem: (content: string) =>
      `Follow-up queued — sent when this run finishes: ${content}`,
    /** Accessible name of the recall control on a queued steering / follow-up line — it is icon-only (a curved-back arrow), so this is what names it for screen readers (#287). */
    recallQueued: "Recall",
    /** Its tooltip: what the icon does, spelled out. */
    recallQueuedTitle: "Recall to the input box to edit and resend",
    send: "Send",
    stop: "Stop",
    /** 麦克风按钮的提示：图标按参考图加了，但还没有语音识别后端。 */
    voiceNotAvailable: "Voice input is not available yet",
    compact: "Compact context",
    approve: "Allow",
    deny: "Deny",
    decisionAllow: "Approved",
    decisionDeny: "Denied",
    decisionManual: "manual",
    decisionAuto: "auto",
    decisionPolicy: "policy",
    thinking: "Thinking",
    subagent: "Subagent",
    subagentRunning: "Running",
    /**
     * Abort banner (user interruptions only). The cause localizes from `errorCode`;
     * `errorMessage` (raw, untranslatable) rides verbatim. A legacy Trace without a code
     * renders its English `reason` prose as-is.
     */
    aborted: (item?: { errorCode?: string; errorMessage?: string; reason?: string }) => {
      const cause =
        item?.errorCode === "user_abort"
          ? "aborted by user"
          : item?.errorCode === "backoff_interrupted"
            ? "aborted during reconnect backoff"
            : item?.errorCode === "compaction_interrupted"
              ? "aborted during compaction"
              : (item?.errorCode ?? item?.reason ?? "");
      const text = cause ? `${cause}${item?.errorMessage ? `: ${item.errorMessage}` : ""}` : "";
      return `[Aborted]${text ? `: ${text}` : ""}`;
    },
    /**
     * Reconnect hint line; `secondsLeft` (waiting state only) switches to the live-countdown
     * wording. `retryable` is the live status; the finer spellings only appear when
     * replaying Traces written before the stop-reason convergence.
     */
    reconnect: (
      status: "retryable" | "failed" | "timeout" | "malformed",
      state: "waiting" | "retried" | "gaveUp",
      attempt: number,
      secondsLeft?: number,
      errorMessage?: string,
      errorCode?: string,
    ) => {
      // The live protocol carries the classified cause on error_code; the legacy status
      // spellings (failed/timeout/malformed) say the same thing for pre-convergence Traces.
      const kind = errorCode ?? status;
      const cause =
        kind === "timeout"
          ? "Connection timed out"
          : kind === "malformed"
            ? "Response incomplete or unparseable"
            : kind === "network"
              ? "Network or service temporarily unavailable"
              : kind === "failed"
                ? "The model provider returned an error"
                : "The request failed";
      const action =
        state === "gaveUp"
          ? `giving up after attempt ${attempt}${errorMessage ? `: ${errorMessage}` : ""}`
          : state === "retried"
            ? `retry #${attempt} sent`
            : secondsLeft !== undefined
              ? `retry #${attempt} in ${secondsLeft}s…`
              : `starting retry #${attempt}…`;
      return `[Retry] ${cause}; ${action}`;
    },
    /** Run-ending LLM failure banner (request_end status fatal); the provider's error text rides verbatim. */
    llmError: (errorMessage?: string) =>
      `[Error]: llm request error${errorMessage ? `: ${errorMessage}` : ""}`,
    /** "Retry now" on the reconnect countdown (skips the remaining backoff wait). */
    reconnectRetryNow: "Retry now",
    /** "Give up" on the reconnect countdown (the ordinary session abort). */
    reconnectGiveUp: "Give up",
    imageAlt: "Image uploaded by user",
    toolImageAlt: "Image from tool output",
    imagesAsPathHint:
      "This model cannot view images directly: on send, images are saved to the session scratchpad and passed as file paths (viewed via describe_image)",
    infoPanel: "Session info",
    sessionStats: "Stats",
    /** Info-dropdown Session id row: the id itself is a click-to-copy button. */
    sessionIdLabel: "Session id",
    copySessionId: "Copy Session id",
    /** Info-dropdown list of background processes the conversation started, and its per-row actions (Stop on running rows, Remove on exited ones). */
    processList: "Processes",
    processStop: "Stop",
    processExited: "exited",
    processRemove: "Remove",
    /** Remove button tooltip: removal also drops the output captured from that process. */
    processRemoveHint: "Remove this entry — the output captured from it is discarded too",
    /** Header chip title: count of the conversation's still-running background processes. */
    runningServices: (n: number) => (n === 1 ? "1 running service" : `${n} running services`),
    statTokens: "Total Tokens",
    /** Info-dropdown stats list: the tokens bullet's label and its cache-hit-rate parenthetical (rate = cacheRead ÷ all input, e.g. "68%"). */
    statTotalTokens: "Total Tokens",
    statCacheHit: (pct: string) => `cache hit rate ${pct}`,
    statElapsed: "Elapsed",
    statInput: "Input tokens",
    statCached: "cached",
    statOutput: "Output tokens",
    statTps: "Output TPS",
    /** Copied-stats-line parenthesis wrappers around the cached amount (ASCII with a leading space for en). */
    statParenOpen: " (",
    statParenClose: ")",
    noSessions: "No Sessions yet",
    emptyStream: "Send a message to start the conversation",
    historyLoadFailed: "Failed to load history",
    statsLabel: "Stats",
    removeImage: "Remove image",
    openAgents: "Agents panel",
    /** Panel switcher (chat toolbar top-right): the "create" dropdown and its pin toggles. */
    workspacePanel: "Workspace",
    filesInMessage: (n: number) => `${n} ${n === 1 ? "file" : "files"}`,
    imagesInMessage: (n: number) => `${n} ${n === 1 ? "image" : "images"}`,
    openPreview: "Click to preview",
    showMoreFiles: (n: number) => `Show ${n} more ${n === 1 ? "file" : "files"}`,
    showLess: "Show less",
    memoryChangesTitle: (n: number) => `${n} memory ${n === 1 ? "update" : "updates"}`,
    memoryScopeWorkspace: (key: string) => `Workspace memory (${key})`,
    memoryOpWrite: "Wrote",
    memoryOpEdit: "Edited",
    memoryViewTitle: "Memory",
    memoryChangedMark: "Changed in this conversation",
    memoryContentUnavailable: "Content unavailable (the file may have been moved or deleted)",
    memoryRowOpen: "View content",
    memoryBack: "Back to the list",
    memoryEmptyAll: "No memory yet — say “remember …” in a chat to have the agent save one",
    /** Visible label on the Memory panel's header link (not a tooltip-only glyph): says what the click does and where it lands. */
    openAgentMemory: "Manage in agent settings",
    memoryShowMore: (n: number) => `Show ${n} more`,
    /** Sidebar group pagination (#139): the pager's step buttons and the "2/5" readout's accessible name. */
    prevGroupPage: "Previous groups",
    nextGroupPage: "Next groups",
    groupPagePosition: (page: number, total: number) => `Page ${page} of ${total}`,
    contextUsage: "Context usage",
    contextUnknown: "Context usage: unknown until the next request reports it",
    contextComposition: "Context composition",
    contextPartSystemPrompt: "System prompt",
    contextPartToolDefs: "Tool definitions",
    contextPartUserMessages: "User messages",
    contextPartAssistantMessages: "Model messages",
    contextPartToolRequests: "Tool requests",
    contextPartToolResults: "Tool results",
    contextTopTools: "Top 5 tools",
    contextCompactAt: (n: string): string => `Compaction threshold ${n}`,
    contextTopToolsHint:
      "Ranked by the context each tool's calls and results occupy (definitions count under “Tool definitions”)",
    contextUnknownHint:
      "Just compacted — the next request reports the usage, and the composition with it",
    contextBreakdownEmpty: "Nothing in the current context to break down yet",
    contextBreakdownFailed: "Could not read the context composition",
    slashHint: "Type / for commands",
    switchAgent: "Hand off to another agent — opens a new session on send",
    switchAgentTitle: "Choose agent",
    agentSearchPlaceholder: "Search agents: id / name",
    agentsNoMatch: "No matching agents",
    handoffTargetTitle: (agent: string) => `Sending hands this conversation to ${agent}`,
    handoffRemove: "Remove handoff target",
    skillsSelect: "Skills",
    skillRemove: "Remove skill",
    skillsSearchPlaceholder: "Search skills",
    skillsNoMatch: "No matching skills",
    skillsEmptyHint: "No skills installed yet — add some from the skill library",
    skillsAutoMessage: (names: string[]): string =>
      names.length === 1 ? `use the ${names[0]} skill` : `use the ${names.join(", ")} skills`,
    handoffFrom: (agent: string) => `Handed off from ${agent}'s conversation`,
    handoffBack: (title?: string) =>
      title ? `Back to the original conversation: ${title}` : "Back to the original conversation",
    switchModel: "Switch model — on send, continues this conversation in a new session",
    switchModelTitle: "Switch model",
    modelSwitchTargetTitle: (model: string) => `Sending continues this conversation on ${model}`,
    modelSwitchRemove: "Remove model switch",
    modelSwitchBusyHint:
      "The model switch waits for this turn to finish: the new session continues from this session's record",
    modelSwitchFrom: (prevModel?: string) =>
      prevModel
        ? `Switched model (was ${prevModel}) — continued from the earlier conversation`
        : "Switched model — continued from the earlier conversation",
    modelSwitchAutoMessage: "Continue this conversation on the new model",
    /** Toast when the session-state (locked) model display is clicked: points at the `/model` command. */
    modelLockedHint: "Type /model to switch models",
    scheduledFrom: (name: string) => `Triggered by scheduled task "${name}"`,
    /** One-line notice of a `[background_task_done]` harness message (run_in_background completion): the collapsed row's whole label. */
    backgroundDone: (kind: "command" | "subagent", status: "completed" | "failed" | "stopped") => {
      const what = kind === "command" ? "Background command" : "Background task";
      if (status === "stopped") return `${what} stopped`;
      return status === "completed" ? `${what} finished` : `${what} failed`;
    },
    emptyGreeting: "Start a new conversation",
    /** Unified step-row titles (same header idiom as workRunning/workDone). */
    mcpConnectTitle: "MCP connect",
    mcpServerList: (servers: string[]): string => servers.join(", "),
    /** One-line result detail: tool count, plus the NAMES of failed servers (reasons live in the expanded server groups). */
    mcpConnectResult: (toolCount: number, failed: string[]): string => {
      const parts: string[] = [];
      if (toolCount > 0 || failed.length === 0) {
        parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"} discovered`);
      }
      if (failed.length > 0) parts.push(`unavailable: ${failed.join(", ")}`);
      return parts.join("; ");
    },
    /** Per-server group row meta inside the expanded connect row. */
    mcpToolsCount: (n: number): string => `${n} tool${n === 1 ? "" : "s"}`,
    mcpServerFailed: "connection failed",
    mcpConnectAborted: "interrupted — reconnects on the next send",
    compactionTitle: (mode: string): string => (mode === "discard" ? "Clear" : "Compaction"),
    compactionFailed: (status: string, errorMessage?: string): string => {
      if (status === "aborted") return "aborted, keeping current context";
      const detail = errorMessage !== undefined ? ` (${errorMessage})` : "";
      // retryable = abandoned this time, the standing trigger retries it; fatal = a config
      // or credential change has to come first. Legacy Traces spell both "failed".
      if (status === "retryable") {
        return `failed${detail}, keeping current context; retries at the next trigger`;
      }
      if (status === "fatal") {
        return `failed${detail}, keeping current context; fix the model configuration to retry`;
      }
      return `failed${detail}, keeping current context`;
    },
    unknownTool: "(unknown tool)",
    workRunning: "Running",
    workDone: "Done",
    workGroupSteps: (n: number) => `${n} ${n === 1 ? "step" : "steps"}`,
    approvalWaiting: "awaiting approval",
    copyCode: "Copy code",
    copyReply: "Copy reply",
    forkSession: "Fork chat from here",
    forkSessionConfirmBody:
      "This copies the conversation up to this reply into a new chat. The original chat stays unchanged.",
    forkSessionConfirmAction: "Fork",
    forkSessionFailed: "This reply could not be located. Refresh and try again.",
    copyMessage: "Copy message",
    deleteSession: "Delete chat",
    renameSession: "Rename chat",
    renameSessionLabel: "Title",
    deleteSessionConfirm: (title: string) =>
      `Delete "${title}"? Its messages and Trace will be removed permanently.`,
    /** Parked draft conversations (unsent new chats living in the sidebar list — see draft-sessions.ts). */
    draftGroup: "Drafts",
    draftUntitled: "(untitled draft)",
    deleteDraft: "Delete draft",
    deleteDraftConfirm: (title: string) =>
      `Delete draft "${title}"? Unsent content will be discarded.`,
    archiveSession: "Archive",
    unarchiveSession: "Unarchive",
    /** Per-row ellipsis overflow menu (pin / rename / archive / delete live inside it) and the row-level pin. */
    pinSession: "Pin",
    unpinSession: "Unpin",
    pinnedSession: "Pinned",
    /** The hover ellipsis button that opens the row's full context menu. */
    moreActions: "More",
    /** Sidebar group "reveal/load next page" row (display cap + server paging). */
    loadMore: "More",
    /** Per-group reveal row: n = conversations THIS group still hides (one click reveals/loads one page more). */
    expandRestSessions: (n: number) => `Show ${n} more ${n === 1 ? "chat" : "chats"}`,
    /** Time mode's whole-list paging row: its buckets span every Agent, so one row below them fetches the next page rather than each bucket claiming to. */
    loadMoreSessions: "Load more chats",
    /** Collapsed sidebar folders inside a group (lazy-loaded); the count is the group's exact server share. */
    folderGroups: {
      subagent: (n: number) => `Subagents (${n})`,
      schedule: (n: number) => `Scheduled (${n})`,
      archived: (n: number) => `Archived (${n})`,
    },
    skillsBanner: (names: string[]): string =>
      `Using skill${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    attachedFilesBanner: (names: string[]): string =>
      `Attached file${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    /** Composer "+" extension menu (image upload, file attachment, goal mode) and the goal chip. */
    plusMenu: "More input options",
    uploadImage: "Upload image",
    uploadImageDesc: "Attach images to this message",
    uploadFile: "Upload file",
    uploadFileDesc: "Saved to the session scratchpad; the model reads them by path",
    removeFile: "Remove file",
    attachmentTooLarge: (name: string, limitMb: number): string =>
      `${name} exceeds the ${limitMb}MB limit and was not attached.`,
    /** Overlay covering the chat area while files are dragged over it (drag-and-drop upload). */
    dropFilesTitle: "Drop files to attach",
    dropFilesDesc: "Images and files are added to the message draft",
    /** Toast when non-image files are dropped in goal mode (the objective carries images only). */
    dropFilesGoalHint: "Goal mode takes images only; the files were not attached.",
    goalMode: "Goal mode",
    goalModeDesc: "Loop until the goal completes",
    goalBudgetLabel: "Token budget",
    goalBudgetUnlimited: "Budget unlimited",
    goalBudgetValue: (value: string): string => `Budget ${value}`,
    goalBudgetPlaceholder: "e.g. 500k",
    goalBudgetHint: "Use a k/m suffix; leave blank for no budget limit",
    goalBudgetInvalid:
      "Invalid budget: use a positive number with an optional k/m suffix (500k, 2m)",
    goalBudgetSave: "Save budget",
    goalRemove: "Exit goal mode",
    /** Label of the collapsed card a harness-injected user message renders as (a stop hook's continue, a goal round's protocol, a user_prompt hook's expansion). */
    harnessInjected: "Injected by the harness",
    /**
     * The rewrite button. Mirrors the zh block key for key: the labels promise exactly what it
     * does — rewrite, never send — and the hint says the result can still be edited before it
     * goes. `enhanceBusy` replaces the label of the same button in flight, so the toolbar does
     * not reflow when it starts working.
     */
    enhancePrompt: "Improve prompt",
    enhancePromptDesc: "Rewrite as a clearer instruction — edit before sending",
    enhancePromptBusy: "Improving…",
    /** Shown once a rewrite lands; the point is that nothing was sent yet. */
    enhancePromptDone: "Improved — edit before sending, or undo",
    enhancePromptEmpty: "Type something first",
    enhancePromptNoModel: "Pick a default model in model settings first",
    enhancePromptNoResult: "Couldn't improve it: the model returned nothing usable",
    enhancePromptFailed: "Couldn't improve it — try again",
    /** 还原 — puts back the draft the rewrite replaced. */
    enhancePromptRestore: "Undo",
    /** Its tooltip says why it disappears on the first keystroke, which otherwise looks arbitrary. */
    enhancePromptRestoreDesc: "Restore the prompt from before the rewrite (gone once you edit)",
    goalProgress: (rounds: number, tokens: string): string => `round ${rounds} · tokens ${tokens}`,
    goalStatus: {
      active: "running",
      complete: "complete",
      blocked: "blocked",
      budget_limited: "budget exhausted",
      aborted: "interrupted",
    } as Record<string, string>,
  },

  /** Feishu-channel strings of the messaging binding editor (channel-neutral ones live under `messaging`). */
  feishu: {
    /** The what-binding-does FAQ fold's body (this channel's flavor). */
    intro:
      "Once bound, messages sent to the Feishu bot flow into this conversation, and the AI's replies are sent back to Feishu as plain text. You need a self-built Feishu app with the bot capability and the message-receive event subscribed in long-connection mode.",
    appId: "App ID",
    appSecret: "App Secret",
    /** Shown while a saved secret exists: submitting an empty field keeps it. */
    appSecretKeepHint: "Leave empty to keep the saved App Secret",
    /** The stored-secret row's clear checkbox (the models-page clear idiom). */
    clearSecret: "Clear stored App Secret",
    baseDomain: "API domain",
    baseDomainHint: "https://open.feishu.cn for Feishu, https://open.larksuite.com for Lark",
    invalidDomain: "The domain must be an http(s) URL",
    /** Why "send test message" is disabled before the bot has ever been messaged. */
    testMessageNoChat: "Message the bot once in Feishu first, so it knows which chat to send to",
    /** The setup FAQ fold's steps. */
    setupSteps: [
      "Create a self-built app in the Feishu developer console",
      "Enable the bot capability for the app",
      "Subscribe to the message-receive event, with the subscription mode set to long connection",
      "Copy the App ID and App Secret from the credentials page into the form above",
      "Publish an app version, get it approved, then message the bot once in Feishu",
    ],
  },

  /** Telegram-channel strings of the messaging binding editor (channel-neutral ones live under `messaging`). */
  telegram: {
    /** The what-binding-does FAQ fold's body (this channel's flavor). */
    intro:
      "Once bound, messages sent to the Telegram bot flow into this conversation, and the AI's replies are sent back to Telegram as plain text. Create a bot with @BotFather and paste its Bot Token — no public URL is needed.",
    botToken: "Bot Token",
    /** Shown while a saved token exists: submitting an empty field keeps it. */
    botTokenKeepHint: "Leave empty to keep the saved Bot Token",
    /** The stored-token row's clear checkbox (the models-page clear idiom). */
    clearToken: "Clear stored Bot Token",
    /**
     * The Bot Token field's corner link. Telegram has no developer console — the token is
     * issued by @BotFather inside the app — so this channel names the destination instead
     * of borrowing the shared "open developer console" label.
     */
    openBotFather: "Open @BotFather",
    invalidToken: "The Bot Token looks like <digits>:<secret>, as issued by @BotFather",
    /** Why "send test message" is disabled before the bot has ever been messaged. */
    testMessageNoChat: "Message the bot once in Telegram first, so it knows which chat to send to",
    /** The setup FAQ fold's steps. */
    setupSteps: [
      "Open @BotFather in Telegram and send /newbot to create a bot",
      "Name it as prompted, then copy the Bot Token @BotFather returns into the form above",
      "Find the bot in Telegram and send it one message",
    ],
  },

  /** QQ-channel strings of the messaging binding editor (channel-neutral ones live under `messaging`). */
  qq: {
    /** The what-binding-does FAQ fold's body (this channel's flavor). */
    intro:
      "Once bound, messages sent to the bot in QQ flow into this conversation, and the AI's replies are sent back to QQ. Create a bot on the QQ open platform and set its event subscription to WebSocket — no public URL is needed.",
    appId: "App ID",
    appSecret: "App Secret",
    /** Shown while a saved secret exists: submitting an empty field keeps it. */
    appSecretKeepHint: "Leave empty to keep the saved App Secret",
    /** The stored-secret row's clear checkbox (the models-page clear idiom). */
    clearSecret: "Clear stored App Secret",
    /** Why "send test message" is disabled before the bot has ever been messaged. */
    testMessageNoChat: "Message the bot once in QQ first, so it knows which chat to send to",
    /**
     * The rule that shapes this whole channel, stated where it is first needed rather than
     * left for the user to infer from a reply that never arrives.
     */
    repliesOnly:
      "QQ only lets a bot reply to a message you just sent it — it cannot start one. So a turn you begin in the web app is not mirrored to QQ, and once a few minutes have passed since your last QQ message, replies can no longer be delivered either. Send the bot another message in QQ to continue.",
    /** The passive-reply budget, in the terms a user experiences it. */
    replyBudget:
      "One QQ message can receive at most 4 replies (5 in a group). When a run produces more than that, the last one carries the rest combined — nothing is lost, it just arrives as a single message.",
    /** Scan-to-connect: the button, and the states it moves through. */
    scanStart: "Connect by QR",
    scanStarting: "Generating code…",
    /** In the setup fold: what scanning saves the user, in one line. */
    scanHint:
      "Or connect by QR: authorize in QQ by scanning, with no App ID or App Secret to copy by hand.",
    scanQrLabel: "QQ bot authorization QR code",
    scanWaiting: "Waiting to be scanned in QQ…",
    scanSteps:
      "Scan the code with QQ on your phone, then pick the bot to authorize on the page it opens and confirm.",
    /** Shown only after a code has actually lapsed and been replaced. */
    scanRefreshed: "The previous code expired; this is a new one.",
    /** Why the secret is safe to obtain this way — the question a careful user will ask. */
    scanPrivacy:
      "The credentials are received and stored by the server; the decryption key never reaches this browser.",
    scanDone: (appId: string): string =>
      `Saved the credentials for bot ${appId} — the connection can be enabled now`,
    scanFailed: (reason: string): string => `Scan-to-connect failed: ${reason}`,
    /** Shown when replacing lapsed codes stopped being worth another round trip. */
    scanExpiredRepeatedly:
      "The code kept expiring before it could be scanned. Try starting a new scan in a moment.",
    /** Why the scan button is gated while this channel holds the connection. */
    scanDisableFirst: "Disable the connection before rebinding by scan",
    /** Separates the scan path from the manual one; the fields below are the fallback, not the default. */
    scanOrManual: "Or enter them by hand",
    /** The setup FAQ fold's steps. */
    setupSteps: [
      "Register as a developer on the QQ open platform and create a bot",
      "Copy the App ID and App Secret from the development settings page into the form above",
      "Set the event subscription mode to WebSocket — leave the callback URL empty",
      "Add your own QQ account or a test group to the sandbox allowlist",
      "Find the bot in QQ and send it one message",
    ],
  },

  /** WeChat-channel strings of the messaging binding editor (channel-neutral ones live under `messaging`). */
  wechat: {
    /** The what-binding-does FAQ fold's body (this channel's flavor). */
    intro:
      "Once bound, messages sent to the bot in WeChat arrive in this conversation and the AI's replies go back to WeChat. Binding is a QR code scanned in WeChat — no public address, and no credential to apply for in any console.",
    /** The stored-token row's clear checkbox (the models-page clear idiom). */
    clearToken: "Clear stored Bot Token",
    /** Why this channel's form has no credential fields at all. */
    scanOnly:
      "A WeChat bot's credential comes only from scanning: there is no App ID or secret to fill in by hand.",
    /** Why "send test message" is disabled before the bot has ever been messaged. */
    testMessageNoChat:
      "Send the bot a message in WeChat first, so it knows which conversation to reply to",
    /**
     * The channel's shape, stated below its controls rather than left in a collapsed fold:
     * a user who binds it and then writes in a group sees nothing arrive.
     */
    directOnly:
      "This channel carries direct chats with the bot only; group messages never reach it.",
    /** What travels, and the one inbound kind that does not. */
    media:
      "Text, images and files travel in both directions. A voice message arrives as WeChat's own transcription of it; a recording WeChat could not transcribe cannot be read.",
    /** Scan-to-connect: the button, and the states it moves through. */
    scanStart: "Connect by scanning",
    /** The same control once a binding exists: scanning again replaces the stored credential. */
    scanRescan: "Scan again",
    scanStarting: "Generating the code…",
    scanQrLabel: "WeChat bot authorization QR code",
    scanWaiting: "Waiting for the code to be scanned in WeChat…",
    scanSteps: "Scan the code with WeChat on your phone, then confirm the authorization there.",
    /** Scanned but not yet confirmed: the phone is waiting, not this panel. */
    scanScanned: "Scanned — confirm the authorization on your phone.",
    /** Shown only after a code has actually lapsed and been replaced. */
    scanRefreshed: "The previous code lapsed; this one is new.",
    /** Why the credential is safe to obtain this way — the question a careful user will ask. */
    scanPrivacy:
      "The credential is received and stored by the server; it never reaches the browser.",
    scanDone: (botId: string): string =>
      `Saved the credential for bot ${botId} — the connection can be enabled now`,
    scanFailed: (reason: string): string => `Connecting by scan failed: ${reason}`,
    /** Shown when replacing lapsed codes stopped being worth another round trip. */
    scanExpiredRepeatedly:
      "The code lapsed before it was scanned several times over. Try again later.",
    /** The platform stopped accepting pairing codes for this scan. */
    scanBlocked:
      "Too many wrong pairing codes, so this scan is spent. Start a new one in a little while.",
    /** Not a failure: the bot is already bound here, so no new credential was issued. */
    scanAlreadyBound:
      "This bot is already bound, here or somewhere else, so no new token was issued. If this conversation is the one that should have it, unbind the bot where it is in use and scan again.",
    /** Why the scan button is gated while this channel holds the connection. */
    scanDisableFirst: "Disable the connection before rebinding it by scan",
    /** The pairing-code step: WeChat shows digits on the phone that must be typed here. */
    verifyPrompt: "Your phone is showing a number. Enter it to continue:",
    verifyLabel: "Pairing code",
    verifySubmit: "Confirm",
    verifySubmitting: "Submitting…",
    /** The setup FAQ fold's steps. */
    setupSteps: [
      "Press “Connect by scanning” above to generate the code",
      "Scan it with WeChat on your phone",
      "If your phone shows a number, type it into the panel",
      "Confirm the authorization on your phone; the credential is saved automatically",
      "Find the bot in WeChat and send it one message",
    ],
  },

  /**
   * Session ↔ messaging-bot binding: the dock panel, the row action + dialog, and the
   * channel-neutral editor strings (per-channel fields live under `feishu` / `telegram` /
   * `qq`).
   */
  messaging: {
    panelTitle: "Remote control",
    /** Session-row context-menu action. */
    bindAction: "Remote control",
    dialogTitle: "Remote control",
    /** The channel selector (always live: each channel's config is saved independently). */
    channelLabel: "Channel",
    channelName: {
      feishu: "Feishu",
      telegram: "Telegram",
      qq: "QQ",
      wechat: "WeChat",
    },
    /**
     * Shared link labels: the tutorial (in the setup FAQ fold) and, at the credential field's
     * corner, the developer console — the latter only for the channels that have one. A
     * channel whose credential is issued elsewhere names that destination itself (Telegram's
     * `telegram.openBotFather`).
     */
    tutorial: "Open tutorial",
    console: "Open developer console",
    /** The connection toggle (flips immediately, using the stored credentials). */
    enabled: "Enable connection",
    /** The toggle's own tooltip: the switch IS the bind/unbind control, which a label reading "enable" does not say. */
    bindByEnableHint:
      "Enabling binds this bot to this conversation; turning it off releases it. The credentials stay saved either way.",
    /** Why the toggle is gated while the form has unsaved edits. */
    saveBeforeEnable: "Save the credentials first, then enable the connection",
    test: "Test connection",
    testing: "Testing…",
    testOk: (ms: number): string => `Connected (${ms}ms)`,
    /** Success feedback naming the account the credentials sign in as (Telegram: the bot's @username). */
    testOkAs: (account: string, ms: number): string => `Connected as ${account} (${ms}ms)`,
    testFail: (reason: string): string => `Connection failed: ${reason}`,
    /** Second line on a successful Telegram test whose bot still has Group Privacy on; the remedies live in the troubleshooting fold, which outlasts a toast. */
    testPrivacyOn:
      "Group Privacy is on for this bot: it receives no ordinary messages in any group where it is not an administrator. See Troubleshooting below.",
    sendTestMessage: "Send test message",
    sendingTestMessage: "Sending…",
    testMessageSent: "Test message sent",
    statusLabel: "Connection status",
    status: {
      disconnected: "Not connected",
      connecting: "Connecting",
      connected: "Connected",
      error: "Connection error",
    },
    /** Why the enable switch is gated while the OTHER channel holds the connection. */
    otherEnabledHint: (other: string): string =>
      `Only one channel can be enabled per conversation: turn off the ${other} connection first`,
    /** Why the enable switch is gated while the selected channel has no stored credential. */
    credentialMissingHint: "Enter and save the credential first, then enable the connection",
    /** Why the clear checkbox is gated while the channel's connection is enabled. */
    disableBeforeClearHint: "Disable the connection before clearing the credential",
    /** The saved delivery option: render a reply's Markdown in the channel's own markup. */
    renderMarkdown: "Render Markdown",
    /**
     * Its disclosure, beside the label. One per channel, because what a channel can show is
     * the whole of what the reader needs to know here — a shared sentence would have to say
     * "depending on the channel", which answers nothing.
     */
    renderMarkdownHelpFeishu:
      "A reply's Markdown arrives as formatting instead of as `**characters**`. Feishu renders it as a card: headings, bold, italic, strikethrough, code and fenced code blocks, lists, quotes, rules, links and tables. A table longer than five rows arrives as a code block so no row is hidden. If Feishu refuses the card, the reply is sent as plain text rather than lost.",
    renderMarkdownHelpTelegram:
      "A reply's Markdown arrives as formatting instead of as `**characters**`. Telegram shows bold, italic, strikethrough, links, inline code and code blocks; it has no headings, lists or tables, so a heading becomes a bold line, list markers become part of the text, and a table arrives as a code block. If Telegram refuses the formatting, the reply is sent as plain text rather than lost.",
    renderMarkdownHelpQQ:
      "A reply's Markdown arrives as formatting instead of as `**characters**`. QQ shows headings, bold, italic, strikethrough, lists, quotes, rules and links; it has no code formatting and no tables, so a code block arrives as plain lines and a table as its rows. If QQ refuses the formatting, the reply is sent as plain text — which costs one more of the few replies QQ allows per message.",
    renderMarkdownHelpWeChat:
      "A reply's Markdown arrives as formatting instead of as `**characters**`. WeChat reads Markdown itself and shows the most of the four channels: headings, bold, strikethrough, lists, quotes, rules, links, inline code, code blocks and tables all render. What it cannot show keeps its words and loses its markers — headings past the fourth level, italics around Chinese text, and inline images, which become links.",
    /** The saved delivery option: one message per non-blank line of a reply. */
    linePerMessage: "One message per line",
    /** Its disclosure, beside the label: what the option does to a reply, and its two edges. */
    linePerMessageHelp:
      "Each non-blank line of a reply is sent as its own message, so an answer written as several spoken lines arrives as several messages. Past a per-reply limit the remaining lines are combined into one last message rather than dropped.",
    /** The saved delivery option: hold a run's working notes, send its last reply only. */
    finalReplyOnly: "Final reply only",
    /** Its disclosure, beside the label: what the option changes, and what it costs. */
    finalReplyOnlyHelp:
      "Sends only the last thing the assistant says in a run, when the run ends; the notes it writes between tool calls stay in the web app. The cost is hearing nothing while a long run is under way. The approval reminder is not a reply and still arrives immediately.",
    /**
     * Appended to the option's explanation on QQ only. Not a nuance of the same trade but a
     * different outcome — silence on the other two channels, lost output here — which the
     * channel-neutral sentence above would leave the user to discover from an empty chat.
     */
    finalReplyOnlyQQWarning:
      "QQ can only answer an inbound message, and that anchor expires after about five minutes: with this on, a run taking longer delivers nothing at all.",
    /** Enabled-row indicator's tooltip / sr text (the small per-channel glyph on the session row). */
    enabledIndicator: {
      feishu: "Feishu connection enabled",
      telegram: "Telegram connection enabled",
      qq: "QQ connection enabled",
      wechat: "WeChat connection enabled",
    },
    /**
     * Delivery observability under the toggle: has anything arrived, and did the last one get
     * through. Both readings belong to the LIVE CONNECTION and start over on a re-enable or a
     * credential save, so the empty case names that scope instead of reading as "never".
     * Each failure line carries its own time: nothing clears it on a later success, and a
     * title= is unreachable on touch.
     */
    inboundLastAt: (when: string) => `Last message received: ${when}`,
    inboundNone: "No message has arrived since this connection opened",
    deliveryFailedInbound: (when: string, detail: string) =>
      `A message arrived at ${when} but its task never started: ${detail}`,
    deliveryFailedSend: (when: string, detail: string) =>
      `The task ran but its reply failed to go out at ${when}: ${detail}`,
    /** A connection failure the connection has since recovered from (lastError is gone by then). */
    lastConnectionError: (when: string, detail: string) =>
      `The connection dropped at ${when}: ${detail}`,
    /** The collapsed FAQ folds below the save area. */
    faqSetupTitle: "Set up the bot",
    faqWhatTitle: "What binding does",
    /** The channel-neutral half of that fold: how the same bot moves between conversations. */
    faqWhatBinding:
      "The same bot can stay saved in several conversations, but only one of them may have its connection enabled at a time. To move it, turn the connection off where it is on and enable it here — no credential has to be deleted.",
    faqTroubleTitle: "Troubleshooting",
    /** Troubleshooting entries (bot must be messaged once; connection errors point at credentials; one poller per Telegram token; Telegram Group Privacy withholds group messages from a non-admin bot; QQ answers only a message just sent). */
    troubleNoChat:
      "“Send test message” disabled? The bot must have received one message first, so it knows which chat to send to.",
    troubleConnError:
      "Connection status shows an error? Check the credentials; for Feishu also confirm the API domain and the long-connection event subscription.",
    troubleOnePoller:
      "Telegram reports that another program is polling? A Bot Token serves exactly one program at a time — close the other JiuMate server or bot script using it, or give this conversation a bot of its own. A getUpdates you run by hand (a curl to see what Telegram has queued) is that other program too: disable the connection here before running one. Inspecting them by hand can also discard them — any call you pass an offset to confirms everything before it, and the app's own next connect drops the backlog — so retest with a freshly sent message rather than the ones you just looked at.",
    troubleGroupPrivacy:
      "The bot ignores everything you say in a Telegram group? Telegram's Group Privacy is on by default, and under it a bot that is not an administrator of the group receives only commands addressed to it (such as /start@your_bot) and replies to its own messages — ordinary group messages are never delivered at all, and the connection itself looks perfectly healthy. Making the bot an administrator of that group fixes it on its own, since administrators always receive every message. Otherwise turn Group Privacy off with /setprivacy in @BotFather, then remove the bot from the group and add it back — a group it is already in does not pick up the change.",
    /** WeChat has no group inbound at all — the answer to "I @-ed it in a group and nothing happened". */
    troubleWeChatDirect:
      "The WeChat channel receives direct chats only: @-mentioning the bot in a group does nothing at all. Message it directly instead.",
    /** The QQ-only failure a user will otherwise read as "the bot is broken". */
    troubleQQPassive:
      "No replies arriving in QQ? QQ only lets a bot answer a message you just sent: a turn started in the web app is not mirrored there, and replies stop being deliverable a few minutes after your last QQ message. Send another message in QQ to continue.",
    troubleNoGroupInbound:
      "Sending in a group but the panel still says no message has arrived? Read that line as evidence only about a message sent after it: it covers the current connection alone, and disabling and re-enabling the connection — or saving the credential again — opens a new one and starts it over. So send a fresh one now. If the line still reports nothing, Telegram is not delivering it and nothing on this machine can change that: confirm the bot is still in that group; if you have just turned Group Privacy off in @BotFather, remove the bot from the group and add it back, because an existing group does not pick up the change; and confirm nothing else is polling the same token — including a getUpdates you ran yourself (see above). Telegram channel posts are not supported either — this connection handles groups and direct chats only.",
  },

  /** Subagents side panel: call-graph of the latest Task + the selected child conversation. */
  subagentPanel: {
    topologyLabel: "Call graph",
    mainSessionNote: "The main conversation stays in the chat area",
    empty: "No subagents in the current task yet",
    nodeRunning: "running",
    nodeDone: "done",
    openAsSession: "Jump to this session",
    subagentGone: "This subagent session no longer exists and could not be revived",
  },

  files: {
    title: "Files",
    upload: "Upload",
    download: "Download",
    openInNewTab: "Open in new tab",
    /** Edit-mode toggle pill on the .md preview toolbar (visible only when editable-doc plugin ships). */
    edit: "Edit",
    /** Edit-mode save action (the inline submit). */
    editSave: "Save",
    /** Edit-mode discard action. */
    editCancel: "Cancel",
    /** Save-as action on a .docx being edited: write a copy beside the original. */
    docxSaveAs: "Save as",
    /**
     * Bento deck save.
     *
     * A deck boots into its own editor inside the preview frame, and its own Save cannot work there:
     * that control is wired to `showSaveFilePicker`, which the browser refuses from a cross-origin
     * subframe. The panel saves instead, by asking the deck for its document and splicing it into
     * the file. These strings are what the user sees when a step of that fails, so each names the
     * step rather than saying "save failed".
     */
    bentoSaved: "Saved to the workspace",
    /**
     * Shown instead of {@link bentoSaved} when the save also removed collaboration credentials.
     *
     * Said out loud rather than done quietly: the block being removed is what makes the deck join a
     * shared room, so a user who shared it deliberately is owed the reason it stopped, and the
     * remedy — rotating the keys, which is what actually revokes the old room — is in Bento's own
     * Share menu.
     */
    bentoCollabStripped:
      "Saved to the workspace (sharing credentials removed; rotate the keys in Bento's Share menu to revoke the old ones)",
    bentoNoFrame: "Cannot save: the deck preview is not ready yet. Try again in a moment.",
    bentoNoAnswer: "Cannot save: the deck did not respond. Refresh the preview and retry.",
    bentoNoDocument: "Cannot save: the deck editor is not ready yet. Try again in a moment.",
    bentoCannotRead: "Cannot save: the file could not be read. Reopen it and retry.",
    bentoNoBlock: "Cannot save: this file has no Bento document block (#bento-doc).",
    /** Save action for a Bento deck being edited in the preview. */
    bentoSave: "Save",
    /** Shown on that button while the document is being read out of the frame and written back. */
    bentoSaving: "Saving…",
    /** Toast after a .docx is written to a new path. */
    docxSavedAs: (name: string): string => `Saved as ${name}`,
    /** Shown while the real .docx is being laid out as a page. */
    docxPreviewLoading: "Rendering the document…",
    /** Shown when the .docx could not be read for display — the file's own fault, usually. */
    docxPreviewFailed: (message: string): string => `Could not render the document: ${message}`,
    /** Toast after a .docx is written back over its source. */
    docxSavedOver: "Overwrote the original",
    /** Shown when Save is pressed but the preview it belongs to is gone — see `requestSave`. */
    editSaveUnavailable: "Cannot save: the preview state has changed. Reopen the file and retry.",
    /**
     * The editor has been asked to serialize a document it does not have.
     *
     * Split from {@link editSaveUnavailable} because the two are different failures and the message
     * is the only thing a user can report back. One means the panel and the preview disagree about
     * what is open; the other means the engine has no document mounted. They shared a string once,
     * and a save that failed because the editor had not attached reported itself as a changed
     * preview — which sent the diagnosis in the wrong direction entirely.
     */
    editSaveNoDocument: "Cannot save: the editor is not ready yet. Try again in a moment.",
    /** Shown when the save handler itself threw — otherwise the failure is invisible. */
    editSaveFailed: (message: string): string => `Save failed: ${message}`,
    /** Banner shown when the file changed on disk since the user started editing — covers both server-side detection and the user's own reload. */
    editConflictBanner: "The file was modified elsewhere. Saving will overwrite the remote copy.",
    /** Confirm-modal copy for the discard path when the user has unsaved edits. */
    editDiscardConfirm: "Discard unsaved changes?",
    /** Dropdown label on the file preview toolbar — opens the multi-format export menu. */
    export: "Export",
    exportMd: "Markdown",
    exportHtml: "HTML",
    exportPdf: "PDF",
    exportDocx: "Word (.docx)",
    exportEpub: "EPUB",
    exportRtf: "RTF",
    exportTxt: "Plain text (.txt)",
    /** Shown on the dropdown trigger while a conversion is in flight (mermaid pre-render + server-side format). */
    /** Shown on the dropdown trigger while a conversion is in flight (mermaid pre-render + server-side format). */
    exportPreparing: (label: string): string => `Preparing ${label}…`,
    /** Toast when the user picks "Markdown" on an empty file — a 0-byte .md download is a silent no-op
     *  in the browser, so we surface the real reason instead of letting the click click nothing. */
    exportEmptyMarkdown: "This file is empty — there is nothing to export.",
    /** Tooltip on any greyed-out menu item: the dropdown disables items whose backing service is missing.
     *  Parameterised by the server-supplied reason (e.g. "Pandoc is not installed." / "PDF export requires the desktop app.")
     *  so the dropdown can echo the exact capability string rather than a generic "unavailable" copy. */
    exportUnavailableReason: (reason: string): string => reason,
    previewNotIsolatedHint:
      "This address has no separate preview origin, so the page opens sandboxed: localStorage, cookies and third-party embeds will not work. Reach the app over 127.0.0.1 or localhost, or set JIUMATE_PREVIEW_ORIGIN.",
    refresh: "Refresh",
    root: "Workspace root",
    empty: "Empty directory",
    previewUnsupported: "Preview not supported for this type; download instead",
    uploaded: "Uploaded",
    /** Upload-overwrite confirmation: same-name files in the current directory will be replaced. */
    overwriteTitle: "Overwrite existing files",
    overwriteConfirm: (n: number): string =>
      `The current directory already has ${n} file(s) with these names — uploading will overwrite:`,
    loadFailed: "Failed to load",
    previewTruncated: "File too large; preview truncated, download for the full file",
    details: "Details",
    workspacePath: "Workspace path",
    htmlRendered: "Rendered",
    htmlSource: "Source",
    backToList: "Back to list",
  },

  usage: {
    title: "Tokens",
    today: "Today",
    last7d: "Last 7 days",
    total: "Total",
    tokens: "Tokens",
    requests: "Requests",
    from: "From",
    to: "To",
    colCacheRead: "cache_read",
    colCacheWrite: "cache_write",
    colOutput: "output",
    uncostedNote: "* Only models with configured pricing count toward cost",
    filterAllAgents: "All agents",
    filterAllModels: "All models",
    rangeLabel: "Date range",
    rangeHour: "Last hour",
    rangeDay: "Last 24 hours",
    range7d: "Last 7 days",
    range30d: "Last 30 days",
    range90d: "Last 90 days",
    rangeCustom: "Custom",
    /**
     * Year heatmap (features/usage/token-heatmap-panel.tsx): one cell per day, weeks across and
     * weekdays down, over a whole calendar year. Independent of the page's range filter — it is
     * the one panel that answers "how has this year gone" rather than "what did the selected
     * window do".
     */
    heatmapTitle: "Tokens by day, all year",
    heatmapDesc: "One cell per day; darker means more tokens.",
    /** The three figures beside the grid, in the reference layout's order. */
    heatmapTotal: "Total tokens",
    heatmapPeak: "Busiest day",
    heatmapActive: "Active days",
    /**
     * Weekday labels down the side, Monday first. Spelled out rather than taken from
     * `Intl`'s narrow form, which collapses to M/T/W/T/F/S/S — three pairs of identical
     * labels for a column of seven rows.
     */
    heatmapWeekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    /** Hover tooltip: the day's date, its Token total, and its cache hit rate (the reference card's two lines). */
    heatmapTipTokens: (tokens: string): string => `Tokens ${tokens}`,
    heatmapTipCache: (percent: string): string => `Cache hit ${percent}`,
    heatmapLess: "Less",
    heatmapMore: "More",
    heatmapPrevYear: "Previous year",
    heatmapNextYear: "Next year",
    heatmapLoading: "Loading the year…",
    heatmapError: "Could not load the year's usage.",
    chartRequestsByAgent: "Requests & success rate by agent",
    chartRequestsByModel: "Requests & success rate by model",
    legendSuccessRate: "Success rate",
    chartTokenTrend: "Token trend",
    chartCostTrend: "Cost trend",
    legendOther: (n: number): string => `Other (${n})`,
    bucketTotal: "Total",
    legendHitRate: "Cache hit rate",
    empty: "No usage records",
    errorsClearDone: (count: number): string =>
      `Deleted ${count} error record${count === 1 ? "" : "s"}`,
  },

  /**
   * The System settings "Logs" page — the server error log, moved off the cost center.
   *
   * `sources` and `codes` are deliberately empty: every value is already a readable English
   * identifier (`environment`, `session_run_failed`), so the raw value IS the English label and
   * the lookups fall back to it. Same reasoning as `toolNames` — the identifier is also what a
   * Trace and the server's own logs say, so nothing is lost by showing it.
   */
  logs: {
    title: "Logs",
    rangeLabel: "Time range",
    rangeToday: "Today",
    range7d: "Last 7 days",
    range30d: "Last 30 days",
    rangeAll: "All time",
    /** Agent filter: the "no filter" option, and the label of the control itself. */
    allAgents: "All agents",
    agentLabel: "Filter by Agent",
    total: "Total",
    unexpected: "Unexpected",
    expected: "Expected",
    topCode: "Most common",
    colCode: "Source · code",
    colKind: "Type",
    colMessage: "Message",
    empty: "No log entries",
    /** Detail-table pager: newer/older step back through pages of the same filtered set. */
    newer: "Newer",
    older: "Older",
    pageOf: (page: number, pages: number, total: number) =>
      `Page ${page} / ${pages} · ${total} total`,
    /** Clearing the table: the action, and the confirm that must name exactly what goes. */
    clear: "Clear",
    clearTitle: "Clear error records",
    clearScope: (count: number, from: string, to: string): string =>
      `Deletes this Project's ${count} error record${count === 1 ? "" : "s"} between ${from} and ${to}. Records outside that range are kept.`,
    /** The Agent filter narrows the same delete, so the sentence has to name the Agent too. */
    clearScopeAgent: (count: number, from: string, to: string, agentId: string): string =>
      `Deletes this Project's ${count} error record${count === 1 ? "" : "s"} for agent ${agentId} between ${from} and ${to}. Other agents and other dates are kept.`,
    /** The "All time" preset has no bounds to name, so the confirm says so in as many words. */
    clearScopeAll: (count: number): string =>
      `Deletes all ${count} of this Project's error records. Other Projects are unaffected.`,
    /** Both narrowings at once: no range to name, but an Agent to. */
    clearScopeAllAgent: (count: number, agentId: string): string =>
      `Deletes all ${count} of this Project's error records for agent ${agentId}. Other agents are unaffected.`,
    clearIrreversible: "This cannot be undone.",
    clearDone: (count: number): string => `Deleted ${count} error record${count === 1 ? "" : "s"}`,
    /** Empty: the raw source reads as its own English label (see the block comment above). */
    sources: {} as Readonly<Record<string, string>>,
    /** Empty: the raw code reads as its own English label (see the block comment above). */
    codes: {} as Readonly<Record<string, string>>,
  },

  /** The Trace panel's own view of a Trace file (trace-file-view / timeline-chart); the standalone browsing page these once also served is gone. */
  traces: {
    timeline: "Execution timeline",
    laneLLM: "Model",
    kindThinking: "thinking",
    kindModelReply: "model reply",
    kindToolGen: "tool call gen",
    legendToolExec: "tool exec",
    legendOther: "Other",
    toolParams: "Parameter schema",
    /** Spoken form of the red "*" in the schema table, where no control carries `aria-required`. */
    requiredParam: "required",
    legendApprovalWait: "approval wait",
    task: (n: number) => `Turn ${n}`,
    globalSummary: "Overall",
    tasksLabel: "Turns",
    messages: "Messages",
    truncatedNote: (shown: number, total: number) => `Showing first ${shown} / ${total} messages`,
    zoom: "Zoom",
    zoomReset: "Double-click to reset zoom",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    linkHint:
      "Hover a timeline segment or event row to cross-highlight, click a segment to jump to its message; legend highlights its kind; drag the bar below to pan/zoom",
    filesTitle: "Trace files",
    toolCalls: "Tool calls",
    taskInput: "Input tokens this turn",
    taskOutput: "Output tokens this turn",
    cacheHit: "Cache hits",
    hitRate: "Hit rate",
    compactions: "compactions",
    inProgress: "in progress",
    systemPrompt: "System prompt",
    toolDefs: (n: number) => `Tool definitions (${n})`,
    exportFile: "Export",
  },

  benchmark: {
    title: "Evaluation Center",
    selectBenchmark: "Select a Benchmark on the left",
    emptyAgent: "No Benchmarks for this agent",
    caseCount: (n: number): string => `${n} case${n === 1 ? "" : "s"}`,
    trendTitle: (metric: string): string => `${metric} over time`,
    cases: "Cases",
    viewCase: "View details",
    taskMaterials: "Task materials",
    rubric: "Scoring rubric",
    agentHidden: "Hidden from Target Agent",
    caseFileUnavailable: "Case files are unavailable",
    evaluations: "Evaluations",
    noEvaluations: "No evaluations yet",
    summaryLabel: "Summary",
    legendUnlabeled: "unlabeled model",
    colVersion: "Version",
    colModel: "Model ID",
    colThinkingLevel: "Thinking level",
    colScore: "Score",
    colDuration: "Duration",
    colCase: "Case",
    colRun: "Run",
    colSession: "Session",
  },

  errors: {
    networkError: "Network error, please check your connection",
    modelCredentialMissing: (modelId: string) =>
      `Model ${modelId} has no API key yet — configure it on the Models page first`,
    noDefaultModel: "This project has no default model yet — add one on the Models page first",
    /** Localized text for the common server error codes (server error messages are English-only); looked up by ApiError.code in apiErrorText, falling back to the raw message for unmapped codes. */
    byCode: {
      invalid_credentials: "Incorrect username or password.",
      too_many_attempts: "Too many failed sign-in attempts. Try again shortly.",
      password_mismatch: "The current password is incorrect.",
      invalid_password: "Password must be at least 8 characters.",
      admin_required: "Only an admin can perform this operation.",
      desktop_single_user: "The desktop app is single-user; user management is unavailable.",
      not_found: "This resource does not exist, or you do not have access.",
      internal: "The server hit an internal error. Please try again shortly.",
      agent_not_found: "This agent no longer exists.",
      unknown_agent: "That agent does not exist in this Project.",
      agent_exists: "This agent id is already taken.",
      agent_deleting: "This agent is being deleted.",
      project_exists: "This Project id is already taken.",
      project_not_found: "This Project no longer exists, or you do not have access.",
      cannot_delete_last_project: "This is the last Project and cannot be deleted.",
      user_exists: "This username is already taken.",
      user_not_found: "This user no longer exists.",
      cannot_delete_admin: "The built-in admin cannot be deleted.",
      member_not_found: "This user is not a member of the Project.",
      already_member: "This user is already a member of the Project.",
      already_owner: "This user is already an owner of the Project.",
      memory_import_confirm_required:
        "This import would overwrite or delete memories. Confirm it to continue.",
      schedule_exists: "A scheduled task with this name already exists.",
      schedule_not_found: "This scheduled task no longer exists.",
      unknown_skill: "This skill is not in the selected directory.",
      unknown_plugin: "This plugin is not in the plugin library.",
      goal_plugin_not_installed:
        "Goal mode needs the goal plugin — install it on this agent from the plugin library.",
      skill_too_large: "This skill directory exceeds the import limits.",
      file_not_found: "This file no longer exists.",
      not_pending: "This steering message already reached the model and can no longer be recalled.",
      follow_up_started: "This follow-up already started and can no longer be recalled.",
      file_too_large: "The file is too large.",
      too_many_files: "Too many files attached to one message.",
      payload_too_large: "The request is too large.",
      image_too_large: "The image is too large to send inline.",
      dir_not_absolute: "The directory must be an absolute path.",
      dir_not_found: "That directory does not exist or is inaccessible.",
      not_a_dir: "That path is not a directory.",
      path_not_found: "That path does not exist.",
      workspace_missing: "This Session's Workspace no longer exists.",
      workspace_not_found: "That Workspace does not exist, or is not a directory.",
      session_not_found: "This Session no longer exists, or you do not have access.",
      session_deleting: "This Session is being deleted.",
      approval_not_found: "This approval request was already answered, or is no longer valid.",
      process_not_found: "This background process already exited, or was removed.",
      process_running: "This background process is still running — stop it before removing it.",
      memory_file_not_found: "This memory file no longer exists.",
      memory_scope_not_found: "This memory scope no longer exists.",
      task_in_progress: "This Session already has a task running.",
      compacting: "This Session is compacting its context and is not accepting new input.",
      shutting_down: "The server is shutting down. Please try again shortly.",
      // The three "cannot compact" reasons each have their own server code, so each keeps its
      // own explanation here — collapsing them into one sentence would tell a user who just
      // compacted that they have never spoken.
      compaction_not_configured: "This agent does not have context compaction configured.",
      nothing_to_compact:
        "There is nothing to compact in the current context yet (no completed conversation turn).",
      already_compacted:
        "The context was just compacted and nothing has been said since — no need to compact again.",
      version_conflict: "The snapshot's version is not newer than the current one.",
      invalid_title: "The title is invalid.",
      invalid_proxy_url:
        "Invalid proxy address — use an http(s):// or socks5:// proxy URL, or host[:port].",
      invalid_attachment_limit:
        "Invalid upload limit — use a whole number of MB inside the allowed range, with the total no lower than the per-file limit.",
      invalid_trace: "This file is not a valid Trace file.",
      trace_not_found: "This Trace file no longer exists.",
      trace_session_exists:
        "This agent already has a Session with that id; a duplicate Trace cannot be imported.",
      feishu_secret_required: "App Secret is required.",
      feishu_not_bound: "This Session has no Feishu binding yet.",
      feishu_no_chat: "No Feishu message received yet — message the bot once in Feishu first.",
      feishu_send_failed: "Sending the Feishu message failed.",
      telegram_token_required: "Bot Token is required.",
      telegram_token_invalid: "The Bot Token is malformed: it looks like <digits>:<secret>.",
      telegram_not_bound: "This Session has no Telegram binding yet.",
      telegram_no_chat:
        "No Telegram message received yet — message the bot once in Telegram first.",
      telegram_send_failed: "Sending the Telegram message failed.",
      another_channel_enabled:
        "Another channel's connection is enabled on this conversation: disable it first.",
      // Deliberately names nothing about the other conversation: it may live in a Project
      // this user cannot see, and the remedy does not depend on knowing which one it is.
      account_enabled_elsewhere:
        "This bot's connection is enabled on another conversation: turn it off there first.",
      messaging_disable_before_clear:
        "Disable this channel's connection before clearing its credential.",
      messaging_disable_before_scan:
        "Disable this channel's connection before rebinding it by scan.",
    },
  },

  /**
   * Display names for the built-in tools, keyed by tool id.
   *
   * Deliberately empty: the tool ids are already English (`read_file`, `exec_command`, …), so
   * the English surface reads the id — which is also the name that appears in a Trace and in
   * the model's own calls. `toolLabel` falls back to the id, so an empty table is a complete
   * answer here, not a gap. Fill it in only if a friendlier English label is ever wanted.
   */
  toolNames: {} as Readonly<Record<string, string>>,
};
