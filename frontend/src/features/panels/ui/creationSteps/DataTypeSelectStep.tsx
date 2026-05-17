// DataType-select step of PanelCreationModal — pickable list of DataTypes
// that have a registered pipeline producing them. Required for data-bound
// panel types (metric / chart / text / table).
//
// Pure presentational. The shell owns the pipelines + dataTypes slice
// reads and computes the filtered registry list before passing it in.

import { Link } from "react-router-dom";

import type { DataType } from "../../../dataTypes/types/dataType";

interface DataTypeSelectStepProps {
  /** True when either pipelines or data-types slice is still resolving. */
  loading: boolean;
  /** DataTypes whose id appears as the output of at least one pipeline. */
  registryDataTypes: readonly DataType[];
  /** Currently-selected DataType id, or null if none picked yet. */
  selectedDataTypeId: string | null;
  onSelect: (id: string) => void;
  /** Called when the user follows the "Go to Pipelines" link from the empty state. */
  onEmptyStateNavigate: () => void;
  onBack: () => void;
  onNext: () => void;
}

export function DataTypeSelectStep({
  loading,
  registryDataTypes,
  selectedDataTypeId,
  onSelect,
  onEmptyStateNavigate,
  onBack,
  onNext,
}: DataTypeSelectStepProps) {
  return (
    <div className="panel-creation-modal__datatype-step">
      {loading ? (
        // Loading state: show indicator while fetching pipelines or data types.
        <div className="panel-creation-modal__datatype-loading">
          <p>Loading data types...</p>
        </div>
      ) : registryDataTypes.length === 0 ? (
        // 3.6 — Empty state: no registry DataTypes available.
        <div className="panel-creation-modal__datatype-empty" data-testid="datatype-empty-state">
          <p>No data types are registered yet.</p>
          <p>
            <Link
              to="/pipelines"
              className="panel-creation-modal__datatype-empty__link"
              data-testid="datatype-empty-pipeline-link"
              onClick={onEmptyStateNavigate}
            >
              Go to Pipelines to create one.
            </Link>
          </p>
        </div>
      ) : (
        // 3.7 — DataType list as clickable cards.
        <div className="panel-creation-modal__datatype-list" role="group" aria-label="Data type">
          {registryDataTypes.map((dt) => (
            <button
              key={dt.id}
              type="button"
              className={`panel-creation-modal__datatype-card${selectedDataTypeId === dt.id ? " panel-creation-modal__datatype-card--selected" : ""}`}
              aria-label={dt.name}
              aria-pressed={selectedDataTypeId === dt.id}
              onClick={() => onSelect(dt.id)}
            >
              <span className="panel-creation-modal__datatype-name">{dt.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="panel-creation-modal__actions">
        <button
          type="button"
          className="panel-creation-modal__btn panel-creation-modal__btn--secondary"
          onClick={onBack}
        >
          Back
        </button>
        {/* 3.7 / 3.8 — Next button disabled until a DataType is selected. */}
        <button
          type="button"
          className="panel-creation-modal__btn panel-creation-modal__btn--primary"
          disabled={selectedDataTypeId === null}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </div>
  );
}
