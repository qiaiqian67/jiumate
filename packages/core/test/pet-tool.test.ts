/**
 * The `pet` tool: it owns no state, so every case here is about what it does with the port
 * its host injected — including the host that has none.
 */
import { describe, expect, it } from "vitest";
import { PET_NAME, createPetTool, renderPetSnapshot } from "../src/environment/tools/pet.js";
import type {
  PetControlPort,
  PetControlSnapshot,
  ToolDefinitionConfig,
} from "../src/interfaces/index.js";

const DEFINITION: ToolDefinitionConfig = {
  name: PET_NAME,
  description: "test",
  parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
};

const SNAPSHOT: PetControlSnapshot = {
  enabled: true,
  activePetId: "blue-golden",
  pets: [
    { id: "blue-golden", displayName: "困困", source: "preset" },
    { id: "my-cat", displayName: "My Cat", source: "user" },
  ],
};

/** Drives the tool and collects the text it streamed plus its stop reason. */
async function run(
  args: Record<string, unknown>,
  port?: PetControlPort,
): Promise<{ text: string; stopReason: string | undefined }> {
  const tool = createPetTool(DEFINITION, port);
  const chunks: string[] = [];
  const generator = tool.execute(args, { workspaceDir: "/tmp", toolCallId: "call-1" });
  for (;;) {
    const next = await generator.next();
    if (next.done) {
      return { text: chunks.join(""), stopReason: next.value?.stopReason };
    }
    const payload = next.value.payload as { output?: string };
    if (typeof payload.output === "string") chunks.push(payload.output);
  }
}

function stubPort(overrides: Partial<PetControlPort> = {}): PetControlPort {
  return {
    list: async () => SNAPSHOT,
    setActivePet: async () => SNAPSHOT,
    setEnabled: async () => SNAPSHOT,
    ...overrides,
  };
}

describe("renderPetSnapshot", () => {
  it("names the active pet and marks it in the list", () => {
    const text = renderPetSnapshot(SNAPSHOT);
    expect(text).toContain("Desktop pet window: shown.");
    expect(text).toContain("Active pet: 困困 (id: blue-golden, preset).");
    expect(text).toContain("- My Cat (id: my-cat, user)");
    expect(text).toContain("- 困困 (id: blue-golden, preset) *");
  });

  it("says so when the selection is not among the pets and when there are none", () => {
    expect(renderPetSnapshot({ ...SNAPSHOT, activePetId: "gone" })).toContain(
      "Active pet: none selected (2 available).",
    );
    expect(renderPetSnapshot({ ...SNAPSHOT, pets: [] })).toContain("No pets are available");
  });
});

describe("pet tool", () => {
  it("reports that the host has no pet surface when no port was injected", async () => {
    const { text, stopReason } = await run({ action: "list" });
    expect(text).toMatch(/no desktop pet surface/);
    expect(stopReason).toBe("fatal");
  });

  it("lists through the port", async () => {
    const { text, stopReason } = await run({ action: "list" }, stubPort());
    expect(text).toContain("Active pet: 困困");
    expect(stopReason).toBeUndefined();
  });

  it("requires pet_id for action=use and passes it through", async () => {
    const missing = await run({ action: "use" }, stubPort());
    expect(missing.text).toMatch(/pet_id/);
    expect(missing.stopReason).toBe("fatal");

    const seen: string[] = [];
    await run(
      { action: "use", pet_id: "my-cat" },
      stubPort({
        setActivePet: async (petId) => {
          seen.push(petId);
          return SNAPSHOT;
        },
      }),
    );
    expect(seen).toEqual(["my-cat"]);
  });

  it("maps show/hide onto the port's enabled flag", async () => {
    const seen: boolean[] = [];
    const port = stubPort({
      setEnabled: async (enabled) => {
        seen.push(enabled);
        return { ...SNAPSHOT, enabled };
      },
    });
    expect((await run({ action: "hide" }, port)).text).toContain("Desktop pet window: hidden.");
    expect((await run({ action: "show" }, port)).text).toContain("Desktop pet window: shown.");
    expect(seen).toEqual([false, true]);
  });

  it("refuses an unknown action without touching the port", async () => {
    let called = false;
    const { text, stopReason } = await run(
      { action: "delete-everything" },
      stubPort({
        list: async () => {
          called = true;
          return SNAPSHOT;
        },
      }),
    );
    expect(text).toMatch(/Unknown action/);
    expect(stopReason).toBe("fatal");
    expect(called).toBe(false);
  });

  it("surfaces a port failure as an explanatory tool failure, not a crash", async () => {
    const { text, stopReason } = await run(
      { action: "use", pet_id: "nope" },
      stubPort({
        setActivePet: async () => {
          throw new Error('No pet with id "nope" is available.');
        },
      }),
    );
    expect(text).toBe('No pet with id "nope" is available.');
    expect(stopReason).toBe("fatal");
  });
});
