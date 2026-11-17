// HEL-1632 (design.md D2): a walked frame as the record rows the shared renderers take. A frame cell is the client
// evaluator's value model (`Integral` is a class), a panel record is plain JSON-shaped data.

import { frameSchema, Integral, type Frame } from "../../evaluator";
import { orderColumns } from "../../../panels/state/columnOrder";
import type { OutputSchemaField } from "../../types/output";

/** The column order of a live render, and (HEL-1705) the order a saved panel's rows now arrive in: the Output's declared
 *  schema fields that the frame has, then every other key in ascending code-point order. The server writes saved rows in this
 *  same order (`RowColumnOrder`), so an order-dependent render is the same live and saved. */
export function orderLiveColumns(
  frameKeys: readonly string[],
  schema: readonly OutputSchemaField[] | null | undefined,
): string[] {
  return orderColumns(
    frameKeys,
    (schema ?? []).map((f) => f.name),
  );
}

/** The columns of `frame` in `orderLiveColumns` order. */
export function frameColumns(
  frame: Frame,
  schema: readonly OutputSchemaField[] | null | undefined,
): string[] {
  return orderLiveColumns(frameSchema(frame), schema);
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

/** The columns saved rows (plain records) render in: the same order as a live frame. */
export function recordColumns(
  records: readonly Record<string, unknown>[],
  schema: readonly OutputSchemaField[] | null | undefined,
): string[] {
  const keys = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) keys.add(key);
  return orderLiveColumns([...keys], schema);
}

/** Saved rows in `columns` order (the server's, when the response carried one), else `recordColumns` order. */
export function orderRecords(
  records: readonly Record<string, unknown>[],
  schema: readonly OutputSchemaField[] | null | undefined,
  columns: readonly string[] = recordColumns(records, schema),
): Record<string, unknown>[] {
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
