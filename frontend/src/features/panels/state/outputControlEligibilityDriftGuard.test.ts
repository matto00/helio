// HEL-1189 tasks.md 3.2 (C4) — cross-checks `KIND_REQUIREMENTS` against the backend's own
// `OutputControlEligibility.KindRequirements` literal (services/pipelines/OutputControlEligibility.scala),
// mirroring `controlFitnessDriftGuard.test.ts`'s approach of reading Scala source directly from a
// Jest test rather than trusting a hand-copied twin.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { KIND_REQUIREMENTS } from "./outputControlEligibility";

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

// Maps a Scala `Operator` constant to its wire-string key (`OutputFilterCapability.Operator.asString`).
const OPERATOR_WIRE: Record<string, string> = {
  Contains: "contains",
  Eq: "eq",
  In: "in",
  Gte: "gte",
  Lte: "lte",
};

// Maps a Scala `DataFieldType` constant to its wire-type key.
const FIELD_TYPE_WIRE: Record<string, string> = {
  StringType: "string",
  StringBodyType: "string-body",
  IntegerType: "integer",
  FloatType: "float",
  BooleanType: "boolean",
  TimestampType: "timestamp",
  BinaryRefType: "binary-ref",
};

interface BackendRequirement {
  requiredOperators: string[];
  allowedFieldTypes: string[] | null;
}

describe("KIND_REQUIREMENTS matches OutputControlEligibility.scala's KindRequirements in content (C4)", () => {
  it("mirrors every entry", () => {
    const scalaPath = join(
      findRepoRoot(),
      "backend/src/main/scala/com/helio/services/pipelines/OutputControlEligibility.scala",
    );
    const src = readFileSync(scalaPath, "utf-8");

    const mapMatch = src.match(
      /val KindRequirements: Map\[String, \(Set\[Operator], Option\[Set\[DataFieldType]]\)] = Map\(([\s\S]*?)\n {2}\)/,
    );
    expect(mapMatch).not.toBeNull();

    // `"text"          -> (Set(Contains), None),`
    // `"numeric-range" -> (Set(Gte, Lte), Some(Set(DataFieldType.IntegerType, DataFieldType.FloatType))),`
    const entryRe = /"([a-z-]+)"\s*->\s*\(Set\(([^)]*)\),\s*(None|Some\(Set\(([^)]*)\)\))\)/g;

    const backendRequirements: Record<string, BackendRequirement> = {};
    for (const match of src.slice(mapMatch!.index).matchAll(entryRe)) {
      const [, kind, operatorsRaw, optionRaw, typesRaw] = match;
      const requiredOperators = operatorsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((constant) => {
          const wire = OPERATOR_WIRE[constant];
          expect(wire).toBeDefined();
          return wire;
        });
      const allowedFieldTypes =
        optionRaw === "None"
          ? null
          : typesRaw
              .split(",")
              .map((s) => s.trim().replace(/^DataFieldType\./, ""))
              .filter(Boolean)
              .map((constant) => {
                const wire = FIELD_TYPE_WIRE[constant];
                expect(wire).toBeDefined();
                return wire;
              });
      backendRequirements[kind] = { requiredOperators, allowedFieldTypes };
    }

    expect(Object.keys(backendRequirements).sort()).toEqual(Object.keys(KIND_REQUIREMENTS).sort());

    for (const kind of Object.keys(KIND_REQUIREMENTS)) {
      const frontend = KIND_REQUIREMENTS[kind as keyof typeof KIND_REQUIREMENTS];
      const backend = backendRequirements[kind];
      expect(frontend.requiredOperators.slice().sort()).toEqual(
        backend.requiredOperators.slice().sort(),
      );
      expect(
        frontend.allowedFieldTypes === null ? null : frontend.allowedFieldTypes.slice().sort(),
      ).toEqual(
        backend.allowedFieldTypes === null ? null : backend.allowedFieldTypes.slice().sort(),
      );
    }
  });
});
