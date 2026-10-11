/**
 * GUARD (HEL-1459, HEL-1311 pattern, labelled as such): green on a correct tree, red only by mutation
 * (drop a value from `PATCH_SET_TARGET_KINDS` or from one schema enum -- recorded in the run evidence
 * dir). Walks every file under `schemas/patch-sets/`, collects each `kind` property's `enum`, asserts
 * exactly two were found and that each equals the MCP const, so the MCP set cannot drift from the
 * backend `PatchSetTargetKinds.All` / frontend `PATCH_SET_TARGET_KINDS`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { editTargetSchema } from "./refinementSchemas.js";
import { PATCH_SET_TARGET_KINDS } from "./patchSetTargetKinds.js";

const SCHEMAS_DIR = resolve(__dirname, "../../../schemas/patch-sets");
const EXPECTED_ENUM_COUNT = 2;

function schemaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return schemaFiles(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

function kindEnums(node: unknown, path: string): Array<{ path: string; values: string[] }> {
  if (Array.isArray(node)) return node.flatMap((c, i) => kindEnums(c, `${path}[${i}]`));
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const prop = record["kind"];
  const here =
    prop && typeof prop === "object" && Array.isArray((prop as { enum?: unknown }).enum)
      ? [
          {
            path,
            values: (
              (prop as { enum: unknown[] }).enum.filter((v) => typeof v === "string") as string[]
            ).sort(),
          },
        ]
      : [];
  return [...here, ...Object.entries(record).flatMap(([k, c]) => kindEnums(c, `${path}/${k}`))];
}

describe("helio-mcp patch-set target kinds vs schemas (GUARD)", () => {
  const found = schemaFiles(SCHEMAS_DIR).flatMap((f) =>
    kindEnums(JSON.parse(readFileSync(f, "utf8")), f.slice(SCHEMAS_DIR.length)),
  );
  const expected = [...PATCH_SET_TARGET_KINDS].sort();

  it("finds exactly two kind enums under schemas/patch-sets/", () => {
    expect(found.map((f) => f.path)).toHaveLength(EXPECTED_ENUM_COUNT);
  });

  it.each(found.map((f) => [f.path, f.values] as const))(
    "%s equals the MCP PATCH_SET_TARGET_KINDS",
    (_path, values) => {
      expect(values).toEqual(expected);
    },
  );

  it("builds the refinement editTargetSchema kind enum from PATCH_SET_TARGET_KINDS", () => {
    expect([...editTargetSchema.shape.kind.options].sort()).toEqual(expected);
  });
});
