import type { FormEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

import "./PanelCreationModal.css";
import { createPanel } from "../features/panels/panelsSlice";
import { PANEL_TEMPLATES } from "../features/panels/panelTemplates";
import type { PanelTemplate } from "../features/panels/panelTemplates";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { InlineError } from "./InlineError";
import type {
  ChartTypeConfig,
  DividerOrientation,
  DividerTypeConfig,
  ImageTypeConfig,
  MetricTypeConfig,
  PanelType,
  TypeConfig,
} from "../types/models";
import { PanelCreationPreview } from "./PanelCreationPreview";

const PANEL_TYPES: { value: PanelType; label: string; icon: string; description: string }[] = [
  {
    value: "metric",
    label: "Metric",
    icon: "📊",
    description: "Display a single KPI value or stat",
  },
  {
    value: "chart",
    label: "Chart",
    icon: "📈",
    description: "Visualize trends with line, bar, or pie",
  },
  { value: "text", label: "Text", icon: "T", description: "Add freeform text or headings" },
  {
    value: "table",
    label: "Table",
    icon: "⊞",
    description: "Show structured data in rows and columns",
  },
  {
    value: "markdown",
    label: "Markdown",
    icon: "M↓",
    description: "Write formatted content with Markdown",
  },
  { value: "image", label: "Image", icon: "🖼", description: "Embed an image from a URL" },
  {
    value: "divider",
    label: "Divider",
    icon: "—",
    description: "Separate sections with a visual line",
  },
];

// Selector for all keyboard-focusable elements inside the modal.
const FOCUSABLE_SELECTORS =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Step = "type-select" | "template-select" | "name-entry";

// ── Type-specific config helpers ─────────────────────────────────────────────

/** Returns true if typeConfig has at least one non-empty value worth submitting. */
function hasNonEmptyTypeConfig(config: TypeConfig | null): config is TypeConfig {
  if (!config) return false;
  switch (config.type) {
    case "metric":
      return !!(config.valueLabel || config.unit);
    case "chart":
      return !!config.chartType;
    case "image":
      return !!config.imageUrl;
    case "divider":
      return !!config.dividerOrientation;
  }
}

// ── Per-type config field components ─────────────────────────────────────────

/** 2.1 — Value label + unit inputs for metric panels. */
function MetricConfigFields({
  config,
  onChange,
}: {
  config: MetricTypeConfig;
  onChange: (config: MetricTypeConfig) => void;
}) {
  return (
    <>
      <div className="panel-creation-modal__field">
        <label className="panel-creation-modal__label" htmlFor="panel-create-value-label">
          Value label
        </label>
        <input
          id="panel-create-value-label"
          className="panel-creation-modal__input"
          type="text"
          value={config.valueLabel ?? ""}
          onChange={(e) => onChange({ ...config, valueLabel: e.target.value || undefined })}
          placeholder="e.g. Revenue"
          aria-label="Value label"
        />
      </div>
      <div className="panel-creation-modal__field">
        <label className="panel-creation-modal__label" htmlFor="panel-create-unit">
          Unit
        </label>
        <input
          id="panel-create-unit"
          className="panel-creation-modal__input"
          type="text"
          value={config.unit ?? ""}
          onChange={(e) => onChange({ ...config, unit: e.target.value || undefined })}
          placeholder="e.g. $, %, ms"
          aria-label="Unit"
        />
      </div>
    </>
  );
}

/** 2.2 — Chart type selector (line / bar / pie) for chart panels. */
function ChartTypeField({
  config,
  onChange,
}: {
  config: ChartTypeConfig;
  onChange: (config: ChartTypeConfig) => void;
}) {
  return (
    <div className="panel-creation-modal__field">
      <label className="panel-creation-modal__label" htmlFor="panel-create-chart-type">
        Chart type
      </label>
      <select
        id="panel-create-chart-type"
        className="panel-creation-modal__input"
        value={config.chartType ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ ...config, chartType: v ? (v as "line" | "bar" | "pie") : undefined });
        }}
        aria-label="Chart type"
      >
        <option value="">Select chart type</option>
        <option value="line">Line</option>
        <option value="bar">Bar</option>
        <option value="pie">Pie</option>
      </select>
    </div>
  );
}

/** 2.3 — Image URL input for image panels. */
function ImageConfigField({
  config,
  onChange,
}: {
  config: ImageTypeConfig;
  onChange: (config: ImageTypeConfig) => void;
}) {
  return (
    <div className="panel-creation-modal__field">
      <label className="panel-creation-modal__label" htmlFor="panel-create-image-url">
        Image URL
      </label>
      <input
        id="panel-create-image-url"
        className="panel-creation-modal__input"
        type="url"
        value={config.imageUrl ?? ""}
        onChange={(e) => onChange({ ...config, imageUrl: e.target.value || undefined })}
        placeholder="https://example.com/image.jpg"
        aria-label="Image URL"
      />
    </div>
  );
}

/** 2.4 — Orientation selector (horizontal / vertical) for divider panels. */
function DividerConfigField({
  config,
  onChange,
}: {
  config: DividerTypeConfig;
  onChange: (config: DividerTypeConfig) => void;
}) {
  return (
    <div className="panel-creation-modal__field">
      <label className="panel-creation-modal__label" htmlFor="panel-create-orientation">
        Orientation
      </label>
      <select
        id="panel-create-orientation"
        className="panel-creation-modal__input"
        value={config.dividerOrientation ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange({
            ...config,
            dividerOrientation: v ? (v as DividerOrientation) : undefined,
          });
        }}
        aria-label="Orientation"
      >
        <option value="">Select orientation</option>
        <option value="horizontal">Horizontal</option>
        <option value="vertical">Vertical</option>
      </select>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface PanelCreationModalProps {
  onClose: () => void;
}

export function PanelCreationModal({ onClose }: PanelCreationModalProps) {
  const dispatch = useAppDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { selectedDashboardId } = useAppSelector((state) => state.dashboards);

  const [step, setStep] = useState<Step>("type-select");
  const [selectedType, setSelectedType] = useState<PanelType | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PanelTemplate | null>(null);
  const [title, setTitle] = useState("");
  // 1.2 — Type-specific config lives in local state alongside existing fields.
  const [typeConfig, setTypeConfig] = useState<TypeConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 1.3 — Dirty when the user has selected a type, template, typed a title, or entered any config.
  const isDirty =
    selectedType !== null ||
    selectedTemplate !== null ||
    title !== "" ||
    hasNonEmptyTypeConfig(typeConfig);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

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
    // 1.4 — typeConfig resets automatically when the component unmounts on close.
  }

  // 1.2 — Shared dismiss helper: prompts when dirty, closes directly when clean.
  function handleDismiss() {
    if (isDirty) {
      if (window.confirm("Discard changes? Any data you've entered will be lost.")) {
        handleClose();
      }
    } else {
      handleClose();
    }
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

  function handleTemplateSelect(template: PanelTemplate | null) {
    setSelectedTemplate(template);
    setTitle(template?.defaults.title ?? "");
    setStep("name-entry");
  }

  function handleBackFromTemplate() {
    setStep("type-select");
    setSelectedTemplate(null);
  }

  function handleBackFromName() {
    setStep("template-select");
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
    return "Name your panel";
  }

  const templates = selectedType ? PANEL_TEMPLATES[selectedType] : [];

  // 2.5 — Derive per-type config objects for the sub-components; fall back to empty objects so
  //       inputs start blank and the sub-components are always controlled.
  const metricConfig: MetricTypeConfig =
    typeConfig?.type === "metric" ? typeConfig : { type: "metric" };
  const chartConfig: ChartTypeConfig =
    typeConfig?.type === "chart" ? typeConfig : { type: "chart" };
  const imageConfig: ImageTypeConfig =
    typeConfig?.type === "image" ? typeConfig : { type: "image" };
  const dividerConfig: DividerTypeConfig =
    typeConfig?.type === "divider" ? typeConfig : { type: "divider" };

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
            ✕
          </button>
        </header>

        {step === "type-select" && (
          <div className="panel-creation-modal__type-grid" role="group" aria-label="Panel type">
            {PANEL_TYPES.map(({ value, label, icon, description }) => (
              <button
                key={value}
                type="button"
                className="panel-creation-modal__type-card"
                aria-label={label}
                onClick={() => handleTypeSelect(value)}
              >
                <span className="panel-creation-modal__type-icon" aria-hidden="true">
                  {icon}
                </span>
                <span className="panel-creation-modal__type-label">{label}</span>
                <span className="panel-creation-modal__type-description">{description}</span>
              </button>
            ))}
          </div>
        )}

        {step === "template-select" && (
          <div className="panel-creation-modal__template-step">
            <div
              className="panel-creation-modal__template-grid"
              role="group"
              aria-label="Panel template"
            >
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="panel-creation-modal__template-card"
                  aria-label={template.label}
                  onClick={() => handleTemplateSelect(template)}
                >
                  <span className="panel-creation-modal__template-label">{template.label}</span>
                  <span className="panel-creation-modal__template-description">
                    {template.description}
                  </span>
                </button>
              ))}
              <button
                type="button"
                className="panel-creation-modal__template-card panel-creation-modal__template-card--blank"
                aria-label="Start blank"
                onClick={() => handleTemplateSelect(null)}
              >
                <span className="panel-creation-modal__template-label">Start blank</span>
                <span className="panel-creation-modal__template-description">
                  Begin with an empty panel
                </span>
              </button>
            </div>
            <div className="panel-creation-modal__actions">
              <button
                type="button"
                className="panel-creation-modal__btn panel-creation-modal__btn--secondary"
                onClick={handleBackFromTemplate}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === "name-entry" && (
          <div className="panel-creation-modal__name-entry">
            <form className="panel-creation-modal__form" onSubmit={(e) => void handleCreate(e)}>
              <div className="panel-creation-modal__field">
                <label className="panel-creation-modal__label" htmlFor="panel-create-title">
                  Panel title
                </label>
                <input
                  id="panel-create-title"
                  className="panel-creation-modal__input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Revenue Pulse"
                  aria-label="Panel title"
                  autoFocus
                />
              </div>

              {/* 2.5 — Per-type config fields rendered below the title input. */}
              {selectedType === "metric" && (
                <MetricConfigFields config={metricConfig} onChange={(cfg) => setTypeConfig(cfg)} />
              )}
              {selectedType === "chart" && (
                <ChartTypeField config={chartConfig} onChange={(cfg) => setTypeConfig(cfg)} />
              )}
              {selectedType === "image" && (
                <ImageConfigField config={imageConfig} onChange={(cfg) => setTypeConfig(cfg)} />
              )}
              {selectedType === "divider" && (
                <DividerConfigField config={dividerConfig} onChange={(cfg) => setTypeConfig(cfg)} />
              )}

              <InlineError error={createError} />
              <div className="panel-creation-modal__actions">
                <button
                  type="button"
                  className="panel-creation-modal__btn panel-creation-modal__btn--secondary"
                  onClick={handleBackFromName}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="panel-creation-modal__btn panel-creation-modal__btn--primary"
                  disabled={isCreating || title.trim().length === 0}
                >
                  {isCreating ? "Creating..." : "Create panel"}
                </button>
              </div>
            </form>
            {/* 2.6 — Pass typeConfig to preview so it reflects entered config live. */}
            <PanelCreationPreview type={selectedType!} title={title} typeConfig={typeConfig} />
          </div>
        )}
      </div>
    </dialog>
  );
}
