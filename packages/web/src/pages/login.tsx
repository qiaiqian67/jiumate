/**
 * Login page: a watchers panel beside the form, brand logo above the fields, and the same
 * credentials and errors this page has always had.
 *
 * ## Why the panel is on the left and not behind the form
 *
 * A login page is a screen people sit and stare at while they decide what to type. The panel
 * gives them something to stare at that reacts to them — the eyes follow the pointer, glance at
 * the username as it is typed, and look away while a password is being entered. That last one is
 * the reason the panel and the form are side by side rather than layered: watching a password
 * being typed is the one reaction that would make the form feel exposed, so the watchers turn
 * away from it, and the composition has to make that legible.
 *
 * ## What is deliberately unchanged
 *
 * The credential fields, the required-field errors, the auth failure message, the built-in
 * admin hints, and the language/theme controls are all exactly as they were. This is a new
 * surface for an existing flow, not a new flow: there is still no self-service registration
 * (admins create accounts), and there is still no password reset. The reference design had
 * "remember me" and "forgot password?" — neither has anything to do here, and a link that goes
 * nowhere is worse than no link.
 *
 * The watchers are decorative and hidden below `lg`, where the two columns would each be too
 * narrow to be usable; the form takes the full width there.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../lib/strings";
import { apiErrorText } from "../lib/api-error";
import { useDocumentTitle } from "../lib/use-document-title";
import { useAuth } from "../state/auth";
import { useLocale } from "../state/locale";
import type { LangPref } from "../state/locale";
import { useTheme } from "../state/theme";
import type { ThemeMode } from "../state/theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PasswordInput } from "../components/ui/password-input";
import { JiuMateLogo } from "../components/ui/jiumate-logo";
import { Segmented } from "../components/ui/segmented";
import { WatchFigures } from "./login-figures";

export function LoginPage() {
  useDocumentTitle(S.auth.login);
  const { login } = useAuth();
  const { mode, setMode } = useTheme();
  const { lang, setLang } = useLocale();
  const navigate = useNavigate();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  // Per-field required errors sit next to their input; `form` holds the auth failure (wrong user/password), which isn't specific to one field.
  const [errors, setErrors] = useState<{ userId?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  /**
   * Whether the watchers are looking at the form, and whether they are startled.
   *
   * Derived from the fields on every render rather than stored: `surprised` in particular is a
   * momentary reaction to one click, and holding it in state would need a timer to clear it and a
   * cleanup to cancel that timer. The click that triggers it also sets a field error, which
   * re-renders — so the reaction lasts exactly as long as the mistake is on screen, and stops on
   * its own the moment the user starts typing.
   */
  const [startled, setStartled] = useState(false);
  const clearErrors = () => setErrors((p) => (p.userId || p.password || p.form ? {} : p));

  const usernameTyped = userId.trim() !== "";
  const passwordTyped = password.trim() !== "";

  const submit = async () => {
    const next: { userId?: string; password?: string } = {};
    if (!userId.trim()) next.userId = S.common.requiredField;
    if (!password) next.password = S.common.requiredField;
    if (next.userId || next.password) {
      setErrors(next);
      // Both fields empty and nothing typed: the watchers gape. See the note on `startled`.
      setStartled(userId.trim() === "" && password.trim() === "");
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await login(userId.trim(), password);
      navigate("/chat", { replace: true });
    } catch (e) {
      setErrors({ form: apiErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const themeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "light", label: S.settings.themeLight },
    { value: "dark", label: S.settings.themeDark },
    { value: "system", label: S.settings.followSystem },
  ];
  const langOptions: ReadonlyArray<{ value: LangPref; label: string }> = [
    { value: "en", label: S.settings.langEn },
    { value: "zh", label: S.settings.langZh },
    { value: "system", label: S.settings.followSystem },
  ];

  return (
    <div className="flex min-h-full w-full items-center justify-center bg-gray-100 p-0 dark:bg-gray-950 lg:p-6">
      {/*
        The card. `h-full` on small screens, a capped 600px on desktop.

        The cap matters: a fixed 600px card is taller than a 1366×768 laptop's usable height once
        the padding is added, and the outer row centres rather than clips — so the top and bottom
        of the card (and the form fields inside it) fall off the screen. `max-h-full` lets the card
        shrink to whatever is actually available, and `min-h-0` on the row above it is what lets
        that shrink happen at all (a flex item's default min-height is its content's).

        The figures take their height from here as a percentage (see login-figures.tsx), so
        shrinking the card shrinks them with it rather than cropping them.
      */}
      <div className="flex h-full min-h-0 w-full max-w-5xl overflow-hidden lg:h-[600px] lg:max-h-full lg:rounded-2xl lg:bg-white lg:shadow-lg lg:shadow-black/5 dark:lg:bg-gray-900 dark:lg:shadow-black/40">
        {/* The watchers. Half the card on desktop, hidden below lg — see the header note. */}
        <div className="min-w-0 flex-1">
          <WatchFigures
            usernameTyped={usernameTyped}
            passwordTyped={passwordTyped}
            surprised={startled}
          />
        </div>

        {/* The form column. `overflow-y-auto` so a short window scrolls the form rather than
            clipping it: the panel is fixed-height, and the fields are the part that must stay
            reachable. */}
        <div className="flex w-full min-w-0 flex-col justify-center overflow-y-auto px-6 py-8 sm:px-10 lg:w-1/2 lg:shrink-0 lg:px-12 lg:py-10">
          {/* Language / theme: top-right on desktop, above the form on narrow screens. */}
          <div className="mb-8 flex items-center justify-end gap-2">
            <div aria-label={S.settings.language}>
              <Segmented options={langOptions} value={lang} onChange={setLang} />
            </div>
            <div aria-label={S.settings.mode}>
              <Segmented options={themeOptions} value={mode} onChange={setMode} />
            </div>
          </div>

          {/* Brand jiumate logo, then the title. */}
          <JiuMateLogo className="mx-auto mb-3 h-14 w-14 rounded-2xl" />
          <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight">{S.appName}</h1>
          <p className="mb-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {S.auth.loginSubtitle}
          </p>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              label={S.common.username}
              required
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                clearErrors();
                // Typing is the user answering the question the error row asked, so the
                // watchers stop gaping the moment there is something to look at.
                setStartled(false);
              }}
              error={errors.userId}
              autoComplete="username"
              autoFocus
            />
            <PasswordInput
              label={S.auth.password}
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearErrors();
                setStartled(false);
              }}
              error={errors.password}
              autoComplete="current-password"
            />
            {errors.form && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                {errors.form}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center py-2.5 text-sm font-semibold"
              disabled={busy}
            >
              {S.auth.login}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
            {S.auth.defaultAdminNote}
          </p>
          <p className="mt-1.5 text-center text-xs text-gray-400 dark:text-gray-500">
            {S.auth.forgotAdminNote}
          </p>
        </div>
      </div>
    </div>
  );
}