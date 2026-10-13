/**
 * 快捷调用的预选，必须真的到达输入框。
 *
 * **这是一个断了两处的 bug**，两处都在"读取时机"上，而不是逻辑上：
 *
 * 1. `draft-view` 在首次渲染时读草稿缓存，而那一刻 `AuthProvider` 的 `user` 还是 undefined
 *    （它由 `GET /api/me` 异步填），于是 `userId` 为 null、缓存读作空对象、`skillsRef` 是空的。
 * 2. 紧接着挂载时的 `persistNow()` 把这个空值写回草稿——**把快捷调用刚写进去的预选抹掉了**。
 *
 * 用户点了一个专门用来"填好输入框"的按钮，落到一个空输入框上。
 *
 * 两处都有注释声称防住了它（`skillsPruneReady`、`agentSkills` 的空数组），但都只防了
 * **剪枝**这一半，没防 **读取过早**那一半——剪枝发生在读取正确之后，而读取本身已经是错的了。
 *
 * 这些断言读源码，因为要抓的是"读得太早"这种时序结构，渲染不出来。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

const draftView = src("features", "chat", "draft-view.tsx");
const chatInput = src("features", "chat", "chat-input.tsx");

describe("quick invoke's preselection reaches the composer", () => {
  it("waits for userId before reading the cache", () => {
    // The whole fix. Reading on mount produced an empty cache on every fresh page load.
    expect(draftView).toMatch(
      /const \[cached, setCached\] = useState<DraftCache \| undefined>\(undefined\)/,
    );
    expect(draftView).toContain("if (!userId) return;");
  });

  it("seeds the skills ref from the cache, not from a useRef argument evaluated too early", () => {
    // `useRef(cached.skills ?? [])` evaluates its argument on the first render, before the cache
    // has been read — which is how the preselection was lost even after the read was fixed.
    expect(draftView).not.toMatch(/useRef<\[?string\[\]?\]>\(cached/);
    expect(draftView).toContain("skillsRef.current = c.skills ?? []");
  });

  it("remounts the composer once the cache lands, because initialSkills is read only on mount", () => {
    // `useState<string[]>(initialSkills ?? [])` is a one-time read. A prop that arrives afterwards
    // is never seen, so the key is what actually delivers the pre-selection.
    expect(chatInput).toContain("useState<string[]>(initialSkills ?? [])");
    expect(draftView).toContain('key={appliedCache ? "ready" : "unread"}');
  });

  it("applies the cache exactly once", () => {
    // Every render would otherwise re-seed from a cache the user has since changed by typing.
    expect(draftView).toContain("if (cached === undefined || appliedCache) return;");
  });

  it("does not let the mount-time persist overwrite the cache it just read", () => {
    // `persistNow` rebuilds the whole DraftCache from component state. Before the fix, that state
    // was still empty, so the mount-time write erased what quick-invoke had written. The guard is
    // that the state is seeded first — which the assertions above cover; this one pins that the
    // write still exists and therefore the ordering is load-bearing.
    expect(draftView).toContain("const data: DraftCache = { text: textRef.current");
    expect(draftView).toContain(
      "if (skillsRef.current.length > 0) data.skills = skillsRef.current;",
    );
  });
});
