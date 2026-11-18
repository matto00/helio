/**
 * GUARD (HEL-1740, labelled as such): green on a correct tree, red only by mutation (drop `insight` from a site; each mutation is
 * recorded in openspec/changes/register-insight-output-kind/drift-mutations.md). Compares the frontend kind set with the backend
 * canonical set (read from the JSON schema enums, which the backend `OutputKindDriftSpec` pins to `OutputKind.all`), and pins the
 * editor picker's deliberate exclusion of `insight` (until HEL-1744).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { OUTPUT_KINDS } from "./output";
import { CREATABLE_KIND_OPTIONS } from "../ui/outputEditor/outputKinds";
import { buildNodeCapabilities } from "../state/nodeCapabilities";

const SCHEMAS = resolve(__dirname, "../../../../../schemas");

function kindEnum(file: string, path: string[]): string[] {
  let node: unknown = JSON.parse(readFileSync(resolve(SCHEMAS, file), "utf-8"));
  for (const key of path) node = (node as Record<string, unknown>)[key];
  const values = (node as { enum?: unknown }).enum;
  if (!Array.isArray(values) || values.length === 0)
    throw new Error(`no kind enum at ${file} ${path.join(".")}`);
  return values as string[];
}

const SCHEMA_SITES: Array<[string, string[]]> = [
  ["outputs/output.schema.json", ["properties", "kind"]],
  ["outputs/create-output-request.schema.json", ["properties", "kind"]],
  ["pipelines/create-pipeline-transactional-output-request.schema.json", ["properties", "kind"]],
  ["pipelines/draft-save-request.schema.json", ["$defs", "DraftOutput", "properties", "kind"]],
  ["pipelines/draft-save-response.schema.json", ["$defs", "SavedOutput", "properties", "kind"]],
];

describe("Output kind drift (frontend)", () => {
  it("OUTPUT_KINDS equals every schema kind enum", () => {
    for (const [file, path] of SCHEMA_SITES) {
      expect([...kindEnum(file, path)].sort()).toEqual([...OUTPUT_KINDS].sort());
    }
  });

  it("the node-capabilities specs cover exactly OUTPUT_KINDS", () => {
    expect(Object.keys(buildNodeCapabilities([]).capabilities).sort()).toEqual(
      [...OUTPUT_KINDS].sort(),
    );
  });

  it("the editor's create picker offers every kind except insight (HEL-1744 owns its authoring UI)", () => {
    expect(CREATABLE_KIND_OPTIONS.map((o) => o.value).sort()).toEqual(
      OUTPUT_KINDS.filter((k) => k !== "insight").sort(),
    );
  });
});
