// Simplified column visibility/order state for a table-kind Output (task
// 5.1/5.2). Mirrors `useTableDisplayState.ts`'s column-row bookkeeping but
// decoupled from `Panel` (that hook takes a whole `Panel` object, tightly
// bound to the panel config's own bind-target id -- not applicable here,
// since an Output has no type-registry entity to bind to). Column widths /
// density are not part of the Output
// config model yet (see `TableKindFields`'s doc comment) -- only visibility
// + order.

import { useState } from "react";

export interface TableColumnRow {
  key: string;
  visible: boolean;
}

export function buildOutputColumns(fieldKeys: string[], columnOrder?: string[]): TableColumnRow[] {
  if (!columnOrder || columnOrder.length === 0) {
    return fieldKeys.map((key) => ({ key, visible: true }));
  }
  const present = new Set(fieldKeys);
  const visible = columnOrder
    .filter((key) => present.has(key))
    .map((key) => ({ key, visible: true }));
  const visibleKeys = new Set(visible.map((row) => row.key));
  const hidden = fieldKeys
    .filter((key) => !visibleKeys.has(key))
    .map((key) => ({ key, visible: false }));
  return [...visible, ...hidden];
}

/** The `columnOrder` an editor in this column state persists. `undefined` ("default": nothing
 *  to store, an existing stored order is cleared) only when EVERY field key is visible in
 *  natural order -- a visible subset in natural relative order is NOT default, because the
 *  renderer treats `columnOrder` as the visible set and mapping it to default would un-hide
 *  columns (HEL-1389). Before the node's columns have loaded (`fieldKeys` empty) the stored
 *  order is returned as-is so an untouched save stays a no-op. */
export function deriveColumnOrder(
  columns: TableColumnRow[],
  fieldKeys: string[],
  storedColumnOrder: string[] | undefined,
): string[] | undefined {
  if (fieldKeys.length === 0) return storedColumnOrder;
  const visible = columns.filter((c) => c.visible).map((c) => c.key);
  // Nothing visible reads back as "all visible" (`buildOutputColumns` treats [] as no order).
  if (visible.length === 0) return undefined;
  const isDefault =
    visible.length === fieldKeys.length && visible.every((k, i) => k === fieldKeys[i]);
  return isDefault ? undefined : visible;
}

export interface OutputTableColumnsState {
  columns: TableColumnRow[];
  toggleVisible: (key: string) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  moveToTop: (index: number) => void;
  moveToBottom: (index: number) => void;
  /** `undefined` when every column is visible in natural field order (nothing
   *  to persist), else the ordered list of visible keys (see `deriveColumnOrder`). */
  columnOrder: string[] | undefined;
}

export function useOutputTableColumns(
  fieldKeys: string[],
  initialColumnOrder: string[] | undefined,
): OutputTableColumnsState {
  const buildKey = `${fieldKeys.join(",")}`;
  const [builtKey, setBuiltKey] = useState(buildKey);
  const [columns, setColumns] = useState<TableColumnRow[]>(() =>
    buildOutputColumns(fieldKeys, initialColumnOrder),
  );
  if (builtKey !== buildKey) {
    setBuiltKey(buildKey);
    setColumns(buildOutputColumns(fieldKeys, initialColumnOrder));
  }

  const toggleVisible = (key: string) =>
    setColumns((prev) =>
      prev.map((row) => (row.key === key ? { ...row, visible: !row.visible } : row)),
    );
  const moveUp = (index: number) =>
    setColumns((prev) => {
      if (index <= 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  const moveDown = (index: number) =>
    setColumns((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  const moveToTop = (index: number) =>
    setColumns((prev) => {
      if (index <= 0 || index >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(index, 1);
      next.unshift(row);
      return next;
    });
  const moveToBottom = (index: number) =>
    setColumns((prev) => {
      if (index < 0 || index >= prev.length - 1) return prev;
      const next = [...prev];
      const [row] = next.splice(index, 1);
      next.push(row);
      return next;
    });

  return {
    columns,
    toggleVisible,
    moveUp,
    moveDown,
    moveToTop,
    moveToBottom,
    columnOrder: deriveColumnOrder(columns, fieldKeys, initialColumnOrder),
  };
}
