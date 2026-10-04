/**
 * HEL-958 seam test, MCP half. `shared-test-fixtures/join-step-config.json` is the join config the
 * UI editor persists and the backend round-trips (`JoinStepConfigSeamSpec`). This half proves the
 * `add_pipeline_step` description documents exactly those keys, so an agent authoring a join writes
 * the same shape as the UI.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HelioApi } from "../helioApi.js";
import { registerWriteTools } from "./write.js";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../../../shared-test-fixtures/join-step-config.json"), "utf8"),
) as { cases: Record<string, Record<string, unknown>> };

function addPipelineStepDescription(): string {
  let description = "";
  const server = {
    registerTool: (name: string, def: { description?: string }) => {
      if (name === "add_pipeline_step") description = def.description ?? "";
    },
  };
  registerWriteTools(server as never, {} as HelioApi);
  return description;
}

/** The join clause: from "join →" up to the next op's clause ("assert →"). */
function joinClause(description: string): string {
  const start = description.indexOf("join → {");
  const end = description.indexOf("assert → {", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return description.slice(start, end);
}

describe("join-step-config shared fixture (MCP side)", () => {
  const clause = joinClause(addPipelineStepDescription());
  const shape = clause.slice(
    clause.indexOf("{"),
    clause.indexOf("}", clause.indexOf("joinType")) + 1,
  );

  it("documents exactly the fixture's top-level keys in the join config shape", () => {
    // Top-level keys of the documented shape: strip the nested secondaryInput object first.
    const topLevel = shape
      .replace(/\{kind:'source',dataSourceId\}/, "")
      .replace(/\{kind:'lane',stepId\}/, "")
      .match(/\b(secondaryInput|joinKey|joinType)\b/g);
    for (const [name, config] of Object.entries(fixture.cases)) {
      expect({ name, keys: [...(topLevel ?? [])].sort() }).toEqual({
        name,
        keys: Object.keys(config).sort(),
      });
    }
  });

  it("documents both secondaryInput kinds and exactly the supported join types", () => {
    expect(shape).toContain("{kind:'source',dataSourceId}");
    expect(shape).toContain("{kind:'lane',stepId}");
    expect(shape).toContain("joinType: 'inner'|'left'");
    for (const config of Object.values(fixture.cases)) {
      expect(["inner", "left"]).toContain(config.joinType);
    }
  });

  it("does not document the legacy flat rightDataSourceId as a config key", () => {
    expect(shape).not.toContain("rightDataSourceId");
  });
});
