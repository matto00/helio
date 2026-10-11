/**
 * GUARD (HEL-1311, labelled as such): green on a correct tree, red only by mutation (drop a value
 * from `CHART_TYPES` or from one schema enum -- recorded in the run evidence dir). Walks every file
 * under `schemas/`, collects each `chartType` property's `enum`, asserts exactly six were found
 * and that each equals the MCP chart-type const (null aside), so the MCP set cannot drift from the
 * backend `ChartTypes.All` / frontend `CHART_TYPES`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { panelSchema } from "./proposal.js";
import { CHART_TYPES } from "./chartTypes.js";

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
  const prop = record["chartType"];
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
  return [
    ...here,
    ...Object.entries(record).flatMap(([k, c]) => chartTypeEnums(c, `${path}/${k}`)),
  ];
}

describe("helio-mcp chart types vs schemas (GUARD)", () => {
  const found = schemaFiles(SCHEMAS_DIR).flatMap((f) =>
    chartTypeEnums(JSON.parse(readFileSync(f, "utf8")), f.slice(SCHEMAS_DIR.length)),
  );
  const expected = [...CHART_TYPES].sort();

  it("finds exactly six chartType enums under schemas/", () => {
    expect(found.map((f) => f.path)).toHaveLength(EXPECTED_ENUM_COUNT);
  });

  it.each(found.map((f) => [f.path, f.values] as const))(
    "%s equals the MCP CHART_TYPES",
    (_path, values) => {
      expect(values).toEqual(expected);
    },
  );

  it("builds the propose_dashboard panel chartType enum from CHART_TYPES", () => {
    expect([...panelSchema.shape.chartType.unwrap().options].sort()).toEqual(expected);
  });
});
