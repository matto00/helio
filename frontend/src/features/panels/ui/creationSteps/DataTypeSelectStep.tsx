// DataType-select step of PanelCreationModal — pickable list of DataTypes
// that have a registered pipeline producing them. Required for data-bound
// panel types (metric / chart / text / table).
//
// HEL-399: for metric/chart/table panel types, also offers "start from a
// shape" cards (filtered from the live shape catalog via `PANEL_TYPE_SHAPES`
// — see `panelShapes.ts`), alongside the existing DataType list. Selecting a
// shape card diverges entirely from the existing-DataType path: it does not
// select a DataType and advances the modal to the shape-instantiate step
// instead of enabling "Next".
//
// Pure presentational. The shell owns the pipelines + dataTypes slice
// reads and computes the filtered registry list before passing it in.

import { Link } from "react-router-dom";

import { InlineError } from "../../../../shared/chrome/InlineError";
import type { DataType } from "../../../dataTypes/types/dataType";
import type { PipelineShapeCatalogEntry } from "../../../pipelines/types/pipelineShape";

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
  /** Shape catalog entries matching this panel type's `PANEL_TYPE_SHAPES`
   *  mapping, already filtered by the shell. Empty for panel types that
   *  offer no shapes (e.g. `text`, `markdown`) — no cards render then. */
  offeredShapes: readonly PipelineShapeCatalogEntry[];
  /** Set when this panel type maps to at least one shape but the catalog
   *  fetch itself failed — shown inline rather than silently omitting the
   *  shape section with no explanation. */
  shapeCatalogError?: string | null;
  /** Called when a shape card is clicked; diverges from `onSelect`
   *  entirely — see file header. */
  onSelectShape: (shape: PipelineShapeCatalogEntry) => void;
}

export function DataTypeSelectStep({
  loading,
  registryDataTypes,
  selectedDataTypeId,
  onSelect,
  onEmptyStateNavigate,
  onBack,
  onNext,
  offeredShapes,
  shapeCatalogError,
  onSelectShape,
}: DataTypeSelectStepProps) {
  return (
    <div className="panel-creation-modal__datatype-step">
      {(offeredShapes.length > 0 || shapeCatalogError) && (
        <div className="panel-creation-modal__shape-section">
          <p className="panel-creation-modal__shape-eyebrow eyebrow">Start from a shape</p>
          {shapeCatalogError ? (
            <InlineError error={shapeCatalogError} />
          ) : (
            <div
              className="panel-creation-modal__shape-list"
              role="group"
              aria-label="Start from a shape"
            >
              {offeredShapes.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  className="panel-creation-modal__shape-card"
                  onClick={() => onSelectShape(shape)}
                >
                  <span className="panel-creation-modal__shape-label">{shape.label}</span>
                  <span className="panel-creation-modal__shape-desc">{shape.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
