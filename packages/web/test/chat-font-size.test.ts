/**
 * 阅读字号偏好的单元测试（lib/chat-font-size.ts）。
 *
 * 这条偏好读写的只有一个值，但有三件事一旦出错就很难察觉，所以逐条钉住：
 *
 * 1. **未知值必须退回默认**。旧版本留下的、或用户手改的字符串若被直接采信，页面会拿到
 *    一个 CSS 变量值之外的字体尺寸——而且不报错，只是悄悄显示成别的字号。
 * 2. **medium 必须等于 16px**，也就是 `text-base` 原本解析出的值。默认档位渲染出和改动
 *    之前一模一样的字号，这条断言是它的证据。
 * 3. **存储访问必须 try/catch**。这个函数从 useState 初始化器里跑，而"仅仅访问
 *    localStorage"在站点数据被禁用（或分区 iframe）时就会抛 SecurityError——异常逃出去
 *    会直接打掉聊天页的首次渲染。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHAT_FONT_PX,
  CHAT_FONT_SIZE_KEY,
  CHAT_FONT_SIZES,
  applyChatFontSize,
  chatFontSizeVar,
  loadChatFontSize,
  storeChatFontSize,
  type ChatFontSize,
  type ChatFontSizeStorage,
} from "../src/lib/chat-font-size";
// 字号的三档名住在 S.settings 下（与语言、货币相邻），不是 S.chat —— 用别名区分，
// 免得读起来像是从聊天页取的。
import { zh as zhSettings } from "../src/lib/strings";
import { en as enSettings } from "../src/lib/strings-en";

const src = (p: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");

/** 每档对应的本地化字段名（chat 前缀，与外观页的 fontSmall/fontMedium/fontLarge 区分）。 */
const labelKey: Record<
  ChatFontSize,
  "chatFontSmall" | "chatFontMedium" | "chatFontLarge"
> = {
  small: "chatFontSmall",
  medium: "chatFontMedium",
  large: "chatFontLarge",
};

/** 内存存储（vitest 跑在 Node 环境，没有 localStorage）。 */
function memStorage(): ChatFontSizeStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("CHAT_FONT_PX", () => {
  it("medium 恰好是 16px，也就是 text-base 原本的值", () => {
    // 默认档位必须与改动之前渲染结果完全一致——否则"加个字号设置"这件事在默认状态下
    // 就悄悄改掉了所有人的正文大小。
    expect(CHAT_FONT_PX.medium).toBe(16);
  });

  it("三档严格递增，且都是正整数 px", () => {
    // 递增保证控件上的选择顺序有意义；正整数保证 CSS 变量值合法。
    expect(CHAT_FONT_PX.small).toBeLessThan(CHAT_FONT_PX.medium);
    expect(CHAT_FONT_PX.medium).toBeLessThan(CHAT_FONT_PX.large);
    for (const px of Object.values(CHAT_FONT_PX)) {
      expect(Number.isInteger(px)).toBe(true);
      expect(px).toBeGreaterThan(0);
    }
  });
});

describe("loadChatFontSize / storeChatFontSize", () => {
  it("什么都没存时是 medium，且读取不写入", () => {
    const s = memStorage();
    expect(loadChatFontSize(s)).toBe("medium");
    expect(s.map.size).toBe(0);
  });

  it("写入 → 新的一次读取恢复该档位", () => {
    const s = memStorage();
    for (const size of CHAT_FONT_SIZES) {
      storeChatFontSize(size, s);
      expect(s.map.get(CHAT_FONT_SIZE_KEY)).toBe(size);
      expect(loadChatFontSize(s)).toBe(size);
    }
  });

  it("未知/被篡改的值退回 medium，而不是被采信", () => {
    // 这是"静默显示成别的字号"最容易发生的地方：往 localStorage 里塞一个旧版本名或
    // 手滑的 "big"，页面不会报错，只是悄悄不听话。
    const s = memStorage();
    for (const raw of ["", "big", "LARGE", "16px", "medium ", "null", "3"]) {
      s.map.set(CHAT_FONT_SIZE_KEY, raw);
      expect(loadChatFontSize(s), raw).toBe("medium");
    }
  });

  it("存储抛错（配额/隐私模式）：写入不抛，读取得到默认值", () => {
    const broken: ChatFontSizeStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => storeChatFontSize("large", broken)).not.toThrow();
    expect(loadChatFontSize(broken)).toBe("medium");
  });

  it("getter 本身就抛错（站点数据被禁用）时不逃出调用方", () => {
    // 关键场景：这个函数从 useState 初始化器调用，"仅仅访问 localStorage"在站点数据被
    // 禁用时就会抛 SecurityError，异常逃出去会打掉聊天页的首次渲染。
    const hostile = {
      get getItem(): never {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as ChatFontSizeStorage;
    expect(() => loadChatFontSize(hostile)).not.toThrow();
    expect(loadChatFontSize(hostile)).toBe("medium");
  });
});

describe("applyChatFontSize", () => {
  it("写入 --chat-font-size，值带 px", () => {
    const setProperty = (..._args: string[]) => undefined;
    let captured: [string, string] | null = null;
    applyChatFontSize("large", {
      style: { setProperty: (k: string, v: string) => void (captured = [k, v]) },
    });
    expect(captured).toEqual(["--chat-font-size", "18px"]);
  });

  it("md-body 读的就是这个变量，且 :root 有默认兜底", () => {
    // 三处必须对上：组件写、.md-body 读、:root 兜底。少任何一处，用户存了「大」却在
    // 某些页面上看到 16px——而这类"部分生效"最难自查。
    const css = src("../src/styles.css");
    expect(css).toContain("--chat-font-size: 16px");
    expect(css).toMatch(/\.md-body \{[^}]*font-size: var\(--chat-font-size\)/);
    expect(src("../src/state/chat-font-size.ts")).toContain(
      "applyChatFontSize(value, document.documentElement)",
    );
  });

  it("代码块不随阅读字号缩放", () => {
    // 缩放代码块是错的：等宽源码在 18px 下会换行成难读的散文，而它是"内容"里的
    // "另一种东西"，读者放大正文不等于想放大代码。
    const css = src("../src/styles.css");
    const mdBody = css.slice(css.indexOf(".md-body {"), css.indexOf("}", css.indexOf(".md-body {")));
    expect(mdBody).not.toContain("pre");
  });
});

describe("控件的位置", () => {
  it("在系统设置 → 个人 → 通用，不在聊天页", () => {
    // 字号是应用级的阅读偏好，不是"这一屏对话"的工具。聊天页工具栏上的每一个控件都作用
    // 于当前这一个会话（撤回、重新生成、面板开合），把一个跨会话、跨路由的设置塞在那里，
    // 读起来像是只对这段对话生效。
    const general = src("../src/features/settings/general-section.tsx");
    expect(general).toContain("S.settings.chatFontSize");
    expect(general).toContain("fontSizeOptions");

    // 聊天页里必须已经没有它了。
    expect(src("../src/features/chat/chat-page.tsx")).not.toContain("ChatFontSizeMenu");
  });

  it("照语言/货币的 Segmented 模式排布，不自造控件", () => {
    // 通用页里已有的语言、货币都是 PrefRow + Segmented：一个可点即生效、无需保存的偏好。
    // 字号是同一种东西，套同一个模式比引入第二种控件样式更一致。
    const general = src("../src/features/settings/general-section.tsx");
    expect(general).toContain("value={fontSize.value}");
    expect(general).toContain("onChange={fontSize.set}");
    expect(general).toContain("cols={3}");
    // 它紧跟货币、排在 TraceImportRow 之前，与另两个 per-account 偏好相邻。
    const at = general.indexOf("fontSizeOptions}");
    expect(at).toBeGreaterThan(general.indexOf("currencyOptions"));
    expect(at).toBeLessThan(general.indexOf("<TraceImportRow />"));
  });

  it("与外观页的界面字号是两个独立设置，互不影响", () => {
    // 外观页那一套（fontSize / fontSmall… / jiumate.fontScale）改的是 html 根字号，整个
    // 界面一起缩放；这个只改对话正文里的 Markdown（--chat-font-size）。两者并存、各管各的，
    // 所以这里断言它们**都存在**且不共用键与字段名——把它们合并或互相覆盖才是 bug。
    const appearance = src("../src/features/settings/appearance-section.tsx");
    expect(appearance).toContain("S.settings.fontSize");
    expect(appearance).toContain("S.settings.fontSmall");
    // 外观页不认识聊天字号。
    expect(appearance).not.toContain("chatFontSize");
    expect(appearance).not.toContain("chat-font-size");

    // 存储键不同：改一个不会连带另一个。
    const scope = src("../src/lib/install-scope.ts");
    expect(scope).toContain("jiumate.chatFontSize");
    expect(src("../src/state/theme.tsx")).toContain('"jiumate.fontScale"');
    // CSS 写入点不同：根字号 vs 自定义属性。
    expect(src("../src/state/theme.tsx")).toContain(
      "document.documentElement.style.fontSize",
    );
    expect(src("../src/state/chat-font-size.ts")).toContain("--chat-font-size");
  });

  it("两套的字面值也各不相干（外观 16/18/20，聊天 14/16/18）", () => {
    // 档位不同是刻意的：界面缩放要跟着整体密度走，聊天正文只需要覆盖"能不能看清一段话"。
    // 共享一套刻度会让"小"在两处含义不同，那比数值不同更难解释。
    const theme = src("../src/state/theme.tsx");
    expect(theme).toContain('{ sm: "16px", md: "18px", lg: "20px" }');
    expect(CHAT_FONT_PX).toEqual({ small: 14, medium: 16, large: 18 });
  });

  it("三档与本地化名一一对应，且三档名字互不相同", () => {
    const zhNames: string[] = [];
    for (const size of CHAT_FONT_SIZES) {
      expect(chatFontSizeVar(size), size).toMatch(/^\d+px$/);
      expect(zhSettings.settings[labelKey[size]], `zh ${size}`).toBeTruthy();
      expect(enSettings.settings[labelKey[size]], `en ${size}`).toBeTruthy();
      zhNames.push(zhSettings.settings[labelKey[size]]);
    }
    // 三档的名字必须两两互不相同，否则用户看不出自己选到了哪一档。
    expect(new Set(zhNames).size).toBe(zhNames.length);
  });
});

describe("偏好常驻", () => {
  it("挂在应用根，而不是设置页", () => {
    // 设置页不是常驻的，而正文在聊天页那棵树里。若只在设置页挂载时应用一次，那么
    // "改完设置 → 关掉设置 → 从别的入口进聊天"时，正文会退回 CSS 兜底的 16px，
    // 尽管 localStorage 里存着「大」。这条断言钉住常驻位置。
    expect(src("../src/app.tsx")).toContain("<ChatFontSizeScope />");
    expect(src("../src/features/settings/general-section.tsx")).not.toContain(
      "ChatFontSizeScope",
    );
  });

  it("切档时既写存储也立刻生效", () => {
    // 只写存储不立刻应用 = 点击后要等下一次挂载才生效，用户会以为点击没反应；
    // 只应用不写存储 = 刷新后丢失选择。两条都要在。
    const state = src("../src/state/chat-font-size.ts");
    expect(state).toContain("storeChatFontSize(size)");
    expect(state).toContain("applyChatFontSize(value, document.documentElement)");
  });
});