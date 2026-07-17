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
import { createPanel } from "../state/panelsSlice";
import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../dataTypes/state/dataTypesSlice";
import { PANEL_TEMPLATES } from "../state/panelTemplates";
import type { PanelTemplate } from "../state/panelTemplates";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
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
import { TemplateSelectStep } from "./creationSteps/TemplateSelectStep";
import { TypeSelectStep } from "./creationSteps/TypeSelectStep";

// Selector for all keyboard-focusable elements inside the modal.
const FOCUSABLE_SELECTORS =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Step = "type-select" | "template-select" | "datatype-select" | "name-entry";

// 3.2 — Data-bound panel types require a DataType selection before creation.
const DATA_BOUND_TYPES: PanelType[] = [
  "metric",
  "chart",
  "text",
  "table",
  "markdown",
  "collection",
];

function isDataBound(type: PanelType | null): boolean {
  return type !== null && (DATA_BOUND_TYPES as string[]).includes(type);
}

interface PanelCreationModalProps {
  onClose: () => void;
}

export function PanelCreationModal({ onClose }: PanelCreationModalProps) {
  const dispatch = useAppDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { selectedDashboardId } = useAppSelector((state) => state.dashboards);
  // 3.6 — Slice for DataType picker.
  const dataTypes = useAppSelector((state) => state.dataTypes);
  const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);

  const [step, setStep] = useState<Step>("type-select");
  const [selectedType, setSelectedType] = useState<PanelType | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PanelTemplate | null>(null);
  const [title, setTitle] = useState("");
  // 1.2 — Type-specific config lives in local state alongside existing fields.
  const [typeConfig, setTypeConfig] = useState<TypeConfig | null>(null);
  // 3.3 — DataType selection for data-bound panel types.
  const [selectedDataTypeId, setSelectedDataTypeId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Inline discard confirmation banner (replaces window.confirm for dirty dismiss).
  const [isShowingDiscardConfirm, setIsShowingDiscardConfirm] = useState(false);

  // 1.3 — Dirty when the user has selected a type, template, typed a title, entered any config, or selected a DataType.
  const isDirty =
    selectedType !== null ||
    selectedTemplate !== null ||
    title !== "" ||
    hasNonEmptyTypeConfig(typeConfig) ||
    selectedDataTypeId !== null;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // 3.6 — Fetch data types on mount if not yet loaded.
  useEffect(() => {
    if (dataTypes.status === "idle") {
      void dispatch(fetchDataTypes());
    }
  }, [dispatch, dataTypes.status]);

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

  // 1.2 — Shared dismiss helper: shows inline confirm when dirty, closes directly when clean.
  function handleDismiss() {
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
    setStep("template-select");
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

  // 3.5 — Back from datatype-select returns to template-select and clears the DataType selection.
  function handleBackFromDataType() {
    setStep("template-select");
    setSelectedDataTypeId(null);
  }

  function handleBackFromName() {
    // For data-bound types, back goes to datatype-select; otherwise to template-select.
    if (isDataBound(selectedType)) {
      setStep("datatype-select");
    } else {
      setStep("template-select");
    }
    setCreateError(null);
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

    // 3.9 — Block creation if data-bound type has no DataType selected.
    if (isDataBound(selectedType) && selectedDataTypeId === null) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    // 3.1 — Include typeConfig in the payload only when it has non-empty values.
    const nonEmptyConfig = hasNonEmptyTypeConfig(typeConfig) ? typeConfig : undefined;
    try {
      await dispatch(
        createPanel({
          dashboardId: selectedDashboardId,
          title: normalizedTitle,
          type: selectedType,
          ...(nonEmptyConfig !== undefined ? { typeConfig: nonEmptyConfig } : {}),
          // 3.9 — Pass dataTypeId for data-bound types.
          dataTypeId: selectedDataTypeId ?? undefined,
        }),
      ).unwrap();
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

  return (
    <dialog
      ref={dialogRef}
      className={`panel-creation-modal${step === "name-entry" ? " panel-creation-modal--wide" : ""}`}
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
          <h2 className="panel-creation-modal__title">{getStepTitle()}</h2>
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
            registryDataTypes={pipelineOutputDataTypes}
            selectedDataTypeId={selectedDataTypeId}
            onSelect={setSelectedDataTypeId}
            onEmptyStateNavigate={handleClose}
            onBack={handleBackFromDataType}
            onNext={() => setStep("name-entry")}
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
            createError={createError}
            submitDisabled={
              isCreating ||
              title.trim().length === 0 ||
              // 3.9 — Disabled if data-bound type and no DataType selected.
              (isDataBound(selectedType) && selectedDataTypeId === null)
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
