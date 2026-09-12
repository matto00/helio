// HEL-1079 tasks.md 1.1: cross-checks `CANONICAL_FIELD_TYPES` against the backend's own
// `CanonicalWireValues` literal (model.scala), mirroring `scripts/check-schema-drift.mjs`'s
// approach of reading Scala source directly from a Node/Jest test rather than hand-copying a
// same-spec twin. The HEL-891 hazard is that the backend accepts `"double"` as a legacy synonym
// it silently rewrites to `"float"` (`canonicalizeLegacy`) -- it will never reject a UI mistake
// here, so this guard is what actually catches order/content drift.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CANONICAL_FIELD_TYPES } from "./dataSource";

function findRepoRoot(): string {
  // Jest's rootDir is `frontend/`; the backend tree lives one level up.
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

describe("CANONICAL_FIELD_TYPES drift guard", () => {
  it("matches the backend's CanonicalWireValues exactly, in content and order", () => {
    const modelScalaPath = join(
      findRepoRoot(),
      "backend/src/main/scala/com/helio/domain/model/model.scala",
    );
    const src = readFileSync(modelScalaPath, "utf-8");

    // `val CanonicalWireValues: Vector[String] = Vector(StringType, IntegerType, ...).map(asString)`
    const match = src.match(/val CanonicalWireValues:[\s\S]*?Vector\(([^)]*)\)\.map\(asString\)/);
    expect(match).not.toBeNull();
    const typeConstants = match![1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Map each `<Foo>Type` Scala constant to its `asString` wire value by reading the
    // `case <Foo>Type => "<wire>"` (or equivalent) mapping out of `fromString`'s reverse table --
    // reusing that table (rather than re-deriving `asString` from scratch) keeps this guard tied
    // to a single source of truth already present in the file.
    const fromStringMatch = src.match(
      /def fromString\(s: String\): Option\[DataFieldType\][\s\S]*?\n\s*\}/,
    );
    expect(fromStringMatch).not.toBeNull();
    const wireByConstant = new Map<string, string>();
    for (const line of fromStringMatch![0].split("\n")) {
      const caseMatch = line.match(/case\s+"([a-z-]+)"\s*=>\s*Some\((\w+)\)/);
      if (caseMatch) wireByConstant.set(caseMatch[2], caseMatch[1]);
    }

    const backendOrder = typeConstants.map((c) => {
      const wire = wireByConstant.get(c);
      expect(wire).toBeDefined();
      return wire as string;
    });

    expect(CANONICAL_FIELD_TYPES).toEqual(backendOrder);
  });

  it("is the only canonical-type array literal in frontend/src", () => {
    // Repo-wide grep (task 1.1's second requirement) -- a literal like
    // `["string", "integer", "float", "boolean", "timestamp", "string-body", "binary-ref"]`
    // repeated anywhere else would be a second, driftable source of truth.
    const frontendSrc = join(findRepoRoot(), "frontend/src");
    const offenders: string[] = [];
    const canonicalSetSorted = [...CANONICAL_FIELD_TYPES].sort().join(",");

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          full !== join(__dirname, "dataSource.ts") &&
          full !== __filename
        ) {
          const content = readFileSync(full, "utf-8");
          // Look for any array literal containing all 7 canonical type strings.
          const arrayLiterals = content.match(/\[[^\]]*\]/g) ?? [];
          for (const literal of arrayLiterals) {
            const strings = [...literal.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
            if (strings.length === 0) continue;
            if (strings.sort().join(",") === canonicalSetSorted) {
              offenders.push(full);
            }
          }
        }
      }
    }

    walk(frontendSrc);
    expect(offenders).toEqual([]);
  });
});
