/**
 * GUARD (HEL-1459, HEL-1311 pattern, labelled as such): green on a correct tree, red only by mutation
 * (drop a value from `PATCH_SET_TARGET_KINDS` or from one schema enum -- recorded in the run evidence
 * dir). Walks every file under `schemas/patch-sets/`, collects each `kind` property's `enum`, asserts
 * exactly two were found and that each equals `PATCH_SET_TARGET_KINDS`, so the frontend set cannot
 * drift from the backend `PatchSetTargetKinds.All`, the MCP const or the schemas. The compile-time
 * block below is checked by `tsc` (npm run typecheck), not jest.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { PATCH_SET_TARGET_KINDS, type EditTarget } from "./patchSet";

const SCHEMAS_DIR = resolve(__dirname, "../../../../../schemas/patch-sets");
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
  const prop = record["kind"] as { enum?: unknown[] } | undefined;
  const here =
    prop && typeof prop === "object" && Array.isArray(prop.enum)
      ? [{ path, values: (prop.enum.filter((v) => typeof v === "string") as string[]).sort() }]
      : [];
  return [...here, ...Object.entries(record).flatMap(([k, c]) => kindEnums(c, `${path}/${k}`))];
}

// Compile-time pins (tsc is the red): `output` + `parentId` are valid, the removed `dataType` is not.
export const validOutputTarget: EditTarget = { kind: "output", parentId: "p" };
// @ts-expect-error -- `dataType` was removed outright (HEL-904); EditTarget.kind must reject it.
export const removedDataTypeTarget: EditTarget = { kind: "dataType" };

describe("frontend patch-set target kinds vs schemas (GUARD)", () => {
  const found = schemaFiles(SCHEMAS_DIR).flatMap((f) =>
    kindEnums(JSON.parse(readFileSync(f, "utf8")), f.slice(SCHEMAS_DIR.length)),
  );
  const expected = [...PATCH_SET_TARGET_KINDS].sort();

  it("finds exactly two kind enums under schemas/patch-sets/", () => {
    expect(found.map((f) => f.path)).toHaveLength(EXPECTED_ENUM_COUNT);
  });

  it.each(found.map((f) => [f.path, f.values] as const))(
    "%s equals PATCH_SET_TARGET_KINDS (frontend/src/features/patchSets/types/patchSet.ts)",
    (_path, values) => {
      expect(values).toEqual(expected);
    },
  );
});
