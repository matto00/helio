// HEL-827: shared ordered key/value list editor — used for both REST
// queryParams and headers (design.md Decision 2/5). Represented as an
// ordered `{ key, value }[]` rather than a plain object so the UI never
// pre-collapses a duplicate key the way `splitUrl` does server-side
// (that collapse is deferred, filed separately); a duplicate key is flagged
// here, non-blocking, instead.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";

import { TextField } from "../../../../shared/ui/TextField";
import { IconButton } from "../../../../shared/ui/IconButton";
import type { KeyValueEntry } from "../../hooks/useRestSourceForm";
import "./KeyValueListField.css";

interface KeyValueListFieldProps {
  label: string;
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}

export function KeyValueListField({
  label,
  entries,
  onChange,
  keyPlaceholder = "Name",
  valuePlaceholder = "Value",
  addLabel = "Add row",
}: KeyValueListFieldProps) {
  const keyCounts = new Map<string, number>();
  for (const entry of entries) {
    const trimmedKey = entry.key.trim();
    if (!trimmedKey) continue;
    keyCounts.set(trimmedKey, (keyCounts.get(trimmedKey) ?? 0) + 1);
  }

  function updateEntry(index: number, field: "key" | "value", value: string) {
    onChange(entries.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  }

  function removeEntry(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }

  function addEntry() {
    onChange([...entries, { key: "", value: "" }]);
  }

  return (
    <div className="key-value-list-field">
      <span className="key-value-list-field__label">{label}</span>
      {entries.map((entry, index) => {
        const trimmedKey = entry.key.trim();
        const isDuplicate = trimmedKey !== "" && (keyCounts.get(trimmedKey) ?? 0) > 1;
        return (
          <div className="key-value-list-field__row" key={index}>
            <TextField
              value={entry.key}
              onChange={(e) => updateEntry(index, "key", e.target.value)}
              placeholder={keyPlaceholder}
              aria-label={`${label} name`}
              aria-invalid={isDuplicate}
            />
            <TextField
              value={entry.value}
              onChange={(e) => updateEntry(index, "value", e.target.value)}
              placeholder={valuePlaceholder}
              aria-label={`${label} value`}
            />
            <IconButton
              icon={<FontAwesomeIcon icon={faTrash} />}
              aria-label={`Remove ${label.toLowerCase()} row`}
              onClick={() => removeEntry(index)}
              variant="ghost"
              size="sm"
            />
            {isDuplicate && (
              <span className="key-value-list-field__duplicate" role="alert">
                Duplicate name &quot;{trimmedKey}&quot; — only the last value is used.
              </span>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="key-value-list-field__add"
        onClick={addEntry}
        aria-label={addLabel}
      >
        <FontAwesomeIcon icon={faPlus} aria-hidden="true" /> {addLabel}
      </button>
    </div>
  );
}
