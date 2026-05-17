import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsUpDown,
  faArrowUp,
  faCalculator,
  faChartColumn,
  faClockRotateLeft,
  faFilter,
  faLink,
  faPencil,
  faRightLeft,
  faSquareCheck,
  faTable,
  faXmark,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";

import { RunHistoryModal } from "./RunHistoryModal";
import { PipelinePreviewModal } from "./PipelinePreviewModal";

import { formatRelativeTime } from "../utils/formatRelativeTime";

import "./PipelineDetailPage.css";
import { fetchSources } from "../features/sources/state/sourcesSlice";
import {
  analyzePipeline,
  clearRunState,
  fetchPipelineById,
  fetchPipelineRunHistory,
  fetchPipelineSteps,
  submitPipelineRun,
  updatePipeline,
} from "../features/pipelines/pipelinesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { usePipelineRunEvents } from "../hooks/usePipelineRunEvents";
import type { RunStatusEventData } from "../hooks/usePipelineRunEvents";
import {
  createPipelineStep,
  fetchStepPreview,
  updatePipelineStep,
} from "../services/pipelineService";
import type { StepPreviewResponse } from "../services/pipelineService";
import type {
  AggregateConfig as AggregateConfigType,
  AnalyzeStepResult,
  CastConfig as CastConfigType,
  ComputeConfig as ComputeConfigType,
  DataSource,
  FilterConfig as FilterConfigType,
  LimitConfig as LimitConfigType,
  PipelineRunRecord,
  PipelineStep,
  PipelineStepConfig,
  PipelineStepKind,
  RenameConfig as RenameConfigType,
  SchemaField,
  SelectConfig as SelectConfigType,
  SortConfig as SortConfigType,
} from "../types/models";
import { AggregateConfig } from "./AggregateConfig";
import type { AggregateConfigValue } from "./AggregateConfig";
import { CastFieldsConfig } from "./CastFieldsConfig";
import { ComputeFieldConfig } from "./ComputeFieldConfig";
import type { ComputeConfigValue } from "./ComputeFieldConfig";
import { FilterConfig } from "./FilterConfig";
import type { FilterConfigValue } from "./FilterConfig";
import { LimitConfig } from "./LimitConfig";
import { RenameFieldsConfig } from "./RenameFieldsConfig";
import { SortConfig } from "./SortConfig";
import type { SortKey } from "./SortConfig";
import { SelectFieldsConfig } from "./SelectFieldsConfig";

// ── Op types ────────────────────────────────────────────────────────────────

interface OpType {
  id: string;
  label: string;
  icon: IconDefinition;
}

const OP_TYPES: OpType[] = [
  { id: "select", label: "Select fields", icon: faSquareCheck },
  { id: "rename", label: "Rename column", icon: faPencil },
  { id: "filter", label: "Filter rows", icon: faFilter },
  { id: "join", label: "Join tables", icon: faLink },
  { id: "compute", label: "Compute column", icon: faCalculator },
  { id: "aggregate", label: "Group & aggregate", icon: faChartColumn },
  { id: "cast", label: "Cast type", icon: faRightLeft },
  { id: "limit", label: "Limit rows", icon: faArrowUp },
  { id: "sort", label: "Sort rows", icon: faArrowsUpDown },
];

// ── Step data ────────────────────────────────────────────────────────────────

interface Step {
  id: string;
  opType: OpType;
  label: string;
  config: PipelineStepConfig;
}

/** Empty / default config per kind. Matches the seed shapes used in the
 *  `handleAddStep` flow — kept as a single source of truth so seeding new
 *  steps and parsing the absence of persisted config (legacy in-flight steps
 *  with no body) produce the same shape. */
function defaultConfigFor(kind: string): PipelineStepConfig {
  switch (kind) {
    case "select":
      return { fields: [] } as SelectConfigType;
    case "rename":
      return { renames: {} } as RenameConfigType;
    case "cast":
      return { casts: {} } as CastConfigType;
    case "filter":
      return { combinator: "AND", conditions: [] } as FilterConfigType;
    case "compute":
      return { column: "", expression: "", type: "number" } as ComputeConfigType;
    case "aggregate":
      return { groupBy: [], aggregations: [] } as AggregateConfigType;
    case "limit":
      return { count: 100 } as LimitConfigType;
    case "sort":
      return { sortBy: [] } as SortConfigType;
    case "join":
      return { rightDataSourceId: "", joinKey: "", joinType: "inner" };
    case "groupby":
      return { groupBy: [], aggColumn: "", aggFunction: "sum" };
    default:
      return { fields: [] } as SelectConfigType;
  }
}

let stepCounter = 0;
function makeStep(opType: OpType): Step {
  stepCounter += 1;
  return {
    id: `step-${stepCounter}`,
    opType,
    label: opType.label,
    config: defaultConfigFor(opType.id),
  };
}

function pipelineStepToStep(ps: PipelineStep): Step {
  const opType = OP_TYPES.find((op) => op.id === ps.type) ?? OP_TYPES[0];
  return {
    id: ps.id,
    opType,
    label: opType.label,
    config: ps.config,
  };
}

// ── Static SVG ribbon ────────────────────────────────────────────────────────

function RibbonSegment() {
  return (
    <svg
      className="pipeline-detail-page__ribbon"
      viewBox="0 0 800 50"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* Band 1 */}
      <path
        d="M0,5 C400,5 400,5 800,5 L800,15 C400,15 400,15 0,15 Z"
        fill="var(--app-accent)"
        fillOpacity="0.15"
        stroke="var(--app-accent)"
        strokeOpacity="0.3"
        strokeWidth="0.5"
      />
      {/* Band 2 */}
      <path
        d="M0,17 C400,17 400,17 800,17 L800,28 C400,28 400,28 0,28 Z"
        fill="var(--app-accent-strong)"
        fillOpacity="0.12"
        stroke="var(--app-accent-strong)"
        strokeOpacity="0.25"
        strokeWidth="0.5"
      />
      {/* Band 3 */}
      <path
        d="M0,30 C400,30 400,30 800,30 L800,38 C400,38 400,38 0,38 Z"
        fill="var(--app-accent)"
        fillOpacity="0.08"
        stroke="var(--app-accent)"
        strokeOpacity="0.2"
        strokeWidth="0.5"
      />
      {/* Band 4 */}
      <path
        d="M0,40 C400,40 400,40 800,40 L800,46 C400,46 400,46 0,46 Z"
        fill="var(--app-accent-mid)"
        fillOpacity="0.1"
        stroke="var(--app-accent-mid)"
        strokeOpacity="0.2"
        strokeWidth="0.5"
      />
    </svg>
  );
}

// ── Op-type dropdown ─────────────────────────────────────────────────────────

interface OpDropdownProps {
  onSelect: (opType: OpType) => void;
  onClose: () => void;
}

function OpDropdown({ onSelect, onClose }: OpDropdownProps) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <ul className="pipeline-detail-page__op-dropdown" ref={ref} role="menu">
      {OP_TYPES.map((op) => (
        <li key={op.id} role="none">
          <button
            type="button"
            role="menuitem"
            className="pipeline-detail-page__op-dropdown-item"
            onClick={() => {
              onSelect(op);
              onClose();
            }}
          >
            <FontAwesomeIcon icon={op.icon} aria-hidden="true" /> {op.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Narrowing helpers ────────────────────────────────────────────────────────
//
// CS2c-3a: configs are already typed objects (the wire shape is a
// discriminated union). These helpers narrow `Step.config` to the kind-specific
// shape — no JSON.parse needed.

function selectedFieldsOf(step: Step): string[] {
  return step.opType.id === "select" ? (step.config as SelectConfigType).fields : [];
}

function renamesOf(step: Step): Record<string, string> {
  return step.opType.id === "rename" ? (step.config as RenameConfigType).renames : {};
}

function castsOf(step: Step): Record<string, string> {
  return step.opType.id === "cast" ? (step.config as CastConfigType).casts : {};
}

function filterConfigOf(step: Step): FilterConfigValue {
  if (step.opType.id !== "filter") return { combinator: "AND", conditions: [] };
  const cfg = step.config as FilterConfigType;
  return {
    combinator: cfg.combinator === "OR" ? "OR" : "AND",
    conditions: (cfg.conditions ?? []) as FilterConfigValue["conditions"],
  };
}

function computeConfigOf(step: Step): ComputeConfigValue {
  const empty: ComputeConfigValue = { column: "", expression: "", type: "number" };
  if (step.opType.id !== "compute") return empty;
  const cfg = step.config as ComputeConfigType;
  return {
    column: cfg.column ?? "",
    expression: cfg.expression ?? "",
    type: cfg.type ?? "number",
  };
}

function limitCountOf(step: Step): number {
  if (step.opType.id !== "limit") return 100;
  const cfg = step.config as LimitConfigType;
  return typeof cfg.count === "number" && cfg.count > 0 ? cfg.count : 100;
}

function aggregateConfigOf(step: Step): AggregateConfigValue {
  if (step.opType.id !== "aggregate") return { groupBy: [], aggregations: [] };
  const cfg = step.config as AggregateConfigType;
  return {
    groupBy: cfg.groupBy as AggregateConfigValue["groupBy"],
    aggregations: cfg.aggregations as AggregateConfigValue["aggregations"],
  };
}

function sortConfigOf(step: Step): SortKey[] {
  if (step.opType.id !== "sort") return [];
  const cfg = step.config as SortConfigType;
  return Array.isArray(cfg.sortBy) ? (cfg.sortBy as SortKey[]) : [];
}

// ── Step card ────────────────────────────────────────────────────────────────

interface StepCardProps {
  step: Step;
  pipelineId: string;
  onRemove: (id: string) => void;
  /** Column names from the analyze endpoint's inputSchema for this step — used by SelectFieldsConfig/RenameFieldsConfig/CastFieldsConfig. */
  analyzeColumns: string[];
  /** Full schema fields from the analyze endpoint's inputSchema — used by FilterConfig for type-aware value input. */
  analyzeSchema: SchemaField[];
  /** Called after a successful config PATCH so the parent can keep step.config in sync. */
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  /** Output row count from the last run, if available. Null hides the chip. */
  rowCount: number | null;
}

function StepCard({
  step,
  pipelineId,
  onRemove,
  analyzeColumns,
  analyzeSchema,
  onConfigChange,
  rowCount,
}: StepCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Preview state (component-local, transient)
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function handlePreviewToggle() {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result: StepPreviewResponse = await fetchStepPreview(pipelineId, step.id);
      setPreviewRows(result.rows);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Preview failed";
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Derived state: sync local editor state when the persisted config or
  // opType changes (during-render pattern). CS2c-3a: `step.config` is already
  // a typed object, so the narrowing helpers replace the per-render JSON
  // parsing the pre-CS2c-3a editor performed.
  const [prevConfig, setPrevConfig] = useState(step.config);
  const [prevOpTypeId, setPrevOpTypeId] = useState(step.opType.id);
  const [selectedFields, setSelectedFields] = useState<string[]>(() => selectedFieldsOf(step));
  const [renames, setRenames] = useState<Record<string, string>>(() => renamesOf(step));
  const [casts, setCasts] = useState<Record<string, string>>(() => castsOf(step));
  const [filterConfig, setFilterConfig] = useState<FilterConfigValue>(() => filterConfigOf(step));
  const [computeConfig, setComputeConfig] = useState<ComputeConfigValue>(() =>
    computeConfigOf(step),
  );
  const [aggregateConfig, setAggregateConfig] = useState<AggregateConfigValue>(() =>
    aggregateConfigOf(step),
  );
  const [limitCount, setLimitCount] = useState<number>(() => limitCountOf(step));
  const [sortConfig, setSortConfig] = useState<SortKey[]>(() => sortConfigOf(step));
  if (prevConfig !== step.config || prevOpTypeId !== step.opType.id) {
    setPrevConfig(step.config);
    setPrevOpTypeId(step.opType.id);
    setSelectedFields(selectedFieldsOf(step));
    setRenames(renamesOf(step));
    setCasts(castsOf(step));
    setFilterConfig(filterConfigOf(step));
    setComputeConfig(computeConfigOf(step));
    setAggregateConfig(aggregateConfigOf(step));
    setLimitCount(limitCountOf(step));
    setSortConfig(sortConfigOf(step));
  }

  /** Shared persistence path — PATCHes the typed config, then notifies the
   *  parent. Local editor state is updated by the caller (so the UI stays
   *  responsive regardless of network result). */
  function persist(newConfig: PipelineStepConfig): void {
    void updatePipelineStep(step.id, newConfig)
      .then(() => {
        onConfigChange(step.id, newConfig);
      })
      .catch(() => {
        // No-op: local state always reflects user intent even if PATCH fails.
      });
  }

  function handleFieldToggle(field: string, checked: boolean) {
    const next = checked ? [...selectedFields, field] : selectedFields.filter((f) => f !== field);
    setSelectedFields(next);
    persist({ fields: next });
  }

  function handleRenameChange(field: string, newName: string) {
    const next = { ...renames };
    if (newName) next[field] = newName;
    else delete next[field];
    setRenames(next);
    persist({ renames: next });
  }

  function handleCastChange(field: string, targetType: string) {
    const next = { ...casts };
    if (targetType) next[field] = targetType;
    else delete next[field];
    setCasts(next);
    persist({ casts: next });
  }

  function handleFilterChange(newConfig: FilterConfigValue) {
    setFilterConfig(newConfig);
    persist({
      combinator: newConfig.combinator,
      conditions: newConfig.conditions,
    });
  }

  function handleComputeChange(newConfig: ComputeConfigValue) {
    setComputeConfig(newConfig);
    persist(newConfig);
  }

  function handleAggregateChange(newConfig: AggregateConfigValue) {
    setAggregateConfig(newConfig);
    persist(newConfig);
  }

  function handleLimitChange(newConfig: { count: number }) {
    setLimitCount(newConfig.count);
    persist(newConfig);
  }

  function handleSortChange(newConfig: { sortBy: SortKey[] }) {
    setSortConfig(newConfig.sortBy);
    persist(newConfig);
  }

  return (
    <div
      className={`pipeline-detail-page__step-card${expanded ? " pipeline-detail-page__step-card--expanded" : ""}`}
    >
      <button
        type="button"
        className="pipeline-detail-page__step-card-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="pipeline-detail-page__step-card-icon" aria-hidden="true">
          <FontAwesomeIcon icon={step.opType.icon} />
        </span>
        <span className="pipeline-detail-page__step-card-label">{step.label}</span>
        {rowCount !== null && (
          <span className="pipeline-detail-page__step-card-count">
            {rowCount.toLocaleString()} rows
          </span>
        )}
        <span
          className={`pipeline-detail-page__step-card-chevron${expanded ? " pipeline-detail-page__step-card-chevron--open" : ""}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="pipeline-detail-page__step-card-body">
          {step.opType.id === "select" ? (
            <SelectFieldsConfig
              columns={analyzeColumns}
              selectedFields={selectedFields}
              onToggle={handleFieldToggle}
            />
          ) : step.opType.id === "rename" ? (
            <RenameFieldsConfig
              columns={analyzeColumns}
              renames={renames}
              onChange={handleRenameChange}
            />
          ) : step.opType.id === "cast" ? (
            <CastFieldsConfig columns={analyzeColumns} casts={casts} onChange={handleCastChange} />
          ) : step.opType.id === "filter" ? (
            <FilterConfig
              config={filterConfig}
              analyzeSchema={analyzeSchema}
              onChange={handleFilterChange}
            />
          ) : step.opType.id === "compute" ? (
            <ComputeFieldConfig
              config={computeConfig}
              analyzeColumns={analyzeColumns}
              onChange={handleComputeChange}
            />
          ) : step.opType.id === "aggregate" ? (
            <AggregateConfig
              config={aggregateConfig}
              analyzeSchema={analyzeSchema}
              analyzeColumns={analyzeColumns}
              onChange={handleAggregateChange}
            />
          ) : step.opType.id === "limit" ? (
            <LimitConfig count={limitCount} onChange={handleLimitChange} />
          ) : step.opType.id === "sort" ? (
            <SortConfig sortBy={sortConfig} columns={analyzeColumns} onChange={handleSortChange} />
          ) : (
            <>
              <p className="pipeline-detail-page__step-card-desc">
                Configure this {step.opType.label.toLowerCase()} step.
              </p>
              <div className="pipeline-detail-page__step-card-diff">
                <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--added">
                  + col_a
                </span>
                <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--removed">
                  − col_b
                </span>
                <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--changed">
                  ~ col_c
                </span>
              </div>
            </>
          )}
          <div className="pipeline-detail-page__step-card-actions">
            <button
              type="button"
              className="pipeline-detail-page__step-card-preview-btn"
              onClick={() => void handlePreviewToggle()}
              aria-expanded={previewOpen}
            >
              {previewOpen ? "Hide preview" : "Preview data"}
            </button>
            <button
              type="button"
              className="pipeline-detail-page__step-card-remove-btn"
              onClick={() => onRemove(step.id)}
            >
              Remove step
            </button>
          </div>

          {previewOpen && (
            <div className="pipeline-detail-page__step-preview">
              {previewLoading ? (
                <p className="pipeline-detail-page__step-preview-loading">Loading preview…</p>
              ) : previewError !== null ? (
                <p className="pipeline-detail-page__step-preview-error" role="alert">
                  {previewError}
                </p>
              ) : previewRows.length === 0 ? (
                <p className="pipeline-detail-page__step-preview-empty">No rows to preview.</p>
              ) : (
                <div className="pipeline-detail-page__step-preview-table-wrapper">
                  <table className="pipeline-detail-page__step-preview-table">
                    <thead>
                      <tr>
                        {Object.keys(previewRows[0]).map((col) => (
                          <th key={col} className="pipeline-detail-page__step-preview-th">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i}>
                          {Object.values(row).map((cell, j) => (
                            <td key={j} className="pipeline-detail-page__step-preview-td">
                              {cell === null || cell === undefined ? "" : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Source chip ──────────────────────────────────────────────────────────────

interface SourceChipProps {
  source: DataSource;
}

function SourceChip({ source }: SourceChipProps) {
  const [active, setActive] = useState(true);
  const [previewing, setPreviewing] = useState(false);

  const mockRows = [
    ["id", "name", "value"],
    ["1", "Alpha", "42"],
    ["2", "Beta", "91"],
    ["3", "Gamma", "17"],
  ];

  return (
    <div className="pipeline-detail-page__source-chip-wrapper">
      <div
        className={`pipeline-detail-page__source-chip${active ? " pipeline-detail-page__source-chip--active" : ""}`}
      >
        <button
          type="button"
          className="pipeline-detail-page__source-chip-toggle"
          onClick={() => setActive((v) => !v)}
          aria-pressed={active}
        >
          <span className="pipeline-detail-page__source-chip-name">{source.name}</span>
          <span className="pipeline-detail-page__source-chip-count">—</span>
        </button>
        <button
          type="button"
          className="pipeline-detail-page__source-chip-preview-btn"
          onClick={() => setPreviewing((v) => !v)}
          aria-label={`Preview ${source.name}`}
          aria-pressed={previewing}
          title="Preview data"
        >
          <FontAwesomeIcon icon={faTable} />
        </button>
      </div>

      {previewing && active && (
        <div className="pipeline-detail-page__source-preview">
          <table className="pipeline-detail-page__source-preview-table">
            <thead>
              <tr>
                {mockRows[0].map((col) => (
                  <th key={col} className="pipeline-detail-page__source-preview-th">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockRows.slice(1).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="pipeline-detail-page__source-preview-td">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Run history is now rendered by RunHistoryModal (separate component); the
// inline `<details>` panel and its helpers were removed from this file.

// ── Main page ────────────────────────────────────────────────────────────────

export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { items: sources, status: sourcesStatus } = useAppSelector((state) => state.sources);
  const {
    runStatus,
    runError,
    runHistory,
    runIsDry,
    runResult,
    runStepRowCounts,
    runSourceRowCount,
    currentPipeline,
    currentPipelineStatus,
    currentPipelineError,
    updateStatus,
    updateError,
    steps: reduxSteps,
  } = useAppSelector((state) => state.pipelines);

  // Per-pipeline analyze result (schema-inferred fields per step).
  const analyzeResult = useAppSelector((state) =>
    id ? (state.pipelines.analyzeResult?.[id] ?? null) : null,
  );

  const runs = id ? (runHistory[id] ?? []) : [];
  const persistedSteps = id ? (reduxSteps[id] ?? []) : [];

  const [steps, setSteps] = useState<Step[]>([]);
  const [stepsInitialized, setStepsInitialized] = useState(false);
  const [dropdownOpenAt, setDropdownOpenAt] = useState<"bottom" | null>(null);
  const [sseActive, setSseActive] = useState(false);
  const [outputName, setOutputName] = useState("");
  const [editingOutputName, setEditingOutputName] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  // Track which pipeline id the outputName was last initialized from
  const [outputNamePipelineId, setOutputNamePipelineId] = useState<string | null>(null);
  // Inline discard-confirm state (replaces window.confirm on dirty cancel).
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  // ── SSE run-status hook ──
  const sseData = usePipelineRunEvents({
    pipelineId: id,
    active: sseActive,
    onTerminal: (event: RunStatusEventData) => {
      setSseActive(false);
      if (id) void dispatch(fetchPipelineRunHistory(id));
    },
  });

  // ── Derived-state initialization (React recommended pattern) ──
  // Sync outputName whenever a different pipeline becomes current.
  if (currentPipeline && currentPipeline.id !== outputNamePipelineId) {
    setOutputNamePipelineId(currentPipeline.id);
    setOutputName(currentPipeline.name);
  }
  // Initialize local steps from persisted Redux data on first load.
  if (!stepsInitialized && persistedSteps.length > 0) {
    setStepsInitialized(true);
    setSteps(persistedSteps.map(pipelineStepToStep));
  }

  // 3.1 Fetch pipeline and steps on mount / id change.
  // Use a ref to prevent re-dispatching for the same id (avoids loops).
  // Skip when already in a failed/loading terminal state.
  const lastFetchedIdRef = useRef<string | null>(null);
  const currentPipelineId = currentPipeline?.id;
  useEffect(() => {
    if (!id) return;
    // Do not auto-retry a failed fetch
    if (currentPipelineStatus === "failed" || currentPipelineStatus === "loading") return;
    // Already dispatched for this exact pipeline id in this render cycle
    if (lastFetchedIdRef.current === id) return;
    lastFetchedIdRef.current = id;
    void dispatch(fetchPipelineById(id));
    void dispatch(fetchPipelineSteps(id));
    void dispatch(analyzePipeline(id));
  }, [dispatch, id, currentPipelineStatus, currentPipelineId]);

  // ── Sources ──
  useEffect(() => {
    if (sourcesStatus === "idle") {
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

  // Re-run /analyze whenever the steps change (add / remove / config edit) so
  // each StepCard's inputSchema (and the available-fields hints inside the op
  // editors) stays in sync without a manual refresh. Debounced so a stream of
  // keystrokes in a TextField doesn't fire a request per character.
  // We key on the SHAPE of steps (id, op, config) — not the array reference —
  // so transient setState calls that don't change content don't trigger
  // re-analyze.
  // Serialize the typed config for the fingerprint — JSON.stringify here
  // is purely a comparison-shape helper, not a wire-format serialization.
  const stepsFingerprint = steps
    .map((s) => `${s.id}:${s.opType.id}:${JSON.stringify(s.config)}`)
    .join("|");
  useEffect(() => {
    if (!id || steps.length === 0) return;
    const handle = window.setTimeout(() => {
      void dispatch(analyzePipeline(id));
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, stepsFingerprint, dispatch]);

  // Fetch run history on mount
  useEffect(() => {
    if (id) {
      void dispatch(fetchPipelineRunHistory(id));
    }
  }, [dispatch, id]);

  // Clear run state when navigating to a different pipeline
  useEffect(() => {
    return () => {
      dispatch(clearRunState());
    };
  }, [dispatch, id]);

  // ── Per-step analyze columns / schema ──
  // Build helpers from step.id → inputSchema data so each StepCard can receive
  // the correct columns/schema without re-running the analyze logic in the UI.
  function getAnalyzeColumns(stepId: string): string[] {
    if (!analyzeResult) return [];
    const analyzeStep: AnalyzeStepResult | undefined = analyzeResult.steps.find(
      (s) => s.id === stepId,
    );
    return analyzeStep ? analyzeStep.inputSchema.map((f) => f.name) : [];
  }

  function getAnalyzeSchema(stepId: string): SchemaField[] {
    if (!analyzeResult) return [];
    const analyzeStep: AnalyzeStepResult | undefined = analyzeResult.steps.find(
      (s) => s.id === stepId,
    );
    return analyzeStep ? analyzeStep.inputSchema : [];
  }

  // ── Dirty-state tracking ──
  const isDirty = outputNamePipelineId !== null && outputName !== (currentPipeline?.name ?? "");

  // ── beforeunload guard ──
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const pipelineName = currentPipeline?.name ?? id ?? "Pipeline";

  // ── Handlers ──
  async function handleAddStep(opType: OpType) {
    if (!id) return;
    setStepsInitialized(true);
    const tempStep = makeStep(opType);
    setSteps((prev) => [...prev, tempStep]);
    try {
      const initialConfig = defaultConfigFor(opType.id);
      const persisted = await createPipelineStep(id, opType.id as PipelineStepKind, initialConfig);
      setSteps((prev) =>
        prev.map((s) => (s.id === tempStep.id ? pipelineStepToStep(persisted) : s)),
      );
    } catch {
      // Keep temp step if POST fails; PATCH calls will be no-ops until ID is real.
    }
  }

  function handleStepConfigChange(stepId: string, config: PipelineStepConfig) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, config } : s)));
  }

  function handleRemoveStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  async function handleRunPipeline() {
    if (!id) return;
    setSseActive(true);
    try {
      await dispatch(submitPipelineRun({ pipelineId: id })).unwrap();
      void dispatch(fetchPipelineRunHistory(id));
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }

  async function handleDryRun() {
    if (!id) return;
    setSseActive(true);
    try {
      await dispatch(submitPipelineRun({ pipelineId: id, dryRun: true })).unwrap();
      void dispatch(fetchPipelineRunHistory(id));
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }

  async function handleSave() {
    if (!id) return;
    try {
      await dispatch(updatePipeline({ id, name: outputName })).unwrap();
      void navigate("/pipelines");
    } catch {
      // updateError is shown via Redux state
    }
  }

  function handleCancel() {
    if (isDirty) {
      setIsConfirmingCancel(true);
    } else {
      void navigate("/pipelines");
    }
  }

  function confirmCancelDiscard() {
    setIsConfirmingCancel(false);
    void navigate("/pipelines");
  }

  function dismissCancelConfirm() {
    setIsConfirmingCancel(false);
  }

  // ── Loading / Error guards ──
  // Show error if we have a known error and no pipeline data yet.
  // This takes priority over loading so a re-fetch does not hide the error.
  if (currentPipeline === null && currentPipelineError !== null) {
    return (
      <div className="pipeline-detail-page">
        <div className="pipeline-detail-page__error" role="alert">
          {currentPipelineError}
        </div>
      </div>
    );
  }

  // Show loading when we have no pipeline data yet
  if (currentPipeline === null) {
    return (
      <div className="pipeline-detail-page">
        <div className="pipeline-detail-page__loading" aria-label="Loading pipeline">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="pipeline-detail-page">
      {/* ── Source selector bar ── */}
      <div className="pipeline-detail-page__source-bar">
        <span className="pipeline-detail-page__source-bar-label">DATA SOURCES</span>
        <div className="pipeline-detail-page__source-chips">
          {sourcesStatus === "loading" && (
            <span className="pipeline-detail-page__source-bar-loading">Loading…</span>
          )}
          {sources.map((source) => (
            <SourceChip key={source.id} source={source} />
          ))}
          <button type="button" className="pipeline-detail-page__connect-source-btn">
            + Connect source
          </button>
        </div>
      </div>

      {/* ── River view ── */}
      <div className="pipeline-detail-page__river">
        <div className="pipeline-detail-page__river-inner">
          {steps.length === 0 ? (
            <div className="pipeline-detail-page__empty-state">
              <p className="pipeline-detail-page__empty-state-text">
                Add your first transformation step
              </p>
              <button
                type="button"
                className="pipeline-detail-page__add-step-btn"
                onClick={() => setDropdownOpenAt("bottom")}
              >
                + Add step
              </button>
              {dropdownOpenAt === "bottom" && (
                <OpDropdown onSelect={handleAddStep} onClose={() => setDropdownOpenAt(null)} />
              )}
            </div>
          ) : (
            <>
              <RibbonSegment />
              {steps.map((step, idx) => (
                <div key={step.id} className="pipeline-detail-page__step-section">
                  <StepCard
                    step={step}
                    pipelineId={id ?? ""}
                    onRemove={handleRemoveStep}
                    analyzeColumns={getAnalyzeColumns(step.id)}
                    analyzeSchema={getAnalyzeSchema(step.id)}
                    onConfigChange={handleStepConfigChange}
                    rowCount={runStepRowCounts?.[step.id] ?? null}
                  />
                  {idx < steps.length - 1 && <RibbonSegment />}
                </div>
              ))}
              <div className="pipeline-detail-page__add-step-row">
                <button
                  type="button"
                  className="pipeline-detail-page__add-step-dashed-btn"
                  onClick={() => setDropdownOpenAt("bottom")}
                >
                  + Add transformation step
                </button>
                {dropdownOpenAt === "bottom" && (
                  <OpDropdown onSelect={handleAddStep} onClose={() => setDropdownOpenAt(null)} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Footer bar ── */}
      <div className="pipeline-detail-page__footer">
        <div className="pipeline-detail-page__footer-left">
          <span className="pipeline-detail-page__footer-output-label">OUTPUT</span>
          {editingOutputName ? (
            <input
              className="pipeline-detail-page__footer-output-input"
              value={outputName}
              aria-label="Output name"
              onChange={(e) => setOutputName(e.target.value)}
              onBlur={() => setEditingOutputName(false)}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="pipeline-detail-page__footer-output-name"
              onClick={() => setEditingOutputName(true)}
              aria-label="Edit output name"
            >
              {outputName || pipelineName}
            </button>
          )}
          <span className="pipeline-detail-page__footer-schema">
            <span className="pipeline-detail-page__footer-schema-chip">id</span>
            <span className="pipeline-detail-page__footer-schema-chip">name</span>
            <span className="pipeline-detail-page__footer-schema-chip">value</span>
            <em className="pipeline-detail-page__footer-inferred">inferred</em>
          </span>
        </div>
        <div className="pipeline-detail-page__footer-right">
          <span className="pipeline-detail-page__footer-stats">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
          {(sseData.status !== null || runStatus !== null) &&
            (() => {
              const displayStatus = sseData.status ?? runStatus;
              const displayRowCount =
                sseData.rowCount !== null ? sseData.rowCount : (runResult ?? []).length;
              const displayErrorLog = sseData.errorLog ?? runError;
              return (
                <span
                  className={`pipeline-detail-page__run-status pipeline-detail-page__run-status--${displayStatus}`}
                  aria-label={`Run status: ${displayStatus}`}
                >
                  {displayStatus === "queued" && "Queued…"}
                  {displayStatus === "running" && "Running…"}
                  {displayStatus === "succeeded" &&
                    (runIsDry
                      ? `Preview: ${displayRowCount} rows`
                      : `Snapshot replaced: ${displayRowCount} rows`)}
                  {displayStatus === "dry_run" && `Preview: ${displayRowCount} rows`}
                  {displayStatus === "failed" &&
                    `Failed${displayErrorLog ? `: ${displayErrorLog}` : ""}`}
                </span>
              );
            })()}
          {isDirty && (
            <>
              {updateError && (
                <span
                  className="pipeline-detail-page__update-error"
                  role="alert"
                  aria-label="Save error"
                >
                  {updateError}
                </span>
              )}
              <button
                type="button"
                className="pipeline-detail-page__save-btn"
                onClick={() => void handleSave()}
                disabled={updateStatus === "loading"}
                aria-label="Save pipeline"
              >
                {updateStatus === "loading" ? "Saving…" : "Save"}
              </button>
              {isConfirmingCancel ? (
                <span
                  className="pipeline-detail-page__cancel-confirm"
                  role="alertdialog"
                  aria-label="Discard unsaved changes"
                >
                  <span className="pipeline-detail-page__cancel-confirm-text">
                    Discard changes?
                  </span>
                  <button
                    type="button"
                    className="pipeline-detail-page__cancel-confirm-btn pipeline-detail-page__cancel-confirm-btn--danger"
                    onClick={confirmCancelDiscard}
                    aria-label="Discard changes"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="pipeline-detail-page__cancel-confirm-btn"
                    onClick={dismissCancelConfirm}
                    aria-label="Keep editing"
                  >
                    Keep editing
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="pipeline-detail-page__cancel-btn"
                  onClick={handleCancel}
                  aria-label="Cancel changes"
                >
                  Cancel
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="pipeline-detail-page__history-btn"
            onClick={() => setHistoryOpen(true)}
            aria-label="Open run history"
          >
            <FontAwesomeIcon icon={faClockRotateLeft} /> Run history ({runs.length})
          </button>
          <button
            type="button"
            className="pipeline-detail-page__preview-btn"
            onClick={() => setPreviewModalOpen(true)}
          >
            Preview
          </button>
          <button
            type="button"
            className="pipeline-detail-page__dry-run-btn"
            onClick={() => void handleDryRun()}
            disabled={runStatus === "queued" || runStatus === "running"}
            aria-label="Dry run"
          >
            Dry run
          </button>
          <button
            type="button"
            className="pipeline-detail-page__run-btn"
            onClick={handleRunPipeline}
            disabled={runStatus === "queued" || runStatus === "running"}
          >
            Run pipeline
          </button>
        </div>
      </div>

      {/* ── Run history modal (button lives in the footer) ── */}
      {historyOpen && <RunHistoryModal runs={runs} onClose={() => setHistoryOpen(false)} />}

      {/* ── Pipeline output preview modal ── */}
      {previewModalOpen && (
        <PipelinePreviewModal
          rows={runResult}
          rowCount={
            sseData?.rowCount !== null && sseData?.rowCount !== undefined
              ? sseData.rowCount
              : (runResult?.length ?? null)
          }
          isDry={runIsDry}
          onClose={() => setPreviewModalOpen(false)}
        />
      )}

      {/* In-page back breadcrumb removed — the section breadcrumb in the top
       * command bar already shows "Data Pipelines / <pipeline name>". */}

      {/* ── Last-run metadata bar ── */}
      {currentPipeline.lastRunAt != null && (
        <div className="pipeline-detail-page__meta-bar" aria-label="Last run metadata">
          <span className="pipeline-detail-page__meta-bar-item">
            <span className="pipeline-detail-page__meta-bar-label">Last run:</span>{" "}
            {formatRelativeTime(currentPipeline.lastRunAt)}
          </span>
          {currentPipeline.lastRunRowCount != null && (
            <span className="pipeline-detail-page__meta-bar-item">
              <span className="pipeline-detail-page__meta-bar-label">Rows written:</span>{" "}
              {currentPipeline.lastRunRowCount.toLocaleString()}
            </span>
          )}
          {currentPipeline.lastRunStatus != null && (
            <span
              className={`pipeline-detail-page__meta-bar-badge pipeline-detail-page__meta-bar-badge--${currentPipeline.lastRunStatus}`}
            >
              {currentPipeline.lastRunStatus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
