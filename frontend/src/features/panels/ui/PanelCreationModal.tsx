// PanelCreationModal — shell for the multi-step panel creation flow.
//
// Owns the modal lifecycle (showModal, close, dirty guard, focus trap),
// the step machine (type-select → template-select → optional
// datatype-select → name-entry), and the create-panel dispatch. The four
// per-step UIs live in `./creationSteps/` and the three per-subtype
// creator fields live in `./creators/`; this file composes them and
// threads the shell-owned state through.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import type { FormEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

import "./PanelCreationModal.css";
import { createPanel, updatePanelBinding } from "../state/panelsSlice";
import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../dataTypes/state/dataTypesSlice";
import {
  fetchPipelines,
  selectPipelineNameByOutputTypeId,
} from "../../pipelines/state/pipelinesSlice";
import { PANEL_TEMPLATES } from "../state/panelTemplates";
import type { PanelTemplate } from "../state/panelTemplates";
import { useShapeOffering } from "../state/useShapeOffering";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import type { PipelineShapeCatalogEntry } from "../../pipelines/types/pipelineShape";
import type { DataType } from "../../dataTypes/types/dataType";
import type {
  ChartTypeConfig,
  ImageTypeConfig,
  MetricTypeConfig,
  PanelType,
  TypeConfig,
} from "../types/panel";
import { hasNonEmptyTypeConfig } from "./creators/creatorTypes";
import { DataTypeSelectStep } from "./creationSteps/DataTypeSelectStep";
import { NameEntryStep } from "./creationSteps/NameEntryStep";
import { ShapeInstantiateStep } from "./creationSteps/ShapeInstantiateStep";
import { TemplateSelectStep } from "./creationSteps/TemplateSelectStep";
import { TypeSelectStep } from "./creationSteps/TypeSelectStep";

// Selector for all keyboard-focusable elements inside the modal.
const FOCUSABLE_SELECTORS =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Step =
  | "type-select"
  | "template-select"
  | "datatype-select"
  | "shape-instantiate"
  | "name-entry";

// 3.2 — Data-bound panel types offer a DataType selection before creation.
const DATA_BOUND_TYPES: PanelType[] = [
  "metric",
  "chart",
  "text",
  "table",
  "markdown",
  "collection",
  "timeline",
];

// F-036 — text and markdown are meaningful panels with no data type bound at
// all (static content), unlike metric/chart/table/collection/timeline, which
// render "No data available" unbound. These two may still bind a DataType
// (the datatype-select step still offers the list), but the step's Next
// action becomes "Continue without data" instead of a hard-blocked Next —
// see `DataTypeSelectStep`'s `allowSkip` prop. Binding stays available in the
// panel editor after creation either way.
const OPTIONALLY_DATA_BOUND_TYPES: PanelType[] = ["text", "markdown"];

function isDataBound(type: PanelType | null): boolean {
  return type !== null && (DATA_BOUND_TYPES as string[]).includes(type);
}

function isOptionallyDataBound(type: PanelType | null): boolean {
  return type !== null && (OPTIONALLY_DATA_BOUND_TYPES as string[]).includes(type);
}

// 3.9 — A data-bound type genuinely requires a DataType before it can
// create anything meaningful, UNLESS it's optionally-bound (F-036).
function requiresDataType(type: PanelType | null): boolean {
  return isDataBound(type) && !isOptionallyDataBound(type);
}

// F-117 — the template-select step earns its place only when the selected
// type actually ships templates; otherwise it's a decorative extra step
// (e.g. timeline, which has none) and the shell skips straight past it.
function hasTemplates(type: PanelType | null): boolean {
  return type !== null && (PANEL_TEMPLATES[type]?.length ?? 0) > 0;
}

// F-214 — the resolved step path for the current panel type, used to render
// "Step N of M" (shape-instantiate is inserted only while actually on it,
// since it's a divergent branch off datatype-select, not a fixed step).
function resolvedStepPath(type: PanelType | null, currentStep: Step): Step[] {
  const path: Step[] = ["type-select"];
  if (hasTemplates(type)) path.push("template-select");
  if (isDataBound(type)) path.push("datatype-select");
  if (currentStep === "shape-instantiate") path.push("shape-instantiate");
  path.push("name-entry");
  return path;
}

// F-119 — panel-subtype field slots this wizard can confidently auto-map at
// create time without a dedicated field-mapping UI (design.md's "sensible
// default" fix): a metric's lone value slot, and a chart's y (numeric) plus
// x (timestamp, falling back to a string category) slots. Table/collection/
// timeline read raw rows directly (`PANEL_SLOTS.table` is empty) and need no
// mapping to render.
const NUMERIC_FIELD_TYPES = new Set(["integer", "float"]);

function firstFieldOfType(dataType: DataType, wireType: string): string | undefined {
  return dataType.fields.find((f) => f.dataType === wireType)?.name;
}

function firstNumericField(dataType: DataType): string | undefined {
  return dataType.fields.find((f) => NUMERIC_FIELD_TYPES.has(f.dataType))?.name;
}

function buildDefaultFieldMapping(
  type: PanelType,
  dataType: DataType,
): Record<string, string> | null {
  if (type === "metric") {
    const value = firstNumericField(dataType);
    return value ? { value } : null;
  }
  if (type === "chart") {
    const yAxis = firstNumericField(dataType);
    if (!yAxis) return null;
    const xAxis = firstFieldOfType(dataType, "timestamp") ?? firstFieldOfType(dataType, "string");
    return xAxis ? { xAxis, yAxis } : { yAxis };
  }
  return null;
}

interface PanelCreationModalProps {
  onClose: () => void;
}

export function PanelCreationModal({ onClose }: PanelCreationModalProps) {
  const dispatch = useAppDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // F-110 — step heading focus target: refocused on every step change (and
  // on initial open, since the effect below also fires on mount) and after
  // dismissing the discard-confirm banner, so focus never drops to <body>.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { selectedDashboardId } = useAppSelector((state) => state.dashboards);
  // 3.6 — Slice for DataType picker.
  const dataTypes = useAppSelector((state) => state.dataTypes);
  const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
  // F-108 — producing-pipeline provenance for the DataType list's metadata line.
  const pipelineNameByTypeId = useAppSelector(selectPipelineNameByOutputTypeId);

  const [step, setStep] = useState<Step>("type-select");
  const [selectedType, setSelectedType] = useState<PanelType | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PanelTemplate | null>(null);
  const [title, setTitle] = useState("");
  // 1.2 — Type-specific config lives in local state alongside existing fields.
  const [typeConfig, setTypeConfig] = useState<TypeConfig | null>(null);
  // 3.3 — DataType selection for data-bound panel types.
  const [selectedDataTypeId, setSelectedDataTypeId] = useState<string | null>(null);
  // HEL-399 — the shape selected on datatype-select, driving the
  // shape-instantiate step; catalog fetch/filter lives in `useShapeOffering`.
  const [selectedShape, setSelectedShape] = useState<PipelineShapeCatalogEntry | null>(null);
  // F-114 — sticky once true: the shape sub-flow does real backend work
  // (creates + runs a pipeline), so discarding after entering it should warn
  // even after the flow completes and `selectedShape` resets to null.
  const [shapeFlowEngaged, setShapeFlowEngaged] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Inline discard confirmation banner (replaces window.confirm for dirty dismiss).
  const [isShowingDiscardConfirm, setIsShowingDiscardConfirm] = useState(false);

  // F-114 — dirty only on genuine user-entered content: a title that no
  // longer matches the template default (covers both free typing and
  // "Start blank" + typing), a non-empty typeConfig, or having engaged the
  // shape sub-flow. Merely clicking a type/template/DataType card — cheap to
  // redo — no longer trips the discard guard on its own.
  const isDirty =
    title !== (selectedTemplate?.defaults.title ?? "") ||
    hasNonEmptyTypeConfig(typeConfig) ||
    shapeFlowEngaged;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // F-110 — focus the step heading on every step change, including the
  // initial mount (this effect always runs after first render too), so
  // focus never lands on <body> or defaults to the first focusable control
  // (the close button) with no context of what changed.
  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  // 3.6 — Fetch data types on mount if not yet loaded.
  useEffect(() => {
    if (dataTypes.status === "idle") {
      void dispatch(fetchDataTypes());
    }
  }, [dispatch, dataTypes.status]);

  // F-108 — the datatype-select step's "producing pipeline · N fields" line
  // reads `selectPipelineNameByOutputTypeId` (state.pipelines.items), but
  // nothing here ever populated it: panel creation is most commonly launched
  // straight from a dashboard, without a prior visit to /pipelines or the
  // Data Types registry (the only two other call sites that fetch it). Fetch
  // on mount; `fetchPipelines`'s own `condition` guard (pipelinesSlice.ts)
  // already skips the request when a load is in flight or already succeeded.
  useEffect(() => {
    void dispatch(fetchPipelines());
  }, [dispatch]);

  // HEL-399 — Shape cards offered for the current panel type, fetched
  // lazily once this step is reached (see `useShapeOffering`).
  const { offeredShapes, shapeCatalogError } = useShapeOffering(
    step === "datatype-select",
    selectedType,
  );

  // 1.6 / 1.7 — Focus trap: Tab/Shift+Tab cycle only through modal-internal focusable elements.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleFocusTrapKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const focusable = Array.from(dialog!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab from first → wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab from last → wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    dialog.addEventListener("keydown", handleFocusTrapKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleFocusTrapKeyDown);
    };
  }, []);

  function handleClose() {
    dialogRef.current?.close();
    onClose();
    // 1.4 / 3.10 — typeConfig and selectedDataTypeId reset automatically when the component unmounts on close.
  }

  // 1.2 — Shared dismiss helper: shows inline confirm when dirty, closes
  // directly when clean. F-114 — a second dismiss signal (Escape, backdrop
  // click, or the close button) while the banner is already showing now
  // confirms the discard instead of silently re-showing the same banner.
  function handleDismiss() {
    if (isShowingDiscardConfirm) {
      confirmDiscard();
      return;
    }
    if (isDirty) {
      setIsShowingDiscardConfirm(true);
    } else {
      handleClose();
    }
  }

  function confirmDiscard() {
    setIsShowingDiscardConfirm(false);
    handleClose();
  }

  function cancelDiscard() {
    setIsShowingDiscardConfirm(false);
    // F-110 — the focused "Keep editing" button unmounts with the banner;
    // without an explicit refocus, focus drops to <body>.
    titleRef.current?.focus();
  }

  // 1.4 — Backdrop click: close when the click target is the <dialog> itself (not inner content).
  function handleBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) {
      handleDismiss();
    }
  }

  function handleTypeSelect(type: PanelType) {
    setSelectedType(type);
    // Reset typeConfig whenever a new type is picked so stale values don't carry over.
    setTypeConfig(null);
    // F-117 — skip the decorative template step entirely for a type that
    // ships no templates (e.g. timeline); go straight to wherever it would
    // have landed next.
    if (hasTemplates(type)) {
      setStep("template-select");
    } else {
      setSelectedTemplate(null);
      setTitle("");
      setStep(isDataBound(type) ? "datatype-select" : "name-entry");
    }
  }

  // 3.4 — Advance to datatype-select for data-bound types, else name-entry.
  function handleTemplateSelect(template: PanelTemplate | null) {
    setSelectedTemplate(template);
    setTitle(template?.defaults.title ?? "");
    if (isDataBound(selectedType)) {
      setStep("datatype-select");
    } else {
      setStep("name-entry");
    }
  }

  function handleBackFromTemplate() {
    setStep("type-select");
    setSelectedTemplate(null);
  }

  // 3.5 — Back from datatype-select returns to template-select (or straight
  // to type-select when that step was skipped — F-117) and clears the
  // DataType selection.
  function handleBackFromDataType() {
    setStep(hasTemplates(selectedType) ? "template-select" : "type-select");
    setSelectedDataTypeId(null);
  }

  function handleBackFromName() {
    // Data-bound types go back to datatype-select; otherwise to
    // template-select, or type-select when that step was skipped (F-117).
    if (isDataBound(selectedType)) {
      setStep("datatype-select");
    } else if (hasTemplates(selectedType)) {
      setStep("template-select");
    } else {
      setStep("type-select");
    }
    setCreateError(null);
  }

  // HEL-399 — Selecting a shape card diverges entirely from the existing-
  // DataType path (spec: "SHALL NOT select an existing DataType").
  function handleSelectShape(shape: PipelineShapeCatalogEntry) {
    setSelectedShape(shape);
    setShapeFlowEngaged(true);
    setStep("shape-instantiate");
  }

  // 3.4 — Back from shape-instantiate returns to datatype-select and clears
  // the in-progress shape selection.
  function handleBackFromShapeInstantiate() {
    setStep("datatype-select");
    setSelectedShape(null);
  }

  // 3.3 — Only `run` succeeding reaches here; binds dataTypeId only, exactly
  // matching the existing DataType-select step's behavior (no fieldMapping).
  function handleShapeInstantiateComplete({
    dataTypeId,
  }: {
    dataTypeId: string;
    pipelineId: string;
  }) {
    setSelectedDataTypeId(dataTypeId);
    setSelectedShape(null);
    setStep("name-entry");
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedDashboardId === null || selectedType === null) {
      return;
    }

    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0) {
      return;
    }

    // 3.9 / F-036 — Block creation only when the type genuinely requires a
    // DataType (optionally-bound types may proceed with none selected).
    if (requiresDataType(selectedType) && selectedDataTypeId === null) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    // 3.1 — Include typeConfig in the payload only when it has non-empty values.
    const nonEmptyConfig = hasNonEmptyTypeConfig(typeConfig) ? typeConfig : undefined;
    try {
      const created = await dispatch(
        createPanel({
          dashboardId: selectedDashboardId,
          title: normalizedTitle,
          type: selectedType,
          ...(nonEmptyConfig !== undefined ? { typeConfig: nonEmptyConfig } : {}),
          // 3.9 — Pass dataTypeId for data-bound types.
          dataTypeId: selectedDataTypeId ?? undefined,
        }),
      ).unwrap();

      // F-119 — best-effort default field mapping so a freshly-bound
      // metric/chart doesn't land as "No data available", forcing an
      // immediate trip to the editor just to map the obvious field(s). Fires
      // after creation and is never awaited — a failure here doesn't block
      // (or undo) the panel that already exists; the user can still map
      // fields manually in the editor exactly as before this fix.
      if (selectedDataTypeId !== null) {
        const boundDataType = pipelineOutputDataTypes.find((dt) => dt.id === selectedDataTypeId);
        const defaultMapping = boundDataType
          ? buildDefaultFieldMapping(selectedType, boundDataType)
          : null;
        if (defaultMapping) {
          void dispatch(
            updatePanelBinding({
              panelId: created.id,
              typeId: selectedDataTypeId,
              fieldMapping: defaultMapping,
              refreshInterval: created.refreshInterval ?? null,
            }),
          );
        }
      }

      handleClose();
    } catch {
      setCreateError("Failed to create panel.");
    } finally {
      setIsCreating(false);
    }
  }

  function getStepTitle(): string {
    if (step === "type-select") return "Choose panel type";
    if (step === "template-select") return "Choose a template";
    // 3.11 — DataType picker step title.
    if (step === "datatype-select") return "Choose a data type";
    // HEL-399 — Shape-instantiate step title.
    if (step === "shape-instantiate") return `Start from a shape — ${selectedShape?.label ?? ""}`;
    return "Name your panel";
  }

  const templates = selectedType ? (PANEL_TEMPLATES[selectedType] ?? []) : [];

  // 2.5 — Derive per-type config objects for the sub-components; fall back to empty objects so
  //       inputs start blank and the sub-components are always controlled.
  const metricConfig: MetricTypeConfig =
    typeConfig?.type === "metric" ? typeConfig : { type: "metric" };
  const chartConfig: ChartTypeConfig =
    typeConfig?.type === "chart" ? typeConfig : { type: "chart" };
  const imageConfig: ImageTypeConfig =
    typeConfig?.type === "image" ? typeConfig : { type: "image" };

  const datatypeStepLoading = dataTypes.status === "loading" || dataTypes.status === "idle";
  // F-109 — a failed fetch is a distinct state from "successfully empty".
  const datatypeStepError = dataTypes.status === "failed" ? dataTypes.error : null;
  // F-214 — "Step N of M", computed from the resolved path for this type.
  const stepProgress = resolvedStepPath(selectedType, step);
  const stepProgressIndex = stepProgress.indexOf(step);

  return (
    <dialog
      ref={dialogRef}
      className="panel-creation-modal"
      aria-label="Create panel"
      onClose={onClose}
      // 1.3 — Intercept native Escape (cancel event) and route through handleDismiss.
      onCancel={(e) => {
        e.preventDefault();
        handleDismiss();
      }}
      // 1.4 — Backdrop click handler.
      onClick={handleBackdropClick}
    >
      <div className="panel-creation-modal__inner">
        <header className="panel-creation-modal__header">
          <div className="panel-creation-modal__header-text">
            {stepProgressIndex !== -1 && (
              <p className="panel-creation-modal__step-progress eyebrow">
                Step {stepProgressIndex + 1} of {stepProgress.length}
              </p>
            )}
            {/* F-110 — focusable step heading (see the `[step]`-keyed focus
                effect above) with `aria-live` so AT announces the step
                change even without a focus move. */}
            <h2
              ref={titleRef}
              tabIndex={-1}
              aria-live="polite"
              className="panel-creation-modal__title"
            >
              {getStepTitle()}
            </h2>
          </div>
          {/* 1.5 — Close button now routes through handleDismiss for dirty-state guard. */}
          <button
            type="button"
            className="panel-creation-modal__close"
            aria-label="Close modal"
            onClick={handleDismiss}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        {isShowingDiscardConfirm && (
          <div
            className="panel-creation-modal__discard-confirm"
            role="alertdialog"
            aria-label="Discard changes"
          >
            <span className="panel-creation-modal__discard-confirm-text">
              Discard changes? Any data you&apos;ve entered will be lost.
            </span>
            <div className="panel-creation-modal__discard-confirm-actions">
              <button
                type="button"
                className="panel-creation-modal__discard-confirm-btn panel-creation-modal__discard-confirm-btn--danger"
                onClick={confirmDiscard}
              >
                Discard
              </button>
              <button
                type="button"
                className="panel-creation-modal__discard-confirm-btn"
                onClick={cancelDiscard}
                autoFocus
              >
                Keep editing
              </button>
            </div>
          </div>
        )}

        {step === "type-select" && <TypeSelectStep onSelect={handleTypeSelect} />}

        {step === "template-select" && (
          <TemplateSelectStep
            templates={templates}
            onSelect={handleTemplateSelect}
            onBack={handleBackFromTemplate}
          />
        )}

        {/* 3.6-3.8 — DataType picker step for data-bound panel types. */}
        {step === "datatype-select" && (
          <DataTypeSelectStep
            loading={datatypeStepLoading}
            error={datatypeStepError}
            onRetry={() => void dispatch(fetchDataTypes())}
            registryDataTypes={pipelineOutputDataTypes}
            pipelineNameByTypeId={pipelineNameByTypeId}
            selectedDataTypeId={selectedDataTypeId}
            onSelect={setSelectedDataTypeId}
            allowSkip={isOptionallyDataBound(selectedType)}
            // F-121 — route through the same dirty-guard every other exit
            // uses, instead of discarding the in-progress draft unconditionally.
            onEmptyStateNavigate={handleDismiss}
            onBack={handleBackFromDataType}
            onNext={() => setStep("name-entry")}
            offeredShapes={offeredShapes}
            shapeCatalogError={shapeCatalogError}
            onSelectShape={handleSelectShape}
          />
        )}

        {/* HEL-399 — Shape-instantiate step: instantiate + run the selected shape, binding dataTypeId on success only. */}
        {step === "shape-instantiate" && selectedShape && (
          <ShapeInstantiateStep
            shape={selectedShape}
            onBack={handleBackFromShapeInstantiate}
            onComplete={handleShapeInstantiateComplete}
          />
        )}

        {step === "name-entry" && (
          <NameEntryStep
            selectedType={selectedType!}
            title={title}
            onTitleChange={setTitle}
            typeConfig={typeConfig}
            metricConfig={metricConfig}
            chartConfig={chartConfig}
            imageConfig={imageConfig}
            onTypeConfigChange={(cfg) => setTypeConfig(cfg)}
            // F-035 — the live preview needs to know the bound state to
            // render it honestly (never a stale "bind a data type" hint).
            dataTypeId={selectedDataTypeId}
            dataTypeName={
              selectedDataTypeId === null
                ? null
                : (pipelineOutputDataTypes.find((dt) => dt.id === selectedDataTypeId)?.name ?? null)
            }
            createError={createError}
            submitDisabled={
              isCreating ||
              title.trim().length === 0 ||
              // 3.9 / F-036 — Disabled only when the type genuinely requires
              // a DataType and none is selected.
              (requiresDataType(selectedType) && selectedDataTypeId === null)
            }
            isCreating={isCreating}
            onBack={handleBackFromName}
            onSubmit={(e) => void handleCreate(e)}
          />
        )}
      </div>
    </dialog>
  );
}
