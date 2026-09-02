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

export interface OutputTableColumnsState {
  columns: TableColumnRow[];
  toggleVisible: (key: string) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  moveToTop: (index: number) => void;
  moveToBottom: (index: number) => void;
  /** `undefined` when the visible order matches natural field order (nothing
   *  to persist), else the ordered list of visible keys. */
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

  const visible = columns.filter((c) => c.visible).map((c) => c.key);
  const natural = fieldKeys.filter((k) => visible.includes(k));
  const orderMatchesNatural =
    visible.length === natural.length && visible.every((k, i) => k === natural[i]);

  return {
    columns,
    toggleVisible,
    moveUp,
    moveDown,
    moveToTop,
    moveToBottom,
    columnOrder: orderMatchesNatural ? undefined : visible,
  };
}
