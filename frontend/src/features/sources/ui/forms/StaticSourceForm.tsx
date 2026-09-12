import { type FormEvent, useRef, useState } from "react";

import { InlineError } from "../../../../shared/chrome/InlineError";
import type { StaticColumn } from "../../types/dataSource";
import { TextField } from "../../../../shared/ui/index";
import { X } from "lucide-react";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import {
  emptyFieldDeclarationRow,
  FieldDeclarationTable,
  type FieldDeclarationRow,
} from "../FieldDeclarationTable";
import { getEditorKind } from "../../hooks/useDatasetFieldEditor";

type StaticStep = "columns" | "rows";

export interface StaticSourceFormProps {
  name: string;
  onSubmit: (columns: StaticColumn[], rows: unknown[][]) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
}

/** Converts a `FieldDeclarationRow`'s raw editor `default` string into the typed value
 *  `StaticColumn.default` should carry -- empty means "no default declared" (`undefined`, not
 *  a literal `null`), mirroring `useDatasetFieldEditor`'s "emptied means null, blank means
 *  absent" convention used elsewhere in this feature. */
function parseDefault(row: FieldDeclarationRow): unknown {
  if (row.default.trim() === "") return undefined;
  if (row.type === "integer") {
    const n = parseInt(row.default, 10);
    return Number.isNaN(n) ? row.default : n;
  }
  if (row.type === "float") {
    const n = parseFloat(row.default);
    return Number.isNaN(n) ? row.default : n;
  }
  if (row.type === "boolean") return row.default === "true";
  return row.default;
}

export function StaticSourceForm({
  name,
  onSubmit,
  isLoading,
  error,
  onCancel,
}: StaticSourceFormProps) {
  const [step, setStep] = useState<StaticStep>("columns");
  const [fieldRows, setFieldRows] = useState<FieldDeclarationRow[]>([emptyFieldDeclarationRow()]);
  const [rows, setRows] = useState<string[][]>([]);
  const [columnError, setColumnError] = useState<string | null>(null);
  const addFieldButtonRef = useRef<HTMLButtonElement>(null);

  function handleFieldRowsChange(next: FieldDeclarationRow[]) {
    // tasks.md 1.5: reordering columns after rows have been entered must keep each row's cells
    // aligned to the new column order -- mirrors `removeColumn`'s existing re-slice below.
    if (next.length === fieldRows.length && rows.length > 0) {
      const oldOrder = fieldRows.map((r) => r.id);
      const newOrder = next.map((r) => r.id);
      const isReorder = oldOrder.every((id) => newOrder.includes(id));
      if (isReorder) {
        const permutation = newOrder.map((id) => oldOrder.indexOf(id));
        setRows((prev) => prev.map((row) => permutation.map((i) => row[i])));
      }
    } else if (next.length < fieldRows.length) {
      // A field was removed -- re-slice each row to drop the corresponding cell.
      const removedIndex = fieldRows.findIndex((r) => !next.some((n) => n.id === r.id));
      if (removedIndex !== -1) {
        setRows((prev) => prev.map((row) => row.filter((_, i) => i !== removedIndex)));
      }
    }
    setFieldRows(next);
  }

  function addRow() {
    setRows((prev) => [...prev, fieldRows.map(() => "")]);
  }

  function removeRow(rowIndex: number) {
    setRows((prev) => prev.filter((_, i) => i !== rowIndex));
  }

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    setRows((prev) =>
      prev.map((row, ri) =>
        ri === rowIndex ? row.map((cell, ci) => (ci === colIndex ? value : cell)) : row,
      ),
    );
  }

  function handleNextStep(e: FormEvent) {
    e.preventDefault();
    // F-180: require the source name before advancing to the rows step —
    // otherwise that step's "Enter data rows for <name>." hint renders with
    // a blank name. Mirrors the CSV/REST configure form's own name gate
    // before "Preview schema".
    if (!name.trim()) {
      setColumnError("Source name is required.");
      return;
    }
    const hasEmpty = fieldRows.some((r) => !r.name.trim());
    if (fieldRows.length === 0 || hasEmpty) {
      setColumnError("All fields must have a name.");
      return;
    }
    const names = fieldRows.map((r) => r.name.trim());
    if (new Set(names).size !== names.length) {
      setColumnError("Field names must be unique.");
      return;
    }
    setColumnError(null);
    setRows((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((row) => {
        const padded = [...row];
        while (padded.length < fieldRows.length) padded.push("");
        return padded.slice(0, fieldRows.length);
      });
    });
    setStep("rows");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const columns: StaticColumn[] = fieldRows.map((r) => {
      const parsedDefault = parseDefault(r);
      return {
        name: r.name.trim(),
        type: r.type,
        required: r.required,
        ...(parsedDefault !== undefined ? { default: parsedDefault } : {}),
      };
    });
    const typedRows = rows.map((row) =>
      row.map((cell, ci) => {
        const colType = fieldRows[ci]?.type ?? "string";
        // HEL-1076 tasks.md 3.1: `parseInt`/`parseFloat` return `NaN` for an unparseable cell
        // (e.g. stray text in a numeric column) -- `JSON.stringify(NaN)` silently serializes to
        // `null`, which the backend's DatasetRowValidator would then treat as "missing" rather
        // than reject as a type mismatch. Fall back to the raw string on a failed parse so the
        // validator sees (and rejects) the actual bad value instead of it vanishing as null.
        if (colType === "integer") {
          if (cell === "") return null;
          const n = parseInt(cell, 10);
          return Number.isNaN(n) ? cell : n;
        }
        if (colType === "float") {
          if (cell === "") return null;
          const n = parseFloat(cell);
          return Number.isNaN(n) ? cell : n;
        }
        if (colType === "boolean") return cell === "true";
        return cell;
      }),
    );
    onSubmit(columns, typedRows);
  }

  if (step === "columns") {
    return (
      <form className="add-source-modal__form" onSubmit={handleNextStep}>
        <p className="add-source-modal__preview-hint">Declare the fields for your dataset.</p>

        <FieldDeclarationTable
          rows={fieldRows}
          onChange={handleFieldRowsChange}
          addFieldButtonRef={addFieldButtonRef}
          idPrefix="static-source-create"
        />

        <InlineError error={columnError} />

        <div className="add-source-modal__actions">
          <button
            type="button"
            className="add-source-modal__btn add-source-modal__btn--secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="add-source-modal__btn add-source-modal__btn--primary">
            Next: Add rows
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="add-source-modal__form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="add-source-modal__preview-hint">
        Enter data rows for <strong>{name}</strong>.
      </p>

      <div className="add-source-modal__table-wrap">
        <table className="add-source-modal__fields-table" aria-label="Data rows">
          <thead>
            <tr>
              {fieldRows.map((r) => (
                <th key={r.id}>
                  {r.name} <span className="add-source-modal__optional">({r.type})</span>
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={fieldRows.length + 1}
                  className="add-source-modal__empty add-source-modal__empty-cell"
                >
                  No rows yet. Click &ldquo;Add row&rdquo; to start.
                </td>
              </tr>
            )}
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  const field = fieldRows[ci];
                  const isReadonly = field ? getEditorKind(field.type) === "readonly" : false;
                  return (
                    <td key={ci}>
                      <TextField
                        type="text"
                        aria-label={`Row ${ri + 1} ${field?.name ?? ""}`}
                        value={cell}
                        onChange={(e) => updateCell(ri, ci, e.target.value)}
                        placeholder={
                          field?.type === "boolean"
                            ? "true / false"
                            : isReadonly
                              ? "not applicable"
                              : ""
                        }
                        disabled={isReadonly}
                      />
                    </td>
                  );
                })}
                <td>
                  <button
                    type="button"
                    className="add-source-modal__action-link"
                    aria-label={`Remove row ${ri + 1}`}
                    onClick={() => removeRow(ri)}
                  >
                    <X size={ICON_SIZE.sm} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="add-source-modal__btn add-source-modal__btn--secondary add-source-modal__btn--align-start"
        onClick={addRow}
      >
        + Add row
      </button>

      <InlineError error={error} />

      <div className="add-source-modal__actions">
        <button
          type="button"
          className="add-source-modal__btn add-source-modal__btn--secondary"
          onClick={() => setStep("columns")}
        >
          Back
        </button>
        <button
          type="submit"
          className="add-source-modal__btn add-source-modal__btn--primary"
          disabled={isLoading}
        >
          {isLoading ? "Creating…" : "Create source"}
        </button>
      </div>
    </form>
  );
}
