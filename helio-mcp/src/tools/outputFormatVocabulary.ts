/**
 * The Output display-format vocabulary (HEL-1308): `config.format` (metric, collection) and
 * `config.columnFormats` (table). Documentation only -- the backend never validates these values.
 * `shared-test-fixtures/duration-format-seam.json` pins these lists and sentence to the frontend readers
 * and the backend `OutputFormatVocabulary` (`durationFormatSeam.test.ts`).
 */
export const METRIC_FORMATS = [
  "number",
  "integer",
  "currency",
  "percent",
  "duration",
  "durationMs",
] as const;

export const COLUMN_FORMAT_TYPES = ["number", "currency", "date", "text", "duration"] as const;

export const COLUMN_DURATION_UNITS = ["s", "ms"] as const;

/** Appended to `OUTPUT_CONFIG_KEYS_DOC`. */
export const FORMAT_VOCABULARY_DOC: string =
  "Display formats: a metric or collection `format` is one of " +
  METRIC_FORMATS.join(", ") +
  " (duration reads seconds, durationMs reads milliseconds); " +
  "a table `columnFormats` entry is { type, decimals?, currency?, datePattern?, unit? } where type is one of " +
  COLUMN_FORMAT_TYPES.join(", ") +
  ", and unit (duration only) is one of " +
  COLUMN_DURATION_UNITS.join(", ") +
  " (default s).";
