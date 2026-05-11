// SortConfig — ordered list of {field, direction} pairs for the "sort" pipeline op.
// Renders one row per sort key with a field selector and asc/desc toggle.
// Calls onChange with '{"sortBy":[...]}' on every structural change.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

export interface SortKey {
  field: string;
  direction: "asc" | "desc";
}

interface SortConfigProps {
  /** Current sort keys (parsed from the step config). */
  sortBy: SortKey[];
  /** Column names from the analyze endpoint's inputSchema for field selection. */
  columns: string[];
  /** Called with the new serialized config JSON string on any change. */
  onChange: (newConfig: string) => void;
}

export function SortConfig({ sortBy, columns, onChange }: SortConfigProps) {
  function emit(next: SortKey[]) {
    onChange(JSON.stringify({ sortBy: next }));
  }

  function handleAddKey() {
    const newKey: SortKey = { field: columns[0] ?? "", direction: "asc" };
    emit([...sortBy, newKey]);
  }

  function handleRemoveKey(index: number) {
    emit(sortBy.filter((_, i) => i !== index));
  }

  function handleFieldChange(index: number, field: string) {
    const next = sortBy.map((k, i) => (i === index ? { ...k, field } : k));
    emit(next);
  }

  function handleDirectionToggle(index: number) {
    const next = sortBy.map((k, i) =>
      i === index
        ? { ...k, direction: k.direction === "asc" ? ("desc" as const) : ("asc" as const) }
        : k,
    );
    emit(next);
  }

  return (
    <div className="pipeline-detail-page__sort-config">
      {sortBy.length === 0 ? (
        <p className="pipeline-detail-page__sort-config-empty">
          No sort keys. Click &ldquo;Add sort key&rdquo; to sort rows.
        </p>
      ) : (
        <ol className="pipeline-detail-page__sort-config-list">
          {sortBy.map((key, index) => (
            <li key={index} className="pipeline-detail-page__sort-config-row">
              <span className="pipeline-detail-page__sort-config-index" aria-hidden="true">
                {index + 1}.
              </span>
              <select
                className="pipeline-detail-page__sort-config-field-select"
                value={key.field}
                aria-label={`Sort key ${index + 1} field`}
                onChange={(e) => handleFieldChange(index, e.target.value)}
              >
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
                {/* Keep selected value even if no longer in columns */}
                {key.field && !columns.includes(key.field) && (
                  <option value={key.field}>{key.field}</option>
                )}
              </select>
              <button
                type="button"
                className="pipeline-detail-page__sort-config-direction-btn"
                aria-label={`Sort key ${index + 1} direction: ${key.direction}`}
                onClick={() => handleDirectionToggle(index)}
              >
                {key.direction === "asc" ? "↑ asc" : "↓ desc"}
              </button>
              <button
                type="button"
                className="pipeline-detail-page__sort-config-remove-btn"
                aria-label={`Remove sort key ${index + 1}`}
                onClick={() => handleRemoveKey(index)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className="pipeline-detail-page__sort-config-add-btn"
        onClick={handleAddKey}
        disabled={columns.length === 0}
      >
        + Add sort key
      </button>
    </div>
  );
}
