/**
 * End-to-end regression for the in-place Markdown editor in the Files panel. A session is
 * seeded with a small `.md` file via the existing PUT /files/content API; opening the file,
 * switching to Edit, replacing content and clicking Save must persist the new bytes through
 * PUT and re-fetch them in the rendered view. Then clicking Edit again and using the
 * keyboard shortcut Ctrl-S performs the same save round-trip — the two paths share the
 * same `doSave` handler so the spec covers the alternative input.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "e2eworkedit";
const P = "password123";

const SEED_CONTENT = "# Original heading\n\nOriginal body.\n";
const EDITED_CONTENT = "# Edited heading\n\nEdited body line one.\nEdited body line two.\n";
const CTRL_S_CONTENT = "# Ctrl-S heading\n\nSaved through the keyboard shortcut.\n";

async function seedSessionAndOpen(page, fileContent) {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const sid = (
    await (
      await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
        data: {},
      })
    ).json()
  ).session.sessionId;
  const b64 = Buffer.from(fileContent, "utf8").toString("base64");
  const up = await page.request.put(`${BASE}/api/sessions/${sid}/files/content?path=notes.md`, {
    data: { dataBase64: b64 },
  });
  expect(up.ok(), "upload md").toBeTruthy();
  await page.goto(`${BASE}/chat/${sid}`);
  return sid;
}

test("edit + save in the Files panel persists the bytes and re-renders the new content", async ({
  page,
}) => {
  const sid = await seedSessionAndOpen(page, SEED_CONTENT);

  // Open the workspace dock, pick Files, open the .md file from the list.
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  await expect(page.getByRole("button", { name: "返回列表" })).toHaveCount(0);
  await page.getByRole("button", { name: "notes.md" }).click();

  // The rendered Markdown shows the seeded heading.
  await expect(page.getByRole("heading", { name: "Original heading" })).toBeVisible();

  // Toggle to Edit; the toggle pill lives in the preview toolbar (Rendered | Source | Edit).
  await page.getByRole("button", { name: "编辑", exact: true }).click();

  // CodeMirror mounts lazily; the editor's contenteditable surface is the sign it landed.
  const editor = page.locator(".cm-content");
  await editor.waitFor();

  // Replace content: select-all + type replaces the existing document. CodeMirror treats
  // `Meta+A` / `Control+A` as select-line; backspace empties, then typing lays down the new bytes.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(EDITED_CONTENT);

  // Save through the action bar.
  await page.getByRole("button", { name: "保存" }).click();

  // The toast confirms the upload (reusing S.files.uploaded: "已上传").
  await expect(page.getByText("已上传")).toBeVisible();

  // #40: save keeps the user in edit mode — the saved bytes are visible only after they
  // explicitly switch to the rendered view. Manual toggle must show just-saved content in
  // real time (#40 second half) — so the same bytes the user typed are what they get.
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edited heading" })).toBeVisible();

  // The new bytes are durably on disk: re-fetch via the file URL and decode.
  const fetched = await page.request.get(`${BASE}/api/sessions/${sid}/files/content?path=notes.md`);
  expect(fetched.ok(), "re-fetch file").toBeTruthy();
  const body = await fetched.text();
  expect(body).toBe(EDITED_CONTENT);
});

test("Mod-S saves the draft through the same path as the Save button", async ({ page }) => {
  const sid = await seedSessionAndOpen(page, SEED_CONTENT);

  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  await page.getByRole("button", { name: "notes.md" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();

  const editor = page.locator(".cm-content");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(CTRL_S_CONTENT);

  // The keymap runs inside CodeMirror; the global `ControlOrMeta+S` Playwright sends to the
  // page is consumed by CodeMirror's keymap (preventDefault: true), which calls onSave.
  await page.keyboard.press("ControlOrMeta+S");
  await expect(page.getByText("已上传")).toBeVisible();

  // #40: Mod-S keeps the user in edit mode. The user toggles to rendered to see the bytes
  // they just saved — same expectation as the toolbar Save branch.
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ctrl-S heading" })).toBeVisible();

  const fetched = await page.request.get(`${BASE}/api/sessions/${sid}/files/content?path=notes.md`);
  expect(fetched.ok(), "re-fetch file").toBeTruthy();
  expect(await fetched.text()).toBe(CTRL_S_CONTENT);
});

/**
 * Conflict detection: the Agent rewrites the same .md file after the user opened the editor
 * but before they hit Save. PUT carries an If-Match derived from the GET's ETag, which is
 * stale, so the server returns 409 file_conflict. The modal must surface; picking "Reload"
 * discards the draft and shows the Agent's new bytes; picking "Save anyway" re-PUTs without
 * If-Match and overwrites. The two outcomes are asserted end-to-end against the file URL.
 */
test("concurrent Agent write: editor's save is rejected with 409 and the modal resolves correctly", async ({
  page,
}) => {
  const sid = await seedSessionAndOpen(page, SEED_CONTENT);

  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  await page.getByRole("button", { name: "notes.md" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();

  const editor = page.locator(".cm-content");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("# User's edit in progress\n");

  // Simulate the Agent landing a new write to the same path while the user is still editing:
  // bumping the file's mtime means the If-Match the editor captured at read time is now stale,
  // and the server will reject the save. Goes through the same API the Agent's exec tools use,
  // so the spec exercises the real 409 path, not a mocked stub.
  const AGENT_CONTENT = "# Agent's new content\n";
  const agentPut = await page.request.put(
    `${BASE}/api/sessions/${sid}/files/content?path=notes.md`,
    { data: { dataBase64: Buffer.from(AGENT_CONTENT, "utf8").toString("base64") } },
  );
  expect(agentPut.ok(), "agent PUT").toBeTruthy();

  // The editor's Save click should now surface the conflict modal — the modal's primary and
  // secondary buttons (Edit / Save) reuse the same Chinese strings as the toolbar pills, so
  // scope locators to the dialog via its aria-label (set by Modal from `title` = the i18n
  // string `S.files.editConflictBanner` from strings.ts).
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const conflictDialog = page.locator('[role="dialog"][aria-label*="修改"]');
  await expect(conflictDialog).toBeVisible();

  // First branch: Reload (primary). Drops the draft, exits edit mode, re-fetches the file,
  // renders the Agent's bytes. The file on disk matches the Agent's PUT, NOT the user's draft.
  await conflictDialog.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent's new content" })).toBeVisible();
  // Draft is gone: re-opening Edit starts from the on-disk content, not the typed string.
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await editor.waitFor();
  await expect(editor).toContainText("Agent's new content");
  await expect(editor).not.toContainText("User's edit in progress");

  const fetched = await page.request.get(`${BASE}/api/sessions/${sid}/files/content?path=notes.md`);
  expect(await fetched.text()).toBe(AGENT_CONTENT);
});

test("concurrent Agent write + Save anyway: force-save overwrites the Agent's bytes", async ({
  page,
}) => {
  const sid = await seedSessionAndOpen(page, SEED_CONTENT);

  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  await page.getByRole("button", { name: "notes.md" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();

  const editor = page.locator(".cm-content");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("# Force-saved user content\n");

  const AGENT_CONTENT = "# Agent wrote this first\n";
  await page.request.put(`${BASE}/api/sessions/${sid}/files/content?path=notes.md`, {
    data: { dataBase64: Buffer.from(AGENT_CONTENT, "utf8").toString("base64") },
  });

  await page.getByRole("button", { name: "保存", exact: true }).click();
  const conflictDialog = page.locator('[role="dialog"][aria-label*="修改"]');
  await expect(conflictDialog).toBeVisible();

  // Secondary branch: "Save anyway" — secondaryLabel is S.files.editSave ("保存"). Re-PUTs
  // without If-Match so the server lets the write through. The user's draft must end up on disk.
  await conflictDialog.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page.getByText("已上传")).toBeVisible();
  // #40: force-save keeps the user in edit mode; switch to rendered to inspect.
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Force-saved user content" })).toBeVisible();

  const fetched = await page.request.get(`${BASE}/api/sessions/${sid}/files/content?path=notes.md`);
  expect(await fetched.text()).toBe("# Force-saved user content\n");
});
