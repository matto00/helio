// HEL-255 — Table display-config editor state (density, column visibility +
// order, pending width reset) for `BindingEditor`'s Table panel edit pane.
//
// Extracted as a hook (mirroring `useBoundOrLiteralState`) so `BindingEditor`
// stays within the file-size budget and the ordering/visibility bookkeeping
// lives in one testable place. Presentational rendering is `TableDisplayFields`.

import { useState } from "react";

import type { Panel, TableDensity } from "../../types/panel";
import type { TableDisplayPatch } from "../../services/panelService";

export const DEFAULT_TABLE_DENSITY: TableDensity = "normal";

export interface TableColumnRow {
  key: string;
  visible: boolean;
}

export interface TableDisplayState {
  density: TableDensity;
  setDensity: (density: TableDensity) => void;
  columns: TableColumnRow[];
  toggleVisible: (key: string) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  hasStoredWidths: boolean;
  resetWidthsPending: boolean;
  requestResetWidths: () => void;
  dirty: boolean;
  reset: () => void;
  /** The display slice of the Save PATCH — `undefined`-valued fields are
   *  omitted entirely by `buildBindingPatch`. */
  patch: TableDisplayPatch;
}

/** All field keys visible in natural order → build one visible row per key. A
 *  non-empty `columnOrder` puts its (still-present) keys first as visible, then
 *  appends any remaining data keys as hidden rows so the editor always lists
 *  every current field (design D5 / Risks). */
function buildColumns(fieldKeys: string[], columnOrder?: string[]): TableColumnRow[] {
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

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function orderEqualOrNull(a: string[] | null, b: string[] | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return arraysEqual(a, b);
}

/**
 * @param panel          the panel being edited (inert for non-table kinds).
 * @param fieldKeys      the bound DataType's field keys, natural order.
 * @param selectedTypeId the currently-picked DataType id (may differ from the
 *                       stored one mid-edit while the user re-binds).
 */
export function useTableDisplayState(
  panel: Panel,
  fieldKeys: string[],
  selectedTypeId: string | null,
): TableDisplayState {
  const isTable = panel.type === "table";
  const storedDensity: TableDensity = isTable
    ? (panel.config.density ?? DEFAULT_TABLE_DENSITY)
    : DEFAULT_TABLE_DENSITY;
  const storedColumnOrder = isTable ? panel.config.columnOrder : undefined;
  const storedWidths = isTable ? panel.config.columnWidths : undefined;
  const storedTypeId = isTable && panel.config.dataTypeId ? panel.config.dataTypeId : null;

  const [density, setDensity] = useState<TableDensity>(storedDensity);
  const [resetWidthsPending, setResetWidthsPending] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);

  // Stale `columnOrder` only applies while the picked type matches the stored
  // one; re-binding to a different type falls back to natural order.
  const seedOrder = selectedTypeId === storedTypeId ? storedColumnOrder : undefined;

  // Re-seed the column rows whenever the identity of the underlying field set
  // changes (a rebind, or fields arriving after the async DataType fetch) — or
  // on an explicit reset (nonce bump). Keyed on *content* (not object identity)
  // so a user's in-pane reorder/toggle is never clobbered by an unrelated
  // parent re-render.
  const buildKey = `${resetNonce}|${selectedTypeId ?? ""}|${JSON.stringify(fieldKeys)}`;
  const [builtKey, setBuiltKey] = useState(buildKey);
  const [columns, setColumns] = useState<TableColumnRow[]>(() =>
    buildColumns(fieldKeys, seedOrder),
  );
  if (builtKey !== buildKey) {
    setBuiltKey(buildKey);
    setColumns(buildColumns(fieldKeys, seedOrder));
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

  const hasStoredWidths = !!storedWidths && Object.keys(storedWidths).length > 0;

  // Desired columnOrder: `null` (→ default) when every field is visible in
  // natural order; otherwise the visible keys in row order.
  const visibleOrdered = columns.filter((row) => row.visible).map((row) => row.key);
  const desiredColumnOrder: string[] | null = arraysEqual(visibleOrdered, fieldKeys)
    ? null
    : visibleOrdered;
  const storedColumnOrderNormalized: string[] | null =
    storedColumnOrder && storedColumnOrder.length > 0 ? storedColumnOrder : null;

  const columnOrderChanged =
    selectedTypeId === storedTypeId
      ? !orderEqualOrNull(desiredColumnOrder, storedColumnOrderNormalized)
      : desiredColumnOrder !== null;
  const densityChanged = density !== storedDensity;

  const dirty = densityChanged || columnOrderChanged || resetWidthsPending;

  const patch: TableDisplayPatch = {
    density: densityChanged ? density : undefined,
    columnOrder: columnOrderChanged ? desiredColumnOrder : undefined,
    columnWidths: resetWidthsPending ? null : undefined,
  };

  const reset = () => {
    setDensity(storedDensity);
    setResetWidthsPending(false);
    setResetNonce((nonce) => nonce + 1);
  };

  return {
    density,
    setDensity,
    columns,
    toggleVisible,
    moveUp,
    moveDown,
    hasStoredWidths,
    resetWidthsPending,
    requestResetWidths: () => setResetWidthsPending(true),
    dirty,
    reset,
    patch,
  };
}
