import type { ReactNode } from "react";

import { formatCell } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import {
  resolveCellRule,
  resolveRowRule,
  ruleName,
  type ConditionalFormatRule,
} from "./conditionalFormatting";
import { ToneGlyph, ToneSrText } from "./ToneGlyph";

// HEL-1307 -- the table half of conditional formatting, kept out of `TableRenderer.tsx` / `DataGrid.tsx`
// (both over their size budget). Rule resolution is by ROW OBJECT, so it survives the table's own
// sort/filter (like HEL-1277's `rowClassName`).
//
// Where each signal lives (design D6):
//  - row rule  -> class `ui-data-grid__row--tone-<tone>` on the <tr>; CSS paints that row's <td>s.
//  - cell rule -> class `ui-data-grid__cell--tone-<tone>` on that <td> (CSS makes it REPLACE the row wash).
//  - non-colour signal: an inline glyph + sr-only text. A cell rule's mark sits in its own cell; a row rule's
//    mark sits at the start of the row's first VISIBLE data cell, so a hidden rule column still has one.

type Row = Record<string, unknown>;

function Mark({ rule }: { rule: ConditionalFormatRule }) {
  return (
    <span
      className={`ui-data-grid__tone-mark ui-data-grid__tone-mark--${rule.tone}`}
      title={ruleName(rule)}
    >
      <ToneGlyph tone={rule.tone} size="sm" />
      <ToneSrText rule={rule} />
    </span>
  );
}

/** Wrap each data column so its cells carry the cell-rule class and the glyph marks. `columns` are the
 *  visible DATA columns in display order (render-only leading columns are not passed here). Columns no rule
 *  can touch are returned unchanged (same object), so a table with no matching rules is DOM-identical. */
export function withCellRules(
  columns: ColumnDef[],
  rules: readonly ConditionalFormatRule[] | undefined,
): ColumnDef[] {
  if (!rules || rules.length === 0) return columns;
  const hasRowRules = rules.some((r) => r.target === "row");
  return columns.map((col, index) => {
    const touchedByCell = rules.some(
      (r) => r.column === col.key && (r.target ?? "cell") === "cell",
    );
    const carriesRowMark = hasRowRules && index === 0;
    if (!touchedByCell && !carriesRowMark) return col;
    const base = col.render ?? ((_row: Row, value: unknown): ReactNode => formatCell(value));
    return {
      ...col,
      cellClassName: (row: Row) => {
        const own = col.cellClassName?.(row);
        const cellRule = touchedByCell ? resolveCellRule(rules, row, col.key) : null;
        return (
          [own, cellRule ? `ui-data-grid__cell--tone-${cellRule.tone}` : null]
            .filter(Boolean)
            .join(" ") || undefined
        );
      },
      render: (row: Row, value: unknown): ReactNode => {
        const cellRule = touchedByCell ? resolveCellRule(rules, row, col.key) : null;
        const rowRule = carriesRowMark ? resolveRowRule(rules, row) : null;
        const content = base(row, value);
        if (!cellRule && !rowRule) return content;
        return (
          <>
            {rowRule && <Mark rule={rowRule} />}
            {cellRule && <Mark rule={cellRule} />}
            {content}
          </>
        );
      },
    };
  });
}

/** Compose the caller's `rowClassName` with the row-rule class. Returns the caller's function untouched when
 *  there are no rules. */
export function withRowRules(
  rowClassName: ((row: Row) => string | undefined) | undefined,
  rules: readonly ConditionalFormatRule[] | undefined,
): ((row: Row) => string | undefined) | undefined {
  if (!rules || !rules.some((r) => r.target === "row")) return rowClassName;
  return (row: Row) => {
    const rowRule = resolveRowRule(rules, row);
    return (
      [rowClassName?.(row), rowRule ? `ui-data-grid__row--tone-${rowRule.tone}` : null]
        .filter(Boolean)
        .join(" ") || undefined
    );
  };
}
