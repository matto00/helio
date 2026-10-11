// HEL-1308 seam test, frontend half (D8). `shared-test-fixtures/duration-format-seam.json` binds the
// frontend readers/formatters, the backend OutputFormatVocabulary + schemas and helio-mcp to ONE vocabulary.
// Every comparison is exact equality (never substring), so each can fail.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatColumnValue } from "../../../panels/ui/renderers/columnFormatting";
import { formatMetricValue } from "../../../panels/ui/renderers/MetricRenderer";
import {
  METRIC_FORMATS,
  TABLE_COLUMN_FORMAT_TYPES,
  TABLE_DURATION_UNITS,
  isMetricFormat,
  isTableColumnFormatType,
  readCollectionConfig,
  readMetricConfig,
  readTableConfig,
} from "./outputConfigTypes";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "../../../../../../shared-test-fixtures/duration-format-seam.json"),
    "utf8",
  ),
) as {
  lists: { metricFormats: string[]; columnFormatTypes: string[]; columnDurationUnits: string[] };
  configs: Record<string, { kind: string; config: Record<string, unknown> }>;
  valueCases: { unit: "s" | "ms"; value: number; text: string }[];
};

describe("duration-format seam (frontend)", () => {
  it("exported vocabulary arrays equal the fixture lists exactly", () => {
    expect([...METRIC_FORMATS]).toEqual(fixture.lists.metricFormats);
    expect([...TABLE_COLUMN_FORMAT_TYPES]).toEqual(fixture.lists.columnFormatTypes);
    expect([...TABLE_DURATION_UNITS]).toEqual(fixture.lists.columnDurationUnits);
  });

  it("the guards accept every fixture value and reject near-misses", () => {
    fixture.lists.metricFormats.forEach((v) => expect(isMetricFormat(v)).toBe(true));
    fixture.lists.columnFormatTypes.forEach((v) => expect(isTableColumnFormatType(v)).toBe(true));
    for (const bad of ["durationms", "Duration", "durationMS", ""]) {
      expect(isMetricFormat(bad)).toBe(false);
      expect(isTableColumnFormatType(bad)).toBe(false);
    }
  });

  it("readers keep the fixture configs", () => {
    const metric = readMetricConfig(fixture.configs.metric.config);
    expect(metric).toMatchObject({ format: "duration" });
    const collection = readCollectionConfig(fixture.configs.collection.config);
    expect(collection).toMatchObject({ format: "durationMs" });
    const table = readTableConfig(fixture.configs.tableColumn.config);
    expect(table).toMatchObject({
      columnFormats: { elapsed: { type: "duration", unit: "ms" } },
    });
  });

  it("formatters give the fixture text", () => {
    for (const c of fixture.valueCases) {
      expect(formatColumnValue({ type: "duration", unit: c.unit }, c.value)).toBe(c.text);
      expect(formatMetricValue(String(c.value), c.unit === "ms" ? "durationMs" : "duration")).toBe(
        c.text,
      );
    }
  });
});
