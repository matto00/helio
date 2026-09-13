// HEL-1129 tasks.md 1.2: cross-checks `CANONICAL_COLUMN_TYPES` against the backend's own
// `CanonicalWireValues` literal (model.scala), mirroring
// `frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts`'s (HEL-1079)
// approach of reading Scala source directly from a Jest test rather than hand-copying a
// same-spec twin -- `helio-mcp` is a separate package with no dependency on `frontend/`, so this
// constant is a local replica, not an import, and needs its own guard.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CANONICAL_COLUMN_TYPES } from "./canonicalColumnTypes.js";

function findRepoRoot(): string {
  // This test runs under the repo-root `jest.config.cjs`; `helio-mcp/` and `backend/` are
  // siblings one or more levels up from `__dirname`.
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

describe("CANONICAL_COLUMN_TYPES drift guard", () => {
  it("matches the backend's CanonicalWireValues exactly, in content and order", () => {
    const modelScalaPath = join(
      findRepoRoot(),
      "backend/src/main/scala/com/helio/domain/model/model.scala",
    );
    const src = readFileSync(modelScalaPath, "utf-8");

    // `val CanonicalWireValues: Vector[String] = Vector(StringType, IntegerType, ...).map(asString)`
    const match = src.match(/val CanonicalWireValues:[\s\S]*?Vector\(([^)]*)\)\.map\(asString\)/);
    expect(match).not.toBeNull();
    const typeConstants = match![1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Map each `<Foo>Type` Scala constant to its `asString` wire value by reading the
    // `case "<wire>" => Some(<Foo>Type)` mapping out of `fromString`'s reverse table -- reusing
    // that table (rather than re-deriving `asString` from scratch) keeps this guard tied to a
    // single source of truth already present in the file.
    const fromStringMatch = src.match(
      /def fromString\(s: String\): Option\[DataFieldType\][\s\S]*?\n\s*\}/,
    );
    expect(fromStringMatch).not.toBeNull();
    const wireByConstant = new Map<string, string>();
    for (const line of fromStringMatch![0].split("\n")) {
      const caseMatch = line.match(/case\s+"([a-z-]+)"\s*=>\s*Some\((\w+)\)/);
      if (caseMatch) wireByConstant.set(caseMatch[2]!, caseMatch[1]!);
    }

    const backendOrder = typeConstants.map((c) => {
      const wire = wireByConstant.get(c);
      expect(wire).toBeDefined();
      return wire as string;
    });

    expect([...CANONICAL_COLUMN_TYPES]).toEqual(backendOrder);
  });
});
