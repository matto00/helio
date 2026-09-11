/**
 * HEL-1080 design.md Decision 3a: parses `DatasetRowValidator.renderRowFailures`'s three known
 * message templates out of a `400`'s joined `"; "` error string, so a validation error can be
 * attached to the OFFENDING CELL rather than shown only as an undifferentiated banner:
 *
 * - Required-field: `row <idx>: field '<name>' is required`
 * - Type mismatch:   `row <idx>: field '<name>' — <reason>`
 * - Row-length:      `row <idx>: expected <n> fields, got <m>` -- has no single field to attach
 *   to; always renders as a grid-level banner.
 *
 * An unparseable message (a future validator change alters the format) falls back to the same
 * grid-level banner rather than silently dropping the error (tasks.md 5.9) -- this is a tracked,
 * not silent, degradation.
 */
export interface ParsedRowValidationError {
  /** The declared field name the error should attach to, or `null` for a grid-level banner
   *  (row-length mismatch, or an unparseable message). */
  fieldName: string | null;
  message: string;
}

const FIELD_MATCH = /field '([^']+)'/;

export function parseDatasetRowValidationError(rawMessage: string): ParsedRowValidationError[] {
  return rawMessage
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(FIELD_MATCH);
      return { fieldName: match ? match[1] : null, message: part };
    });
}
