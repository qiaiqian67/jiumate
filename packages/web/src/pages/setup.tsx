/**
 * The first-run setup wizard.
 *
 * Four steps — language, prepare, model, appearance — drawn as one window the desktop shell
 * opens on its own (see packages/desktop/src/setup-window.ts) rather than as a route the main
 * window navigates to. The shell decides whether it appears (no completion marker on disk) and
 * closes it when this page reports `done`, so nothing here knows about windows or markers.
 *
 * Two things this page deliberately does not own:
 *
 * - **The completion marker.** `window.setup.done()` tells the shell; the shell writes the file.
 *   A renderer that could write its own marker would be one bad keypress away from never being
 *   asked again.
 * - **The language's storage.** Step 1 writes the same `jiumate.lang` key the app reads
 *   (state/locale.tsx), through that provider's own setter. Two copies of a preference would be
 *   two copies that disagree.
 *
 * The bridge is absent in a plain browser — someone can type `/setup` by hand — so every call
 * null-checks and the page degrades to a working layout with the shell-only affordances simply
 * not drawn. That is why the title bar's window controls are conditional rather than disabled.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { MODEL_PROVIDERS } from "@prismshadow/jiumate-core/model-catalog";
import { S } from "../lib/strings";
import { useDocumentTitle } from "../lib/use-document-title";
import { useLocale } from "../state/locale";
import type { LangPref } from "../state/locale";
import { useTheme } from "../state/theme";
import type { ThemeMode } from "../state/theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PasswordInput } from "../components/ui/password-input";
import { Select } from "../components/ui/select";
import { JiuMateLogo } from "../components/ui/jiumate-logo";

/** The four steps, in order. The count is what the footer reads "step N of M" from. */
const STEPS = ["language", "prepare", "model", "appearance"] as const;
type StepId = (typeof STEPS)[number];

/**
 * Step names, looked up by id rather than assembled from the key.
 *
 * `S.setup` also holds a function (`stepOf`), so an index into it widens to
 * `string | ((n: number, m: number) => string)` and will not render as text. An explicit map
 * keeps the four labels honest — no key-mangling that breaks the moment one is renamed.
 */
const STEP_LABEL: Record<StepId, string> = {
  language: S.setup.stepLanguage,
  prepare: S.setup.stepPrepare,
  model: S.setup.stepModel,
  appearance: S.setup.stepAppearance,
};

/** The shell's CLI install outcomes, which are its five and not ours to invent. */
type CliResult = "installed" | "current" | "foreign" | "deferred" | "failed" | null;

/** Copy for each real outcome the shell reports. `null` has no label: nothing has run yet. */
const CLI_RESULT_LABEL: Record<Exclude<CliResult, null>, string> = {
  installed: S.setup.cliResultInstalled,
  current: S.setup.cliResultCurrent,
  foreign: S.setup.cliResultForeign,
  deferred: S.setup.cliResultDeferred,
  failed: S.setup.cliResultFailed,
};

interface CliState {
  kind: string | null;
  lastResult: CliResult;
  detail: string | null;
  declined: boolean;
}

/**
 * The bundled components step 2 reports on.
 *
 * **None of these are checked over the wire.** The wizard window has a preload bridge and could
 * stat the packaged binaries — but that would mean the page growing a shell-specific question
 * ("is `resources/git` there?") that only means something inside an Electron bundle. What it
 * shows instead is the component and what it is for, which is true everywhere and is the part
 * the user is actually reading for.
 */
const COMPONENTS = [
  { id: "git", labelKey: "componentGit", detailKey: "componentGitDetail" },
  { id: "pandoc", labelKey: "componentPandoc", detailKey: "componentPandocDetail" },
  { id: "pty", labelKey: "componentPty", detailKey: "componentPtyDetail" },
] as const;

export function SetupPage() {
  useDocumentTitle(S.setup.productName);

  const { lang, setLang } = useLocale();
  const { mode, setMode, themes, activeTheme, setTheme } = useTheme();

  const [step, setStep] = useState<StepId>("language");
  const [dataDir, setDataDir] = useState("");
  const [optionCli, setOptionCli] = useState(true);
  const [optionLaunch, setOptionLaunch] = useState(true);
  const [cli, setCli] = useState<CliState | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<string>(MODEL_PROVIDERS[0]?.id ?? "deepseek");
  const [modelId, setModelId] = useState("");
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const bridge = window.setup;
  const stepIndex = STEPS.indexOf(step);

  // Read the CLI's real state on mount rather than re-running the install to find out: a
  // dev run has no bundled command at all, and asking it to install one would report a failure
  // for something that was never missing.
  useEffect(() => {
    if (bridge === undefined) return;
    void bridge
      .cliState()
      .then(setCli)
      .catch(() => setCli(null));
  }, [bridge]);

  const finish = useCallback(async () => {
    if (bridge === undefined) return;
    await bridge.done(lang);
  }, [bridge, lang]);

  const goNext = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      void finish();
      return;
    }
    const next = STEPS[stepIndex + 1];
    if (next !== undefined) setStep(next);
  }, [stepIndex, finish]);

  const browse = useCallback(async () => {
    if (bridge === undefined) return;
    const picked = await bridge.pickDataDir();
    if (picked !== null) setDataDir(picked);
  }, [bridge]);

  const installCli = useCallback(async () => {
    if (bridge === undefined) return;
    setBusy(true);
    try {
      await bridge.installCli();
      setCli(await bridge.cliState().catch(() => null));
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  const providerInfo = useMemo(
    () => MODEL_PROVIDERS.find((p) => p.id === provider) ?? MODEL_PROVIDERS[0],
    [provider],
  );

  /** The provider's own models, or none — a custom provider has no catalog to offer. */
  const providerModels = useMemo(() => {
    if (providerInfo === undefined) return [];
    return MODEL_PROVIDERS.length > 0 && "models" in providerInfo
      ? ((providerInfo as { models?: readonly { id: string; label?: string }[] }).models ?? [])
      : [];
  }, [providerInfo]);

  const canFinish = !busy;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Title bar. Drawn here rather than by the OS: the shell's wizard window is frameless, so
          these are the window's only controls. Hidden in a plain browser, where there is no
          window to control and a dead button would be a lie. */}
      {bridge !== undefined && (
        <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-gray-100 px-4 dark:border-gray-800">
          <JiuMateLogo className="h-5 w-5 rounded" />
          <span className="text-sm text-gray-500 dark:text-gray-400">{S.setup.productName}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label={S.setup.windowMinimize}
              title={S.setup.windowMinimize}
              onClick={() => void bridge.minimize()}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              <span aria-hidden>−</span>
            </button>
            <button
              type="button"
              aria-label={S.setup.windowClose}
              title={S.setup.windowClose}
              onClick={() => void bridge.close()}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
        </div>
      )}

      {/* Step nav. Absent on the first step, where the reference design shows the brand
          instead — a four-item bar over a page that only asks one question is a promise the
          page has not made yet. */}
      {step !== "language" && (
        <nav
          aria-label={S.setup.stepOf(stepIndex + 1, STEPS.length)}
          className="shrink-0 px-8 pt-6"
        >
          <ol className="flex items-center gap-6">
            {STEPS.map((id) => (
              <li key={id}>
                <span
                  aria-current={id === step ? "step" : undefined}
                  className={
                    id === step
                      ? "text-sm font-semibold text-gray-900 dark:text-gray-100"
                      : "text-sm text-gray-400 dark:text-gray-500"
                  }
                >
                  {STEP_LABEL[id]}
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        {step === "language" && (
          <section className="flex h-full items-center gap-16">
            {/* Brand block: the first step is the one the user has not configured anything yet,
                so it is the only place the product introduces itself. */}
            <div className="flex w-64 shrink-0 flex-col items-center text-center">
              <JiuMateLogo className="h-32 w-32" />
              <h1 className="mt-6 text-4xl font-bold tracking-tight">{S.setup.productName}</h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">v0.3.0</p>
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-semibold">{S.setup.languageTitle}</h2>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                {S.setup.languageSubtitle}
              </p>
              <div className="mt-6 space-y-2">
                {(
                  [
                    ["en", S.setup.langEn],
                    ["zh", S.setup.langZh],
                    ["system", S.setup.langSystem],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={
                      lang === value
                        ? "flex cursor-pointer items-center gap-3 rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800/60"
                        : "flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                    }
                  >
                    <input
                      type="radio"
                      name="setup-lang"
                      className="sr-only"
                      checked={lang === value}
                      onChange={() => setLang(value as LangPref)}
                    />
                    <span
                      aria-hidden
                      className={
                        lang === value
                          ? "flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--accent-bg)]"
                          : "flex h-4 w-4 items-center justify-center rounded-full border-2 border-gray-300 dark:border-gray-600"
                      }
                    >
                      {lang === value && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-bg)]" />
                      )}
                    </span>
                    <span className="text-sm">{label}</span>
                    {value === "system" && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {S.setup.langSystemDetail}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <div className="mt-10 flex justify-end">
                {/* Default size, not a larger tier: the reference design's primary action is
                    oversized, but `size` is a closed union on the shared Button and widening it
                    for one page would change the type every other caller is checked against. */}
                <Button variant="primary" onClick={goNext}>
                  {S.setup.continueLabel}
                </Button>
              </div>
            </div>
          </section>
        )}

        {step === "prepare" && (
          <section className="mx-auto max-w-2xl">
            <h2 className="text-2xl font-semibold">{S.setup.prepareTitle}</h2>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              {S.setup.prepareSubtitle}
            </p>

            <div className="mt-8">
              <label className="block text-sm font-medium">{S.setup.dataDirLabel}</label>
              <div className="mt-2 flex gap-2">
                <Input
                  value={dataDir}
                  onChange={(e) => setDataDir(e.target.value)}
                  placeholder={S.setup.dataDirDefault}
                  className="flex-1 font-mono text-sm"
                />
                {bridge !== undefined && (
                  <Button onClick={() => void browse()}>{S.setup.dataDirBrowse}</Button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {S.setup.dataDirHint}
              </p>
            </div>

            <div className="mt-6 flex items-center gap-6 text-sm">
              <span className="text-gray-500 dark:text-gray-400">
                {S.setup.requiredSpace}{" "}
                <span className="text-gray-900 dark:text-gray-100">
                  {S.setup.requiredSpacePending}
                </span>
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                {S.setup.availableSpace}{" "}
                <span className="text-gray-900 dark:text-gray-100">
                  {S.setup.requiredSpacePending}
                </span>
              </span>
            </div>

            <div className="mt-8">
              <h3 className="text-sm font-medium">{S.setup.componentsTitle}</h3>
              <ul className="mt-2 space-y-1.5">
                {COMPONENTS.map((c) => (
                  <li key={c.id} className="flex items-baseline gap-3 text-sm">
                    <span className="w-24 shrink-0">{S.setup[c.labelKey]}</span>
                    <span className="min-w-0 flex-1 text-gray-500 dark:text-gray-400">
                      {S.setup[c.detailKey]}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                      {S.setup.componentChecking}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8">
              <h3 className="text-sm font-medium">{S.setup.optionsTitle}</h3>
              <label className="mt-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  checked={optionCli}
                  onChange={(e) => setOptionCli(e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{S.setup.optionCli}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {S.setup.optionCliDetail}
                  </span>
                  {/* The CLI's real outcome, once there is one. Absent in a browser (no shell to
                      ask) and before anything has run — the row is simply not there yet, which is
                      honest, rather than showing a success nobody confirmed. */}
                  {cli?.lastResult != null && (
                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                      {cli.declined ? S.setup.cliDeclined : CLI_RESULT_LABEL[cli.lastResult]}
                    </span>
                  )}
                </span>
              </label>
              <label className="mt-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  checked={optionLaunch}
                  onChange={(e) => setOptionLaunch(e.target.checked)}
                />
                <span className="text-sm">{S.setup.optionLaunch}</span>
              </label>
            </div>

            {optionCli && bridge !== undefined && (
              <div className="mt-6">
                <Button onClick={() => void installCli()} disabled={busy}>
                  {busy ? S.setup.preparing : S.setup.optionCli}
                </Button>
              </div>
            )}
          </section>
        )}

        {step === "model" && (
          <section className="mx-auto max-w-2xl">
            <h2 className="text-2xl font-semibold">{S.setup.modelTitle}</h2>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              {S.setup.modelSubtitle}
            </p>

            {/* Label left, control right. The reference design's form, kept as-is: these fields
                are the ones users fill in most often, and a right-aligned control column is what
                makes a stack of them scannable. */}
            <div className="mt-8 space-y-5">
              <div className="flex items-center gap-4">
                <span className="w-32 shrink-0 text-sm font-medium">{S.setup.modelProvider}</span>
                <div className="min-w-0 flex-1">
                  <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {MODEL_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-32 shrink-0 text-sm font-medium">{S.setup.modelApiKey}</span>
                <div className="min-w-0 flex-1">
                  {/* No reveal state here: PasswordInput carries its own show/hide toggle, so
                      passing one in as well would be two toggles fighting over one field. */}
                  <PasswordInput value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-32 shrink-0 text-sm font-medium">{S.setup.modelName}</span>
                <div className="min-w-0 flex-1">
                  {providerModels.length > 0 ? (
                    <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                      {providerModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label ?? m.id}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      placeholder={providerInfo?.id ?? ""}
                    />
                  )}
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {S.setup.modelAdvancedNote}
            </p>

            <div className="mt-6 flex items-center gap-3">
              <Button onClick={() => setTestResult(null)} disabled={!apiKey}>
                {S.setup.modelTest}
              </Button>
              {testResult !== null && (
                <span
                  className={
                    testResult === "ok"
                      ? "text-sm text-emerald-600 dark:text-emerald-400"
                      : "text-sm text-red-600 dark:text-red-400"
                  }
                >
                  {testResult === "ok" ? S.setup.modelTestOk : S.setup.modelTestFailed}
                </span>
              )}
            </div>
          </section>
        )}

        {step === "appearance" && (
          <section className="mx-auto max-w-3xl">
            <h2 className="text-2xl font-semibold">{S.setup.appearanceTitle}</h2>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              {S.setup.appearanceSubtitle}
            </p>

            <div className="mt-6">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="setup-mode"
                  className="sr-only"
                  checked={mode === "system"}
                  onChange={() => setMode("system")}
                />
                <span
                  aria-hidden
                  className={
                    mode === "system"
                      ? "flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--accent-bg)]"
                      : "flex h-4 w-4 items-center justify-center rounded-full border-2 border-gray-300 dark:border-gray-600"
                  }
                >
                  {mode === "system" && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-bg)]" />
                  )}
                </span>
                {S.setup.appearanceSystem}
              </label>
              <div className="mt-3 flex gap-2">
                {(["light", "dark"] as const).map((m) => (
                  <Button
                    key={m}
                    variant={mode === m ? "primary" : "secondary"}
                    onClick={() => setMode(m as ThemeMode)}
                  >
                    {m === "light" ? S.setup.appearanceLight : S.setup.appearanceDark}
                  </Button>
                ))}
              </div>
            </div>

            {/* The theme grid. Two columns like the reference design, but the contents are the
                app's own gallery — a skin carries a palette *and* artwork, so its swatch is a
                pair of bars rather than a single colour chip. Selecting one applies it at once,
                which is what makes the grid worth having on a setup screen at all. */}
            <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {themes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  aria-pressed={activeTheme === t.id}
                  className={
                    activeTheme === t.id
                      ? "flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2.5 text-left dark:bg-gray-800/60"
                      : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  }
                >
                  <span
                    aria-hidden
                    className={
                      activeTheme === t.id
                        ? "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent-bg)]"
                        : "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-gray-300 dark:border-gray-600"
                    }
                  >
                    {activeTheme === t.id && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-bg)]" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                  <span
                    aria-hidden
                    className="h-6 w-16 shrink-0 overflow-hidden rounded"
                    style={{
                      background: t.colors.background,
                      boxShadow: `inset 0 0 0 1px ${t.colors.line}`,
                    }}
                  >
                    <span className="block h-1/2 w-full" style={{ background: t.colors.accent }} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer. The primary action is the only thing on the right; the left holds whatever that
          step's secondary exit is ("set up the model later"), because a wizard that cannot be
          declined is a wizard that traps the user in it. */}
      <footer className="flex shrink-0 items-center gap-4 border-t border-gray-100 px-8 py-4 dark:border-gray-800">
        {step !== "language" && (
          <Button variant="ghost" onClick={() => setStep(STEPS[stepIndex - 1] ?? "language")}>
            {S.setup.back}
          </Button>
        )}
        {step === "model" && (
          <button
            type="button"
            onClick={goNext}
            className="text-sm text-[var(--accent-bg)] hover:underline"
          >
            {S.setup.modelLater}
          </button>
        )}
        <div className="ml-auto flex items-center gap-4">
          {step !== "language" && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {S.setup.stepOf(stepIndex + 1, STEPS.length)}
            </span>
          )}
          {step === "appearance" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300"
                checked={optionLaunch}
                onChange={(e) => setOptionLaunch(e.target.checked)}
              />
              {S.setup.appearanceLaunch}
            </label>
          )}
          {/* Same tier as every other primary action in the app — see the note on the language
              step's button. The reference design's oversized pill is not worth widening the
              shared Button's size union for. */}
          <Button variant="primary" onClick={goNext} disabled={!canFinish}>
            {step === "appearance" ? S.setup.finish : S.setup.continueLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}
