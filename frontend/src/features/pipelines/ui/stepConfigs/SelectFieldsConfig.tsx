// SelectFieldsConfig — checklist of field names for the "select" pipeline op.
// Renders a checklist from the per-step inputSchema provided by the analyze endpoint.
// Renders an empty checklist when columns is empty (source has no schema yet).

interface SelectFieldsConfigProps {
  /** Column names derived from the step's inputSchema (from the analyze response). */
  columns: string[];
  /** Currently selected field names (from the step's persisted config). */
  selectedFields: string[];
  /** Called when the user toggles a field checkbox. */
  onToggle: (field: string, checked: boolean) => void;
}

export function SelectFieldsConfig({ columns, selectedFields, onToggle }: SelectFieldsConfigProps) {
  if (columns.length === 0) {
    return (
      <ul
        className="pipeline-detail-page__select-fields-list"
        role="list"
        aria-label="Available fields"
      />
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
