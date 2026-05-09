// SelectFieldsConfig — checklist of field names for the "select" pipeline op.
// Renders a checklist when column names are available from the last run result.
// Falls back to an informational prompt when no run has been executed yet.

interface SelectFieldsConfigProps {
  /** Column names derived from the previous step's last run output. Empty = no run yet. */
  columns: string[];
  /** Currently selected field names (from the step's persisted config). */
  selectedFields: string[];
  /** Called when the user toggles a field checkbox. */
  onToggle: (field: string, checked: boolean) => void;
}

export function SelectFieldsConfig({ columns, selectedFields, onToggle }: SelectFieldsConfigProps) {
  if (columns.length === 0) {
    return (
      <p className="pipeline-detail-page__select-fields-prompt">
        Run the pipeline to preview available fields.
      </p>
    );
  }

  return (
    <ul className="pipeline-detail-page__select-fields-list" role="list">
      {columns.map((col) => (
        <li key={col} className="pipeline-detail-page__select-fields-item">
          <label className="pipeline-detail-page__select-fields-label">
            <input
              type="checkbox"
              className="pipeline-detail-page__select-fields-checkbox"
              checked={selectedFields.includes(col)}
              onChange={(e) => {
                onToggle(col, e.target.checked);
              }}
            />
            {col}
          </label>
        </li>
      ))}
    </ul>
  );
}
