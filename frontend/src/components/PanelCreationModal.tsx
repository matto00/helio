import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import "./PanelCreationModal.css";
import { createPanel } from "../features/panels/panelsSlice";
import { PANEL_TEMPLATES } from "../features/panels/panelTemplates";
import type { PanelTemplate } from "../features/panels/panelTemplates";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { InlineError } from "./InlineError";
import type { PanelType } from "../types/models";

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

type Step = "type-select" | "template-select" | "name-entry";

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
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleClose() {
    dialogRef.current?.close();
    onClose();
  }

  function handleTypeSelect(type: PanelType) {
    setSelectedType(type);
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
    try {
      await dispatch(
        createPanel({
          dashboardId: selectedDashboardId,
          title: normalizedTitle,
          type: selectedType,
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

  return (
    <dialog
      ref={dialogRef}
      className="panel-creation-modal"
      aria-label="Create panel"
      onClose={onClose}
    >
      <div className="panel-creation-modal__inner">
        <header className="panel-creation-modal__header">
          <h2 className="panel-creation-modal__title">{getStepTitle()}</h2>
          <button
            type="button"
            className="panel-creation-modal__close"
            aria-label="Close modal"
            onClick={handleClose}
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
        )}
      </div>
    </dialog>
  );
}
