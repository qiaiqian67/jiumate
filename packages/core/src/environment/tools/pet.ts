/**
 * pet — inspect and control the desktop pet (Petdex), a builtin tool implementation.
 *
 * The pet is a host surface, not a file: the floating pet window belongs to the desktop
 * app, and which pet is active is a user preference. So the tool owns no state and touches
 * no disk — it calls the `PetControlPort` its host injected (see EnvironmentServices), and
 * a host without a pet surface reports that control is unavailable rather than failing with
 * an errno.
 *
 * Scope is deliberately the safe half of what the reference implementation exposes:
 * listing, choosing among pets that are already available, and showing or hiding the
 * window. Importing a package from a path and deleting an installed one both write to disk,
 * so they stay with the user and the settings page.
 *
 * Docs: /docs/tools § "Built-in tools".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type {
  PetControlPort,
  PetControlSnapshot,
  ToolDefinitionConfig,
} from "../../interfaces/index.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant. */
export const PET_NAME = "pet";

/** Renders a snapshot as the tool's text output — the model reads this, so it names the active pet. */
export function renderPetSnapshot(snapshot: PetControlSnapshot): string {
  const lines: string[] = [];
  lines.push(`Desktop pet window: ${snapshot.enabled ? "shown" : "hidden"}.`);
  if (snapshot.pets.length === 0) {
    lines.push("No pets are available on this host.");
    return lines.join("\n");
  }
  const active = snapshot.pets.find((pet) => pet.id === snapshot.activePetId);
  lines.push(
    active === undefined
      ? `Active pet: none selected (${snapshot.pets.length} available).`
      : `Active pet: ${active.displayName} (id: ${active.id}, ${active.source}).`,
  );
  lines.push("Available pets:");
  for (const pet of snapshot.pets) {
    lines.push(
      `- ${pet.displayName} (id: ${pet.id}, ${pet.source})${pet.id === snapshot.activePetId ? " *" : ""}`,
    );
  }
  return lines.join("\n");
}

/**
 * pet builtin tool: `action` selects what to do; `pet_id` names the pet for `action: "use"`.
 * `definition` is replaced by Environment at construction time with the same-named entry
 * from ToolConfig.
 */
export function createPetTool(
  definition: ToolDefinitionConfig,
  port?: PetControlPort,
): BuiltinTool {
  return {
    name: definition.name,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId: ctx.toolCallId });

      if (port === undefined) {
        yield delta(
          "This host has no desktop pet surface, so there is nothing to inspect or change.",
        );
        return { stopReason: "fatal" };
      }

      const action = typeof args["action"] === "string" ? args["action"] : "";
      try {
        switch (action) {
          case "list": {
            yield delta(renderPetSnapshot(await port.list()));
            return;
          }
          case "use": {
            const petId = args["pet_id"];
            if (typeof petId !== "string" || petId.trim() === "") {
              yield delta(
                `Missing required argument "pet_id" for ${definition.name} action="use".`,
              );
              return { stopReason: "fatal" };
            }
            yield delta(renderPetSnapshot(await port.setActivePet(petId.trim())));
            return;
          }
          case "show":
          case "hide": {
            yield delta(renderPetSnapshot(await port.setEnabled(action === "show")));
            return;
          }
          default:
            yield delta(
              `Unknown action ${JSON.stringify(action)}. Use "list", "use" (with pet_id), "show" or "hide".`,
            );
            return { stopReason: "fatal" };
        }
      } catch (err) {
        // The port's failures are user-facing ("no pet with that id"), not crashes: they
        // explain themselves and finish as a normal tool failure.
        const message = err instanceof Error ? err.message : String(err);
        yield delta(message);
        return { stopReason: "fatal" };
      }
    },
  };
}
