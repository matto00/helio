import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import "./PanelDetailModal.css";
import { updatePanelAppearance } from "../features/panels/panelsSlice";
import { useAppDispatch } from "../hooks/reduxHooks";
import {
  clampTransparency,
  getColorInputValue,
  panelAppearanceEditorFallback,
  panelTextEditorFallback,
} from "../theme/appearance";
import type { Panel } from "../types/models";
import { InlineError } from "./InlineError";

type Tab = "appearance" | "data";

interface PanelDetailModalProps {
  panel: Panel;
  onClose: () => void;
}

export function PanelDetailModal({ panel, onClose }: PanelDetailModalProps) {
  const dispatch = useAppDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [activeTab, setActiveTab] = useState<Tab>("appearance");

  const initialBackground = getColorInputValue(
    panel.appearance.background,
    panelAppearanceEditorFallback,
  );
  const initialColor = getColorInputValue(panel.appearance.color, panelTextEditorFallback);
  const initialTransparency = Math.round(clampTransparency(panel.appearance.transparency) * 100);

  const [background, setBackground] = useState(initialBackground);
  const [color, setColor] = useState(initialColor);
  const [transparency, setTransparency] = useState(initialTransparency);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDiscardWarning, setShowDiscardWarning] = useState(false);

  const isDirty =
    background !== initialBackground ||
    color !== initialColor ||
    transparency !== initialTransparency;

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function attemptClose() {
      if (isDirtyRef.current) {
        setShowDiscardWarning(true);
      } else {
        dialog!.close();
        onCloseRef.current();
      }
    }

    function handleCancel(e: Event) {
      e.preventDefault();
      attemptClose();
    }

    function handleClick(e: MouseEvent) {
      if (e.target === dialog) attemptClose();
    }

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("click", handleClick);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("click", handleClick);
    };
  }, []);

  function handleDiscard() {
    dialogRef.current?.close();
    onCloseRef.current();
  }

  function handleCancel() {
    if (isDirty) {
      setShowDiscardWarning(true);
    } else {
      dialogRef.current?.close();
      onCloseRef.current();
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    try {
      await dispatch(
        updatePanelAppearance({
          panelId: panel.id,
          appearance: {
            background,
            color,
            transparency: clampTransparency(transparency / 100),
          },
        }),
      ).unwrap();
      dialogRef.current?.close();
      onCloseRef.current();
    } catch {
      setSaveError("Failed to save panel appearance.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="panel-detail-modal" aria-label={`${panel.title} settings`}>
      <div className="panel-detail-modal__inner">
        <header className="panel-detail-modal__header">
          <span className="panel-detail-modal__title">Panel: &ldquo;{panel.title}&rdquo;</span>
          <button
            type="button"
            className="panel-detail-modal__close"
            aria-label="Close panel settings"
            onClick={handleCancel}
          >
            ✕
          </button>
        </header>

        <div className="panel-detail-modal__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="panel-detail-modal__tab"
            aria-selected={activeTab === "appearance"}
            onClick={() => setActiveTab("appearance")}
          >
            Appearance
          </button>
          <button
            type="button"
            role="tab"
            className="panel-detail-modal__tab"
            aria-selected={activeTab === "data"}
            onClick={() => setActiveTab("data")}
          >
            Data
          </button>
        </div>

        {activeTab === "appearance" ? (
          <form
            id="panel-detail-appearance-form"
            className="panel-detail-modal__content"
            onSubmit={handleSubmit}
          >
            <div className="panel-detail-modal__row">
              <label className="panel-detail-modal__field">
                <span>Background</span>
                <input
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  aria-label={`${panel.title} background color`}
                />
              </label>
              <label className="panel-detail-modal__field">
                <span>Text</span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label={`${panel.title} text color`}
                />
              </label>
            </div>
            <label className="panel-detail-modal__slider">
              <span>Transparency</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={transparency}
                onChange={(e) => setTransparency(Number(e.target.value))}
                aria-label={`${panel.title} transparency`}
              />
              <strong>{transparency}%</strong>
            </label>
            <InlineError error={saveError} />
          </form>
        ) : (
          <div className="panel-detail-modal__content panel-detail-modal__content--data">
            <p className="panel-detail-modal__data-placeholder">
              Connect a data source to display real content
            </p>
          </div>
        )}

        {showDiscardWarning ? (
          <div className="panel-detail-modal__discard-warning">
            <span>You have unsaved changes. Discard them?</span>
            <div className="panel-detail-modal__discard-actions">
              <button
                type="button"
                className="panel-detail-modal__discard-confirm"
                onClick={handleDiscard}
              >
                Discard
              </button>
              <button
                type="button"
                className="panel-detail-modal__discard-cancel"
                onClick={() => setShowDiscardWarning(false)}
              >
                Keep editing
              </button>
            </div>
          </div>
        ) : null}

        <footer className="panel-detail-modal__footer">
          <button
            type="button"
            className="panel-detail-modal__btn panel-detail-modal__btn--cancel"
            onClick={handleCancel}
          >
            Cancel
          </button>
          {activeTab === "appearance" ? (
            <button
              type="submit"
              form="panel-detail-appearance-form"
              className="panel-detail-modal__btn panel-detail-modal__btn--save"
              aria-label="Save panel style"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          ) : null}
        </footer>
      </div>
    </dialog>
  );
}
