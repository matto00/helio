/**
 * GUARD (HEL-1311, labelled as such): green on a correct tree, red only by mutation (drop a value
 * from `CHART_TYPES` or from one schema enum -- recorded in the run evidence dir). Walks every file
 * under `schemas/`, collects each `chartType` property's `enum`, asserts exactly six were found and
 * that each equals `CHART_TYPES` (null aside), so the frontend set cannot drift from the backend
 * `ChartTypes.All`, the MCP const or the schemas.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { CHART_TYPES, NON_AGGREGATING_CHART_TYPES } from "./chartTypes";

const SCHEMAS_DIR = resolve(__dirname, "../../../schemas");
const EXPECTED_ENUM_COUNT = 6;

function schemaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return schemaFiles(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

function chartTypeEnums(node: unknown, path: string): Array<{ path: string; values: string[] }> {
  if (Array.isArray(node)) return node.flatMap((c, i) => chartTypeEnums(c, `${path}[${i}]`));
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const prop = record["chartType"] as { enum?: unknown[] } | undefined;
  const here =
    prop && typeof prop === "object" && Array.isArray(prop.enum)
      ? [{ path, values: (prop.enum.filter((v) => typeof v === "string") as string[]).sort() }]
      : [];
  return [
    ...here,
    ...Object.entries(record).flatMap(([k, c]) => chartTypeEnums(c, `${path}/${k}`)),
  ];
}

describe("frontend chart types vs schemas (GUARD)", () => {
  const found = schemaFiles(SCHEMAS_DIR).flatMap((f) =>
    chartTypeEnums(JSON.parse(readFileSync(f, "utf8")), f.slice(SCHEMAS_DIR.length)),
  );
  const expected = [...CHART_TYPES].sort();

  it("finds exactly six chartType enums under schemas/", () => {
    expect(found.map((f) => f.path)).toHaveLength(EXPECTED_ENUM_COUNT);
  });

  it.each(found.map((f) => [f.path, f.values] as const))(
    "%s equals CHART_TYPES",
    (_path, values) => {
      expect(values).toEqual(expected);
    },
  );

  it("keeps the non-aggregating subset inside the chart types", () => {
    for (const t of NON_AGGREGATING_CHART_TYPES) expect(CHART_TYPES).toContain(t);
  });
});
