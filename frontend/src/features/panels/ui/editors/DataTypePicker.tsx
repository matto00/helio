// The "Data type" section — search/select a bindable (pipeline-output)
// DataType, or show the currently-selected one with a clear button.
// Extracted out of `BindingEditor` (HEL-243) to keep that file under the
// CONTRIBUTING.md file-size soft budget; behavior is unchanged from the
// pre-extraction inline JSX.

import { Link } from "react-router-dom";

import { TextField } from "../../../../shared/ui/index";
import type { DataType } from "../../../dataTypes/types/dataType";

interface DataTypePickerProps {
  selectedType: DataType | null;
  typeSearch: string;
  onTypeSearchChange: (value: string) => void;
  dataTypesStatus: "idle" | "loading" | "succeeded" | "failed";
  filteredDataTypes: DataType[];
  selectedTypeId: string | null;
  onSelect: (dataTypeId: string) => void;
  onClear: () => void;
}

/** Presentational only — `BindingEditor` owns `selectedTypeId`/`fieldMapping`
 *  state and the save/dirty/reset plumbing. */
export function DataTypePicker({
  selectedType,
  typeSearch,
  onTypeSearchChange,
  dataTypesStatus,
  filteredDataTypes,
  selectedTypeId,
  onSelect,
  onClear,
}: DataTypePickerProps) {
  return (
    <div className="panel-detail-modal__data-section">
      <span className="panel-detail-modal__data-label">Data type</span>
      {selectedType ? (
        <div className="panel-detail-modal__selected-type">
          <span className="panel-detail-modal__selected-type-name">{selectedType.name}</span>
          <span className="panel-detail-modal__type-count">
            {selectedType.fields.length} fields
          </span>
          <button
            type="button"
            className="panel-detail-modal__type-clear"
            aria-label="Clear selected data type"
            onClick={onClear}
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <TextField
            type="text"
            placeholder="Search data types…"
            value={typeSearch}
            onChange={(e) => onTypeSearchChange(e.target.value)}
            aria-label="Search data types"
          />
          {dataTypesStatus === "loading" ? (
            <p className="panel-detail-modal__type-hint">Loading…</p>
          ) : filteredDataTypes.length === 0 ? (
            <p className="panel-detail-modal__type-hint">No data types found.</p>
          ) : (
            <ul className="panel-detail-modal__type-list" role="listbox" aria-label="Data types">
              {filteredDataTypes.map((dt) => (
                <li
                  key={dt.id}
                  role="option"
                  aria-selected={dt.id === selectedTypeId}
                  className="panel-detail-modal__type-option"
                  onClick={() => onSelect(dt.id)}
                >
                  <span className="panel-detail-modal__selected-type-name">{dt.name}</span>
                  <span className="panel-detail-modal__type-count">{dt.fields.length} fields</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Link to="/pipelines" className="panel-detail-modal__source-link">
        Create a pipeline →
      </Link>
    </div>
  );
}
