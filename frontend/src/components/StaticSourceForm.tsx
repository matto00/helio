import { type FormEvent, useState } from "react";

import type { StaticColumn, StaticColumnType } from "../types/models";

const COLUMN_TYPES: StaticColumnType[] = ["string", "integer", "float", "boolean"];

type StaticStep = "columns" | "rows";

export interface StaticSourceFormProps {
  name: string;
  onSubmit: (columns: StaticColumn[], rows: unknown[][]) => void;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
}

export function StaticSourceForm({
  name,
  onSubmit,
  isLoading,
  error,
  onCancel,
}: StaticSourceFormProps) {
  const [step, setStep] = useState<StaticStep>("columns");
  const [columns, setColumns] = useState<StaticColumn[]>([{ name: "", type: "string" }]);
  const [rows, setRows] = useState<string[][]>([]);
  const [columnError, setColumnError] = useState<string | null>(null);

  function addColumn() {
    setColumns((prev) => [...prev, { name: "", type: "string" }]);
  }

  function updateColumn(index: number, field: keyof StaticColumn, value: string) {
    setColumns((prev) =>
      prev.map((col, i) => (i === index ? { ...col, [field]: value as StaticColumnType } : col)),
    );
  }

  function removeColumn(index: number) {
    setColumns((prev) => prev.filter((_, i) => i !== index));
    setRows((prev) => prev.map((row) => row.filter((_, i) => i !== index)));
  }

  function addRow() {
    setRows((prev) => [...prev, columns.map(() => "")]);
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
    const hasEmpty = columns.some((col) => !col.name.trim());
    if (columns.length === 0 || hasEmpty) {
      setColumnError("All columns must have a name.");
      return;
    }
    const names = columns.map((c) => c.name.trim());
    if (new Set(names).size !== names.length) {
      setColumnError("Column names must be unique.");
      return;
    }
    setColumnError(null);
    setRows((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((row) => {
        const padded = [...row];
        while (padded.length < columns.length) padded.push("");
        return padded.slice(0, columns.length);
      });
    });
    setStep("rows");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const typedRows = rows.map((row) =>
      row.map((cell, ci) => {
        const colType = columns[ci]?.type ?? "string";
        if (colType === "integer") return cell === "" ? null : parseInt(cell, 10);
        if (colType === "float") return cell === "" ? null : parseFloat(cell);
        if (colType === "boolean") return cell === "true";
        return cell;
      }),
    );
    onSubmit(columns, typedRows);
  }

  if (step === "columns") {
    return (
      <form className="add-source-modal__form" onSubmit={handleNextStep}>
        <p className="add-source-modal__preview-hint">
          Define the columns for your static data source.
        </p>

        <table className="add-source-modal__fields-table" aria-label="Column definitions">
          <thead>
            <tr>
              <th>Column name</th>
              <th>Type</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="text"
                    className="add-source-modal__cell-input"
                    aria-label={`Column ${index + 1} name`}
                    value={col.name}
                    onChange={(e) => updateColumn(index, "name", e.target.value)}
                    placeholder="column_name"
                  />
                </td>
                <td>
                  <select
                    className="add-source-modal__cell-select"
                    aria-label={`Column ${index + 1} type`}
                    value={col.type}
                    onChange={(e) => updateColumn(index, "type", e.target.value)}
                  >
                    {COLUMN_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="add-source-modal__action-link"
                    aria-label={`Remove column ${index + 1}`}
                    onClick={() => removeColumn(index)}
                    disabled={columns.length <= 1}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          type="button"
          className="add-source-modal__btn add-source-modal__btn--secondary"
          onClick={addColumn}
          style={{ alignSelf: "flex-start" }}
        >
          + Add column
        </button>

        {columnError && (
          <p className="add-source-modal__error" role="alert">
            {columnError}
          </p>
        )}

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

      <div style={{ overflowX: "auto" }}>
        <table className="add-source-modal__fields-table" aria-label="Data rows">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.name}>
                  {col.name} <span className="add-source-modal__optional">({col.type})</span>
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="add-source-modal__empty"
                  style={{ textAlign: "center", padding: "1rem" }}
                >
                  No rows yet. Click &ldquo;Add row&rdquo; to start.
                </td>
              </tr>
            )}
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <input
                      type={columns[ci]?.type === "boolean" ? "text" : "text"}
                      className="add-source-modal__cell-input"
                      aria-label={`Row ${ri + 1} ${columns[ci]?.name ?? ""}`}
                      value={cell}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      placeholder={columns[ci]?.type === "boolean" ? "true / false" : ""}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="add-source-modal__action-link"
                    aria-label={`Remove row ${ri + 1}`}
                    onClick={() => removeRow(ri)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="add-source-modal__btn add-source-modal__btn--secondary"
        onClick={addRow}
        style={{ alignSelf: "flex-start" }}
      >
        + Add row
      </button>

      {error && (
        <p className="add-source-modal__error" role="alert">
          {error}
        </p>
      )}

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
