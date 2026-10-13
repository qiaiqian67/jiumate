/**
 * 快捷调用的预选，不会被随后到达的技能列表剪掉。
 *
 * **这条链上断过三次**，前两次修的是真问题但都不够：
 *
 *   1. `userId` 到达前就读缓存 → 缓存读成空
 *   2. `initialSkills` 只在挂载读一次 → 传得太晚看不见
 *   3. **这次**：route state 把同一个 Agent 又 set 了一次 → 技能列表重新拉取 → 剪枝把胶囊剪掉
 *
 * 第 3 步是这样的：`quickInvoke` 把 Agent 同时写进草稿**并**通过 route state 传过去，而 route
 * state 优先级高于缓存。于是**在用户碰任何东西之前，Agent 被设了两次**，技能列表也就更新了两次。
 * 原来的守卫是"跳过第一次 tick"——已经被第一次用掉了。
 *
 * **这个测试跑的是行为，不是源码形状。** 前两轮的测试都断言"某行存在"，而那两行确实存在、也确实
 * 是真 bug，修完之后没有任何可见变化。断言源码形状无法区分"改对了"和"改到了会执行的代码"。
 *
 * 所以这里把剪枝的两个 effect 原样实现一遍，用脚本喂事件序列，看选中项最后还在不在——
 * 并且**先拿旧版实现跑同一个序列**，确认它确实会失败。旧实现通过就说明这个模拟没复现出问题，
 * 那么新实现通过也说明不了什么。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

const chatInput = src("features", "chat", "chat-input.tsx");
const draftView = src("features", "chat", "draft-view.tsx");

type Ev =
  | { type: "select"; names: string[] }
  | { type: "skills"; list: string[] }
  | { type: "agent"; id: string | null };

/** The current implementation, transcribed from chat-input.tsx. */
function simulateCurrent(events: Ev[]): string[] {
  const skillsPruned = { current: false };
  const lastPrunedAgent: { current: string | null } = { current: "default_agent" };
  let selected = ["humanizer"];
  const prune = (skills: string[]): void => {
    if (skillsPruned.current) return;
    if (skills.length === 0) return;
    skillsPruned.current = true;
    selected = selected.filter((n) => skills.includes(n));
  };
  const rearm = (id: string | null): void => {
    const v = id ?? null;
    if (v === lastPrunedAgent.current) return;
    lastPrunedAgent.current = v;
    skillsPruned.current = false;
  };
  for (const ev of events) {
    if (ev.type === "skills") prune(ev.list);
    else if (ev.type === "agent") rearm(ev.id);
    else selected = ev.names;
  }
  return selected;
}

/** The implementation before this change: skip the first tick, whatever it is. */
function simulateOld(events: Ev[]): string[] {
  const ready = { current: false };
  let selected = ["humanizer"];
  const prune = (skills: string[]): void => {
    if (!ready.current) {
      ready.current = true;
      if (skills.length === 0) return;
    }
    selected = selected.filter((n) => skills.includes(n));
  };
  for (const ev of events) {
    if (ev.type === "skills") prune(ev.list);
    else if (ev.type === "select") selected = ev.names;
  }
  return selected;
}

const LIST = ["humanizer", "data-analysis"];
const OTHER_AGENT_LIST = ["remote-claude-code"];

/** What quick-invoke actually produces, in order: the draft seeds the selection, and the Agent
 *  refetch then delivers a list that does not contain it — because route state pointed the composer
 *  at a different Agent than the one the cache was written for. */
const QUICK_INVOKE: Ev[] = [
  { type: "select", names: ["humanizer"] }, // applyCached seeds skillsRef
  { type: "skills", list: [] }, // first render: agentSkills = []
  { type: "skills", list: LIST }, // fetch lands for the route-state Agent
  { type: "skills", list: [] }, // parent clears before refetching
  { type: "skills", list: OTHER_AGENT_LIST }, // refetch lands; the first prune tick is already spent
];

const AGENT_SWITCH: Ev[] = [
  { type: "select", names: ["humanizer"] },
  { type: "skills", list: LIST },
  { type: "agent", id: "cc" }, // the user switches Agent
  { type: "skills", list: [] },
  { type: "skills", list: OTHER_AGENT_LIST }, // cc has no humanizer
];

describe("the preselection survives the updates that follow it", () => {
  it("would have failed before this change — otherwise this test proves nothing", () => {
    // The load-bearing assertion. If the old implementation also survived, the simulation is not
    // reproducing the failure and every "PASS" below would be meaningless.
    expect(simulateOld(QUICK_INVOKE)).toEqual([]);
  });

  it("keeps the pill through the quick-invoke sequence", () => {
    expect(simulateCurrent(QUICK_INVOKE)).toEqual(["humanizer"]);
  });

  it("still prunes a skill the newly selected Agent does not have", () => {
    // The case the effect exists for; a guard that simply never prunes would pass the test above.
    expect(simulateCurrent(AGENT_SWITCH)).toEqual([]);
  });

  it("does not re-set an Agent that route state merely repeats", () => {
    // The source of the extra list update: quick-invoke puts the Agent in the draft *and* in route
    // state, and setting it twice refetched the list for an Agent already selected.
    expect(draftView).toContain("if (agentId !== stateAgentId) setAgentId(stateAgentId);");
  });

  it("prunes on the first non-empty list rather than on the first tick", () => {
    expect(chatInput).toContain("skillsPruned");
    expect(chatInput).not.toContain("skillsPruneReady");
  });
});
