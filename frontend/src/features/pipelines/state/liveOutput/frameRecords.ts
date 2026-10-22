// HEL-1632 (design.md D2): a walked frame as the record rows the shared renderers take. A frame cell is the client
// evaluator's value model (`Integral` is a class), a panel record is plain JSON-shaped data.

import { frameSchema, Integral, type Frame } from "../../evaluator";
import type { OutputSchemaField } from "../../types/output";

/** The column order of a live render. A saved panel's order is NOT reproducible client-side (stored rows are JSONB, then
 *  parsed into an unordered map), so the live view orders deterministically: the Output's declared schema fields that
 *  the frame has, then any extra frame keys in frame order. */
export function orderLiveColumns(
  frameKeys: readonly string[],
  schema: readonly OutputSchemaField[] | null | undefined,
): string[] {
  const present = new Set(frameKeys);
  const ordered: string[] = [];
  for (const field of schema ?? []) {
    if (present.delete(field.name)) ordered.push(field.name);
  }
  for (const key of frameKeys) if (present.has(key)) ordered.push(key);
  return ordered;
}

/** The frame's rows as records in `orderLiveColumns` order: an `Integral` becomes its number, a column a row lacks is
 *  `null`. */
export function frameToRecords(
  frame: Frame,
  schema: readonly OutputSchemaField[] | null | undefined,
): Record<string, unknown>[] {
  const columns = orderLiveColumns(frameSchema(frame), schema);
  return frame.map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of columns) {
      const value = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null;
      Object.defineProperty(record, column, {
        value: value instanceof Integral ? value.value : value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return record;
  });
}

/** Saved rows (already plain records) in the same deterministic column order as a live frame. */
export function orderRecords(
  records: readonly Record<string, unknown>[],
  schema: readonly OutputSchemaField[] | null | undefined,
): Record<string, unknown>[] {
  const keys = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) keys.add(key);
  const columns = orderLiveColumns([...keys], schema);
  return records.map((record) => {
    const ordered: Record<string, unknown> = {};
    for (const column of columns) {
      Object.defineProperty(ordered, column, {
        value: record[column] ?? null,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return ordered;
  });
}
