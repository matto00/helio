/**
 * HEL-1308 seam test, MCP half. `shared-test-fixtures/duration-format-seam.json` binds the frontend readers,
 * the backend `OutputFormatVocabulary` and this server to one format vocabulary. Exact equality throughout.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COLUMN_DURATION_UNITS,
  COLUMN_FORMAT_TYPES,
  FORMAT_VOCABULARY_DOC,
  METRIC_FORMATS,
} from "./outputFormatVocabulary.js";
import { OUTPUT_CONFIG_KEYS_DOC } from "./outputs.js";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../../../shared-test-fixtures/duration-format-seam.json"), "utf8"),
) as {
  lists: { metricFormats: string[]; columnFormatTypes: string[]; columnDurationUnits: string[] };
  vocabularyDoc: string;
};

describe("duration-format shared fixture (MCP side)", () => {
  it("exports exactly the fixture's ordered vocabularies", () => {
    expect([...METRIC_FORMATS]).toEqual(fixture.lists.metricFormats);
    expect([...COLUMN_FORMAT_TYPES]).toEqual(fixture.lists.columnFormatTypes);
    expect([...COLUMN_DURATION_UNITS]).toEqual(fixture.lists.columnDurationUnits);
  });

  it("FORMAT_VOCABULARY_DOC equals the fixture sentence exactly", () => {
    expect(FORMAT_VOCABULARY_DOC).toBe(fixture.vocabularyDoc);
  });

  it("OUTPUT_CONFIG_KEYS_DOC ends with the sentence", () => {
    expect(OUTPUT_CONFIG_KEYS_DOC.endsWith(fixture.vocabularyDoc)).toBe(true);
  });
});
