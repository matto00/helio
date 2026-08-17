// DataType-select step of PanelCreationModal — pickable list of DataTypes
// that have a registered pipeline producing them. Required for data-bound
// panel types (metric / chart / text / table / markdown / collection /
// timeline); text and markdown additionally allow skipping the binding
// entirely (`allowSkip`) since a static text/markdown panel is meaningful
// with no data type at all — see PanelCreationModal's `OPTIONALLY_DATA_BOUND_TYPES`.
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

import { useState } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faBolt,
  faCheck,
  faChevronRight,
  faLayerGroup,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import { InlineError } from "../../../../shared/chrome/InlineError";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Spinner, TextField } from "../../../../shared/ui/index";
import type { DataType } from "../../../dataTypes/types/dataType";
import type { PipelineShapeCatalogEntry } from "../../../pipelines/types/pipelineShape";

interface DataTypeSelectStepProps {
  /** True when either pipelines or data-types slice is still resolving. */
  loading: boolean;
  /** Set when the data-types fetch itself failed (slice status "failed").
   *  Distinct from an empty-but-successful response — never rendered as the
   *  "no data types registered" empty state. */
  error?: string | null;
  /** Re-dispatches the data-types fetch; wired to the error state's Retry action. */
  onRetry: () => void;
  /** DataTypes whose id appears as the output of at least one pipeline. */
  registryDataTypes: readonly DataType[];
  /** `outputDataTypeId → pipeline name`, for the muted per-card provenance
   *  line (HEL-270's map, reused here — see `selectPipelineNameByOutputTypeId`). */
  pipelineNameByTypeId: ReadonlyMap<string, string>;
  /** Currently-selected DataType id, or null if none picked yet. */
  selectedDataTypeId: string | null;
  onSelect: (id: string) => void;
  /** True when the current panel type is meaningful with no data type bound
   *  at all (text / markdown) — enables "Continue without data" in place of
   *  a hard-gated Next. */
  allowSkip: boolean;
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

function dataTypeMetaLine(dt: DataType, pipelineName: string | undefined): string {
  const fieldCount = dt.fields.length;
  const fieldsPart = `${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
  return pipelineName ? `${pipelineName} · ${fieldsPart}` : fieldsPart;
}

export function DataTypeSelectStep({
  loading,
  error,
  onRetry,
  registryDataTypes,
  pipelineNameByTypeId,
  selectedDataTypeId,
  onSelect,
  allowSkip,
  onEmptyStateNavigate,
  onBack,
  onNext,
  offeredShapes,
  shapeCatalogError,
  onSelectShape,
}: DataTypeSelectStepProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const hasShapeSection = offeredShapes.length > 0 || !!shapeCatalogError;
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const filteredDataTypes =
    normalizedQuery === ""
      ? registryDataTypes
      : registryDataTypes.filter((dt) => dt.name.toLowerCase().includes(normalizedQuery));
  const nextDisabled = selectedDataTypeId === null && !allowSkip;
  const nextLabel = selectedDataTypeId === null && allowSkip ? "Continue without data" : "Next";

  return (
    <div className="panel-creation-modal__datatype-step">
      {hasShapeSection && (
        <div className="panel-creation-modal__shape-section">
          <p className="panel-creation-modal__shape-eyebrow eyebrow">
            Start from a shape — a ready-made pipeline template
          </p>
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
                  aria-labelledby={`shape-label-${shape.id}`}
                  aria-describedby={`shape-desc-${shape.id}`}
                  onClick={() => onSelectShape(shape)}
                >
                  <span className="panel-creation-modal__shape-icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faBolt} />
                  </span>
                  <span className="panel-creation-modal__shape-body">
                    <span
                      id={`shape-label-${shape.id}`}
                      className="panel-creation-modal__shape-label"
                    >
                      {shape.label}
                    </span>
                    <span
                      id={`shape-desc-${shape.id}`}
                      className="panel-creation-modal__shape-desc"
                    >
                      {shape.description}
                    </span>
                  </span>
                  <span className="panel-creation-modal__shape-chevron" aria-hidden="true">
                    <FontAwesomeIcon icon={faChevronRight} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {loading ? (
        // Loading state: shared spinner primitive (DESIGN.md §6/§7).
        <div className="panel-creation-modal__datatype-loading">
          <Spinner size="xl" />
          <p>Loading data types…</p>
        </div>
      ) : error ? (
        // Failed fetch: never silently degrade to the empty-registry copy —
        // show the slice's own error plus a Retry action (DESIGN.md §7).
        <div className="panel-creation-modal__datatype-error">
          <InlineError error={error} />
          <button
            type="button"
            className="panel-creation-modal__btn panel-creation-modal__btn--secondary"
            onClick={onRetry}
          >
            <FontAwesomeIcon icon={faArrowRotateRight} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : registryDataTypes.length === 0 ? (
        // 3.6 — Empty state: no registry DataTypes available.
        <div data-testid="datatype-empty-state">
          <EmptyState
            icon={faLayerGroup}
            title="No data types are registered yet."
            description="Data types come from pipelines — build one to bind this panel to real data."
            variant="sidebar"
          />
          <p className="panel-creation-modal__datatype-empty__link-row">
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
        <div className="panel-creation-modal__datatype-list-wrap">
          <p className="panel-creation-modal__datatype-eyebrow eyebrow">
            {hasShapeSection ? "Or bind an existing data type" : "Bind an existing data type"}
          </p>
          <div className="panel-creation-modal__datatype-filter">
            <TextField
              id="panel-creation-datatype-filter"
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter data types…"
              aria-label="Filter data types by name"
            />
            {filterQuery.length > 0 && (
              <button
                type="button"
                className="panel-creation-modal__datatype-filter-clear"
                aria-label="Clear filter"
                onClick={() => setFilterQuery("")}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </div>
          {filteredDataTypes.length === 0 ? (
            <p className="panel-creation-modal__datatype-no-match">
              No data types match &ldquo;{filterQuery}&rdquo;.
            </p>
          ) : (
            // 3.7 — DataType list as clickable cards.
            <div
              className="panel-creation-modal__datatype-list"
              role="group"
              aria-label="Data type"
            >
              {filteredDataTypes.map((dt) => {
                const selected = selectedDataTypeId === dt.id;
                return (
                  <button
                    key={dt.id}
                    type="button"
                    className={`panel-creation-modal__datatype-card${selected ? " panel-creation-modal__datatype-card--selected" : ""}`}
                    aria-labelledby={`datatype-label-${dt.id}`}
                    aria-describedby={`datatype-meta-${dt.id}`}
                    aria-pressed={selected}
                    onClick={() => onSelect(dt.id)}
                  >
                    <span className="panel-creation-modal__datatype-name-row">
                      <span
                        id={`datatype-label-${dt.id}`}
                        className="panel-creation-modal__datatype-name"
                      >
                        {dt.name}
                      </span>
                      {selected && (
                        <FontAwesomeIcon
                          icon={faCheck}
                          aria-hidden="true"
                          className="panel-creation-modal__datatype-check"
                        />
                      )}
                    </span>
                    <span
                      id={`datatype-meta-${dt.id}`}
                      className="panel-creation-modal__datatype-meta"
                    >
                      {dataTypeMetaLine(dt, pipelineNameByTypeId.get(dt.id))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
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
        {/* 3.7 / 3.8 — Next disabled until a DataType is selected, unless
            `allowSkip` (text/markdown) lets the user continue unbound. */}
        <button
          type="button"
          className="panel-creation-modal__btn panel-creation-modal__btn--primary"
          disabled={nextDisabled}
          onClick={onNext}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
