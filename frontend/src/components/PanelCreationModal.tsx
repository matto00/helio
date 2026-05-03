import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import "./PanelCreationModal.css";
import { createPanel } from "../features/panels/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { InlineError } from "./InlineError";
import type { PanelType } from "../types/models";

const PANEL_TYPES: { value: PanelType; label: string; icon: string }[] = [
  { value: "metric", label: "Metric", icon: "📊" },
  { value: "chart", label: "Chart", icon: "📈" },
  { value: "text", label: "Text", icon: "T" },
  { value: "table", label: "Table", icon: "⊞" },
  { value: "markdown", label: "Markdown", icon: "M↓" },
  { value: "image", label: "Image", icon: "🖼" },
  { value: "divider", label: "Divider", icon: "—" },
];

type Step = "type-select" | "name-entry";

interface PanelCreationModalProps {
  onClose: () => void;
}

export function PanelCreationModal({ onClose }: PanelCreationModalProps) {
  const dispatch = useAppDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { selectedDashboardId } = useAppSelector((state) => state.dashboards);

  const [step, setStep] = useState<Step>("type-select");
  const [selectedType, setSelectedType] = useState<PanelType | null>(null);
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
    setStep("name-entry");
  }

  function handleBack() {
    setStep("type-select");
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

  return (
    <dialog
      ref={dialogRef}
      className="panel-creation-modal"
      aria-label="Create panel"
      onClose={onClose}
    >
      <div className="panel-creation-modal__inner">
        <header className="panel-creation-modal__header">
          <h2 className="panel-creation-modal__title">
            {step === "type-select" ? "Choose panel type" : "Name your panel"}
          </h2>
          <button
            type="button"
            className="panel-creation-modal__close"
            aria-label="Close modal"
            onClick={handleClose}
          >
            ✕
          </button>
        </header>

        {step === "type-select" ? (
          <div className="panel-creation-modal__type-grid" role="group" aria-label="Panel type">
            {PANEL_TYPES.map(({ value, label, icon }) => (
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
              </button>
            ))}
          </div>
        ) : (
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
                onClick={handleBack}
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
