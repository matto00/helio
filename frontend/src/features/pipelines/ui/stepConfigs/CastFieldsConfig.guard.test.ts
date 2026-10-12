/**
 * GUARD (HEL-1476, labelled as such): green on a correct tree, red only by mutation (drop a value
 * from `CAST_TARGET_TYPES` or from `CastStep.SupportedTargets` -- recorded in the run evidence
 * dir). Reads the `SupportedTargets` `Vector(...)` literal out of the backend source and asserts
 * the picker's list equals it (values and order), so the editor cannot drift from what the backend
 * accepts. Fails loudly if the literal moves or is reformatted so nothing is extracted.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CAST_TARGET_TYPES } from "./CastFieldsConfig";

const CAST_STEP_SCALA = resolve(
  __dirname,
  "../../../../../../backend/src/main/scala/com/helio/domain/steps/CastStep.scala",
);

function backendSupportedTargets(): string[] {
  const source = readFileSync(CAST_STEP_SCALA, "utf8");
  const literal = /val SupportedTargets:\s*Vector\[String\]\s*=\s*Vector\(([^)]*)\)/.exec(source);
  if (!literal) return [];
  return [...literal[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("cast picker targets vs backend CastStep.SupportedTargets (GUARD)", () => {
  const backend = backendSupportedTargets();

  it("extracts at least one backend target (fails loudly if the literal moves)", () => {
    expect(backend.length).toBeGreaterThan(0);
  });

  it("CAST_TARGET_TYPES equals the backend list, in order", () => {
    expect([...CAST_TARGET_TYPES]).toEqual(backend);
  });
});
