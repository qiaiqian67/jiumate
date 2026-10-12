/**
 * The credential section's variable list, derived from a plugin's Skills: every declared
 * `required_env` name, deduplicated, in a stable order.
 *
 * The two properties worth pinning are the ones a card with two skills sharing one provider's
 * key would break silently: a duplicate has to collapse to a single input (two inputs bound to
 * one vault key would let the second save overwrite the first without either saying so), and the
 * order must not depend on which skill the listing happened to put first.
 */
import { describe, expect, it } from "vitest";
import { pluginEnvNames } from "../src/features/plugins/plugin-credentials";

describe("pluginEnvNames", () => {
  it("returns nothing when no skill declares a variable", () => {
    expect(pluginEnvNames([{}, { requiredEnv: [] }])).toEqual([]);
  });

  it("collects a variable from whichever skill declares it", () => {
    expect(
      pluginEnvNames([
        { requiredEnv: ["FIRECRAWL_API_KEY"] },
        { requiredEnv: ["JIUMATE_API_TOKEN"] },
      ]),
    ).toEqual(["FIRECRAWL_API_KEY", "JIUMATE_API_TOKEN"]);
  });

  it("collapses a variable two skills declare into one input", () => {
    expect(
      pluginEnvNames([
        { requiredEnv: ["SERP_API_KEY"] },
        { requiredEnv: ["SERP_API_KEY", "OTHER_KEY"] },
      ]),
    ).toEqual(["OTHER_KEY", "SERP_API_KEY"]);
  });

  it("sorts independently of the order the skills arrive in", () => {
    const skills = [{ requiredEnv: ["Z_KEY"] }, { requiredEnv: ["A_KEY"] }];
    expect(pluginEnvNames(skills)).toEqual(["A_KEY", "Z_KEY"]);
    expect(pluginEnvNames([...skills].reverse())).toEqual(["A_KEY", "Z_KEY"]);
  });
});
