/**
 * GUARD (HEL-1306, labelled as such): green on a correct tree, red only by mutation (change a TS
 * constant or a schema cap/enum -- recorded in the run evidence dir). The frontend constants and the three
 * Output request schemas must agree with `shared-test-fixtures/chart-reference-marks.json`'s `limits`,
 * which the backend `ChartReferenceMarksSpec` pins `ChartReferenceMarks` to.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  MAX_REFERENCE_BANDS,
  MAX_REFERENCE_LABEL,
  MAX_REFERENCE_LINES,
  REFERENCE_TONES,
} from "./referenceMarks";

const SCHEMAS_DIR = resolve(__dirname, "../../../schemas");
const limits = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../shared-test-fixtures/chart-reference-marks.json"),
    "utf8",
  ),
).limits as { maxLines: number; maxBands: number; maxLabel: number; tones: string[] };

interface ItemSchema {
  properties: { label: { maxLength: number }; tone: { enum: string[] } };
}
interface MarksSchema {
  maxItems: number;
  items: ItemSchema;
}

function schemaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return schemaFiles(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

function collect(
  node: unknown,
  key: string,
  path: string,
): Array<{ path: string; def: MarksSchema }> {
  if (Array.isArray(node)) return node.flatMap((c, i) => collect(c, key, `${path}[${i}]`));
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const props = record["properties"] as Record<string, unknown> | undefined;
  const here =
    props && typeof props === "object" && key in props
      ? [{ path, def: props[key] as MarksSchema }]
      : [];
  return [...here, ...Object.entries(record).flatMap(([k, c]) => collect(c, key, `${path}/${k}`))];
}

const files = schemaFiles(SCHEMAS_DIR);
const tree = (key: string) =>
  files.flatMap((f) =>
    collect(JSON.parse(readFileSync(f, "utf8")), key, f.slice(SCHEMAS_DIR.length)),
  );
const lineDefs = tree("referenceLines");
const bandDefs = tree("referenceBands");

describe("reference-mark limits vs the shared fixture and the Output request schemas (GUARD)", () => {
  it("TS constants equal the fixture limits", () => {
    expect(MAX_REFERENCE_LINES).toBe(limits.maxLines);
    expect(MAX_REFERENCE_BANDS).toBe(limits.maxBands);
    expect(MAX_REFERENCE_LABEL).toBe(limits.maxLabel);
    expect([...REFERENCE_TONES]).toEqual(limits.tones);
  });

  it("finds exactly three referenceLines and three referenceBands definitions under schemas/", () => {
    expect(lineDefs.map((d) => d.path)).toHaveLength(3);
    expect(bandDefs.map((d) => d.path)).toHaveLength(3);
  });

  it.each(lineDefs.map((d) => [d.path, d.def] as const))(
    "%s referenceLines matches limits",
    (_p, def) => {
      expect(def.maxItems).toBe(limits.maxLines);
      expect(def.items.properties.label.maxLength).toBe(limits.maxLabel);
      expect(def.items.properties.tone.enum).toEqual(limits.tones);
    },
  );

  it.each(bandDefs.map((d) => [d.path, d.def] as const))(
    "%s referenceBands matches limits",
    (_p, def) => {
      expect(def.maxItems).toBe(limits.maxBands);
      expect(def.items.properties.label.maxLength).toBe(limits.maxLabel);
      expect(def.items.properties.tone.enum).toEqual(limits.tones);
    },
  );
});
