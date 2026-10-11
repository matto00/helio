// HEL-1307: loads `shared-test-fixtures/conditional-formats-config.json`, the seam fixture the backend
// `ConditionalFormatsSeamSpec`/`ConditionalFormatsSpec` also read. Test-only.
import fs from "node:fs";
import path from "node:path";

export type FixtureKind = "metric" | "table" | "collection";

export interface FixtureValidCase {
  name: string;
  kind: FixtureKind;
  editorProducible: boolean;
  config: { conditionalFormats: unknown };
}

export interface FixtureInvalidCase {
  name: string;
  kind: FixtureKind;
  ruleIndex: number | null;
  fragment: string;
  config: { conditionalFormats: unknown };
}

function findRepoRoot(dir: string): string {
  return fs.existsSync(path.join(dir, "shared-test-fixtures"))
    ? dir
    : findRepoRoot(path.dirname(dir));
}

export const conditionalFormatsFixture = JSON.parse(
  fs.readFileSync(
    path.join(findRepoRoot(__dirname), "shared-test-fixtures/conditional-formats-config.json"),
    "utf8",
  ),
) as { valid: FixtureValidCase[]; invalid: FixtureInvalidCase[] };
