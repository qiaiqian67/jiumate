/**
 * General page of System settings: per-account preferences that are neither appearance nor
 * credentials. Everything applies the moment it is touched — the stores persist each value
 * (language and currency per browser) — so the page carries no Save button and no draft
 * state to lose. Application-level preferences (Petdex desktop pet, …) live on their own
 * page, opened via the rail.
 */
import { S } from "../../lib/strings";
import { Segmented } from "../../components/ui/segmented";
import { useLocale } from "../../state/locale";
import type { LangPref } from "../../state/locale";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { useChatFontSize } from "../../state/chat-font-size";
import type { ChatFontSize } from "../../lib/chat-font-size";
import { PrefRow } from "./setting-row";
import { TraceImportRow } from "./trace-import-row";

export function GeneralSection() {
  const { lang, setLang } = useLocale();
  const { currency, setCurrency } = useTheme();
  const fontSize = useChatFontSize();

  const langOptions: ReadonlyArray<{ value: LangPref; label: string }> = [
    { value: "en", label: S.settings.langEn },
    { value: "zh", label: S.settings.langZh },
    { value: "system", label: S.settings.followSystem },
  ];
  const currencyOptions: ReadonlyArray<{ value: Currency; label: string }> = [
    { value: "USD", label: S.models.currencyUsd },
    { value: "CNY", label: S.models.currencyCny },
  ];
  // 聊天正文字号：与外观页的「字号」是两个独立设置，所以放在通用（阅读偏好）而不是
  // 外观（界面缩放）。外观那套改的是 html 根字号、整个界面一起变大；这个只改对话正文里
  // 的 Markdown（--chat-font-size），两者并存、互不影响。
  const fontSizeOptions: ReadonlyArray<{ value: ChatFontSize; label: string }> = [
    { value: "small", label: S.settings.chatFontSmall },
    { value: "medium", label: S.settings.chatFontMedium },
    { value: "large", label: S.settings.chatFontLarge },
  ];

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow label={S.settings.language} info={S.settings.languageInfo}>
        <Segmented options={langOptions} value={lang} onChange={setLang} />
      </PrefRow>
      <PrefRow label={S.models.currency} info={S.settings.currencyInfo}>
        <Segmented options={currencyOptions} value={currency} onChange={setCurrency} cols={2} />
      </PrefRow>
      <PrefRow label={S.settings.chatFontSize} info={S.settings.chatFontSizeInfo}>
        <Segmented
          options={fontSizeOptions}
          value={fontSize.value}
          onChange={fontSize.set}
          cols={3}
        />
      </PrefRow>
      <TraceImportRow />
    </div>
  );
}
