import fs from "node:fs";
import path from "node:path";

import { readCollectionConfig, readMetricConfig } from "./outputConfigTypes";

// HEL-1410 seam: the same fixture V118LegacyMetricFormatMigrationSpec asserts the migrated database against.
// The backend proves V118 produces these configs; this proves the real readers accept them (and, for the
// original V94 object, that the reader is the defect: it drops the format).
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../../../backend/src/test/resources/db/fixtures/hel1410-v118-expected-configs.json",
);

interface Entry {
  id: string;
  kind: "metric" | "collection";
  originalFormat: Record<string, unknown> | null;
  format: string;
  unit?: unknown;
}

const entries: Entry[] = (JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as { entries: Entry[] })
  .entries;

function read(kind: Entry["kind"], config: Record<string, unknown>) {
  return kind === "metric" ? readMetricConfig(config) : readCollectionConfig(config);
}

describe("HEL-1410 V118 expected configs through the real readers", () => {
  it("covers metric and collection entries", () => {
    expect(entries.some((e) => e.kind === "metric")).toBe(true);
    expect(entries.some((e) => e.kind === "collection")).toBe(true);
  });

  it.each(entries.map((e) => [e.id, e] as const))(
    "%s: reader returns exactly the migrated format (and unit)",
    (_id, e) => {
      const config: Record<string, unknown> = { format: e.format };
      if (e.unit !== undefined) config.unit = e.unit;
      const result = read(e.kind, config);
      expect(result.format).toBe(e.format);
      if (e.kind === "metric") {
        expect((result as ReturnType<typeof readMetricConfig>).unit).toBe(
          typeof e.unit === "string" ? e.unit : undefined,
        );
      }
    },
  );

  it.each(entries.filter((e) => e.originalFormat !== null).map((e) => [e.id, e] as const))(
    "%s: the original V94 object is dropped by the reader (the defect)",
    (_id, e) => {
      expect(read(e.kind, { format: e.originalFormat }).format).toBeNull();
    },
  );
});
