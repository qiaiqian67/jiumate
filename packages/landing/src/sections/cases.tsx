/**
 * Use-case gallery as switchable tabs — the RAG docs expert and the linsight sled
 * game under their condensed one-sentence prompts. Video entries use a matching
 * Linsight run as their poster; still-only entries show the finished product.
 * Tab order follows S.cases.tabs; CASE_STILLS is index-aligned with it. A tab may carry a `cost`
 * line (the RAG one does) — an emphasized token-cost hook under the caption.
 */
import { useState } from "react";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import type { Locale } from "../state/locale";
import { Section } from "../components/section";
import { BrowserFrame } from "../components/browser-frame";
import chatZhLight from "../assets/shots/chat-zh-light.webp";
import chatZhDark from "../assets/shots/chat-zh-dark.webp";
import chatEnLight from "../assets/shots/chat-en-light.webp";
import chatEnDark from "../assets/shots/chat-en-dark.webp";
import gameZhLight from "../assets/game-zh-light.webp";
import gameZhDark from "../assets/game-zh-dark.webp";
import gameEnLight from "../assets/game-en-light.webp";
import gameEnDark from "../assets/game-en-dark.webp";

type ShotSet = Record<Locale, { light: string; dark: string }>;

/** Theme- and locale-matched stills, index-aligned with S.cases.tabs. */
const CASE_STILLS: ShotSet[] = [
  {
    zh: { light: chatZhLight, dark: chatZhDark },
    en: { light: chatEnLight, dark: chatEnDark },
  },
  {
    zh: { light: gameZhLight, dark: gameZhDark },
    en: { light: gameEnLight, dark: gameEnDark },
  },
];

export function Cases() {
  const { locale } = useLocale();
  const tabs = S.cases.tabs;
  const [active, setActive] = useState(0);
  const tab = tabs[active] ?? tabs[0]!;
  const shots = (CASE_STILLS[active] ?? CASE_STILLS[0]!)[locale];

  return (
    <Section id="cases" eyebrow={S.cases.eyebrow} title={S.cases.title} subtitle={S.cases.subtitle}>
      <div
        role="tablist"
        aria-label={S.cases.eyebrow}
        className="flex flex-wrap justify-center gap-2"
      >
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              i === active
                ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <figure role="tabpanel" className="anim-fade mx-auto mt-8 max-w-5xl" key={tab.label}>
        <div className="mx-auto mb-5 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-left sm:w-fit sm:max-w-full sm:overflow-x-auto dark:border-gray-800 dark:bg-gray-900">
          <code className="font-mono text-[12px] leading-5 whitespace-pre-wrap text-gray-800 sm:text-[13px] sm:whitespace-nowrap dark:text-gray-200">
            <span className="mr-2 text-gray-400 select-none dark:text-gray-500">&gt;</span>
            {tab.prompt}
          </code>
        </div>
        <BrowserFrame>
          <img
            src={shots.light}
            alt={tab.caption}
            loading="lazy"
            className="block h-auto w-full dark:hidden"
          />
          <img
            src={shots.dark}
            alt={tab.caption}
            loading="lazy"
            className="hidden h-auto w-full dark:block"
          />
        </BrowserFrame>
        <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          {tab.caption}
        </figcaption>
        {tab.cost && (
          <p className="mt-2 text-center text-[13px] font-semibold text-brand-700 dark:text-brand-300">
            {tab.cost}
          </p>
        )}
      </figure>
    </Section>
  );
}
