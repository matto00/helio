// SortConfig — ordered list of {field, direction} pairs for the "sort" pipeline op.
// Renders one row per sort key with a field selector and asc/desc toggle.
// Calls onChange with '{"sortBy":[...]}' on every structural change.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDownLong, faArrowUpLong, faXmark } from "@fortawesome/free-solid-svg-icons";

import { Select } from "../../../shared/ui/index";

export interface SortKey {
  field: string;
  direction: "asc" | "desc";
}

interface SortConfigProps {
  /** Current sort keys (parsed from the step config). */
  sortBy: SortKey[];
  /** Column names from the analyze endpoint's inputSchema for field selection. */
  columns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: { sortBy: SortKey[] }) => void;
}

export function SortConfig({ sortBy, columns, onChange }: SortConfigProps) {
  function emit(next: SortKey[]) {
    onChange({ sortBy: next });
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
              <Select
                ariaLabel={`Sort key ${index + 1} field`}
                value={key.field}
                options={(() => {
                  const baseOpts = columns.map((col) => ({ value: col, label: col }));
                  // Preserve the current value as an option even if it's no longer
                  // in `columns` (schema changed but the user's selection stuck).
                  return key.field && !columns.includes(key.field)
                    ? [...baseOpts, { value: key.field, label: key.field }]
                    : baseOpts;
                })()}
                onChange={(next) => handleFieldChange(index, next)}
              />
              <button
                type="button"
                className="pipeline-detail-page__sort-config-direction-btn"
                aria-label={`Sort key ${index + 1} direction: ${key.direction}`}
                onClick={() => handleDirectionToggle(index)}
              >
                <FontAwesomeIcon icon={key.direction === "asc" ? faArrowUpLong : faArrowDownLong} />{" "}
                {key.direction}
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
