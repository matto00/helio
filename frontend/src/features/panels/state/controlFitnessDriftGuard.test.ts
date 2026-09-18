// HEL-1084 task 4.5 (C4) — cross-checks `CONTROL_FITNESS` against the backend's own
// `FormFieldSpec.FittingControls` literal (FormPanel.scala), mirroring
// `canonicalFieldTypesDriftGuard.test.ts`'s approach of reading Scala source directly from a
// Jest test rather than trusting a hand-copied twin.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CONTROL_FITNESS } from "./formConfigValidation";

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    try {
      if (readdirSync(dir).includes("backend")) return dir;
    } catch {
      // ignore and keep walking up
    }
    dir = join(dir, "..");
  }
  throw new Error("Could not locate repo root (no ancestor directory contains 'backend')");
}

// Maps a Scala `DataFieldType` constant to its wire-type key, the same key `CONTROL_FITNESS`
// (and `DatasetFieldType`) use on the TS side.
const WIRE_BY_CONSTANT: Record<string, string> = {
  StringType: "string",
  StringBodyType: "string-body",
  IntegerType: "integer",
  FloatType: "float",
  BooleanType: "boolean",
  TimestampType: "timestamp",
  BinaryRefType: "binary-ref",
};

describe("CONTROL_FITNESS matches FormPanel.scala's FittingControls in content and order (C4)", () => {
  it("mirrors every entry, in order", () => {
    const formPanelScalaPath = join(
      findRepoRoot(),
      "backend/src/main/scala/com/helio/domain/panels/FormPanel.scala",
    );
    const src = readFileSync(formPanelScalaPath, "utf-8");

    const match = src.match(
      /val FittingControls: Map\[DataFieldType, Vector\[String\]\] = Map\(([\s\S]*?)\n {2}\)/,
    );
    expect(match).not.toBeNull();

    const entryLines = match![1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const backendFitness: Record<string, string[]> = {};
    for (const line of entryLines) {
      // `DataFieldType.StringType     -> Vector("text", "textarea", "select"),`
      const entryMatch = line.match(/DataFieldType\.(\w+)\s*->\s*Vector\(([^)]*)\)/);
      expect(entryMatch).not.toBeNull();
      const [, constant, controlsRaw] = entryMatch!;
      const wireType = WIRE_BY_CONSTANT[constant];
      expect(wireType).toBeDefined();
      const controls = controlsRaw
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      backendFitness[wireType] = controls;
    }

    expect(CONTROL_FITNESS).toEqual(backendFitness);
  });
});
