// RenameFieldsConfig — table of (source field | target name input) rows for the "rename" pipeline op.
// Renders one row per column from the per-step inputSchema provided by the analyze endpoint.
// Renders an empty table when columns is empty (source has no schema yet).

import { TextField } from "./ui";

interface RenameFieldsConfigProps {
  /** Column names derived from the step's inputSchema (from the analyze response). */
  columns: string[];
  /** Current rename mappings: { sourceField: targetName }. Empty string means no rename. */
  renames: Record<string, string>;
  /** Called when the user changes the target name for a field. */
  onChange: (field: string, newName: string) => void;
}

export function RenameFieldsConfig({ columns, renames, onChange }: RenameFieldsConfigProps) {
  return (
    <table className="pipeline-detail-page__rename-table" aria-label="Rename fields">
      <thead>
        <tr>
          <th className="pipeline-detail-page__rename-th">Source field</th>
          <th className="pipeline-detail-page__rename-th">New name</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((col) => (
          <tr key={col} className="pipeline-detail-page__rename-row">
            <td className="pipeline-detail-page__rename-source">{col}</td>
            <td className="pipeline-detail-page__rename-target">
              <TextField
                aria-label={`New name for ${col}`}
                value={renames[col] ?? ""}
                onChange={(e) => {
                  onChange(col, e.target.value);
                }}
                placeholder={col}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
