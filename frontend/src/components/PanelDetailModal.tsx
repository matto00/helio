import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import "./PanelDetailModal.css";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { PANEL_SLOTS } from "../features/panels/panelSlots";
import { updatePanelAppearance, updatePanelBinding } from "../features/panels/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
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

  const dataTypes = useAppSelector((state) => state.dataTypes.items);
  const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

  const [activeTab, setActiveTab] = useState<Tab>("appearance");

  // Appearance state
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

  // Data binding state
  const initialTypeId = panel.typeId;
  const initialFieldMapping = panel.fieldMapping ?? {};
  const initialRefreshInterval = panel.refreshInterval;

  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(initialTypeId);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>(initialFieldMapping);
  const [refreshInterval, setRefreshInterval] = useState<number | null>(initialRefreshInterval);
  const [typeSearch, setTypeSearch] = useState("");
  const [isDataSaving, setIsDataSaving] = useState(false);
  const [dataSaveError, setDataSaveError] = useState<string | null>(null);

  const [showDiscardWarning, setShowDiscardWarning] = useState(false);

  const isDirty =
    background !== initialBackground ||
    color !== initialColor ||
    transparency !== initialTransparency;

  const dataDirty =
    selectedTypeId !== initialTypeId ||
    refreshInterval !== initialRefreshInterval ||
    JSON.stringify(fieldMapping) !== JSON.stringify(initialFieldMapping);

  const isAnyDirtyRef = useRef(isDirty || dataDirty);
  isAnyDirtyRef.current = isDirty || dataDirty;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function attemptClose() {
      if (isAnyDirtyRef.current) {
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
    if (isDirty || dataDirty) {
      setShowDiscardWarning(true);
    } else {
      dialogRef.current?.close();
      onCloseRef.current();
    }
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    if (tab === "data" && dataTypesStatus === "idle") {
      void dispatch(fetchDataTypes());
    }
  }

  async function handleAppearanceSubmit(e: FormEvent<HTMLFormElement>) {
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

  async function handleDataSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsDataSaving(true);
    setDataSaveError(null);
    try {
      await dispatch(
        updatePanelBinding({
          panelId: panel.id,
          typeId: selectedTypeId,
          fieldMapping: Object.keys(fieldMapping).length > 0 ? fieldMapping : null,
          refreshInterval,
        }),
      ).unwrap();
      dialogRef.current?.close();
      onCloseRef.current();
    } catch {
      setDataSaveError("Failed to save data binding.");
    } finally {
      setIsDataSaving(false);
    }
  }

  const selectedType = dataTypes.find((dt) => dt.id === selectedTypeId) ?? null;
  const slots = PANEL_SLOTS[panel.type];
  const filteredDataTypes = dataTypes.filter((dt) =>
    dt.name.toLowerCase().includes(typeSearch.toLowerCase()),
  );

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
            onClick={() => handleTabChange("appearance")}
          >
            Appearance
          </button>
          <button
            type="button"
            role="tab"
            className="panel-detail-modal__tab"
            aria-selected={activeTab === "data"}
            onClick={() => handleTabChange("data")}
          >
            Data
          </button>
        </div>

        {activeTab === "appearance" ? (
          <form
            id="panel-detail-appearance-form"
            className="panel-detail-modal__content"
            onSubmit={handleAppearanceSubmit}
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
          <form
            id="panel-detail-data-form"
            className="panel-detail-modal__content"
            onSubmit={handleDataSubmit}
          >
            <div className="panel-detail-modal__data-section">
              <span className="panel-detail-modal__data-label">Data type</span>
              {selectedType ? (
                <div className="panel-detail-modal__selected-type">
                  <span className="panel-detail-modal__selected-type-name">
                    {selectedType.name}
                  </span>
                  {selectedType.sourceId && (
                    <span className="panel-detail-modal__type-badge">source</span>
                  )}
                  <span className="panel-detail-modal__type-count">
                    {selectedType.fields.length} fields
                  </span>
                  <button
                    type="button"
                    className="panel-detail-modal__type-clear"
                    aria-label="Clear selected data type"
                    onClick={() => {
                      setSelectedTypeId(null);
                      setFieldMapping({});
                      setTypeSearch("");
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    className="panel-detail-modal__type-search"
                    placeholder="Search data types…"
                    value={typeSearch}
                    onChange={(e) => setTypeSearch(e.target.value)}
                    aria-label="Search data types"
                  />
                  {dataTypesStatus === "loading" ? (
                    <p className="panel-detail-modal__type-hint">Loading…</p>
                  ) : filteredDataTypes.length === 0 ? (
                    <p className="panel-detail-modal__type-hint">No data types found.</p>
                  ) : (
                    <ul
                      className="panel-detail-modal__type-list"
                      role="listbox"
                      aria-label="Data types"
                    >
                      {filteredDataTypes.map((dt) => (
                        <li
                          key={dt.id}
                          role="option"
                          aria-selected={dt.id === selectedTypeId}
                          className="panel-detail-modal__type-option"
                          onClick={() => {
                            setSelectedTypeId(dt.id);
                            setTypeSearch("");
                          }}
                        >
                          <span className="panel-detail-modal__selected-type-name">{dt.name}</span>
                          {dt.sourceId && (
                            <span className="panel-detail-modal__type-badge">source</span>
                          )}
                          <span className="panel-detail-modal__type-count">
                            {dt.fields.length} fields
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <Link to="/sources" className="panel-detail-modal__source-link">
                Add a new source →
              </Link>
            </div>

            {selectedType && slots.length > 0 && (
              <div className="panel-detail-modal__data-section">
                <span className="panel-detail-modal__data-label">Field mapping</span>
                {slots.map((slot) => (
                  <div key={slot.key} className="panel-detail-modal__mapping-row">
                    <label
                      className="panel-detail-modal__mapping-label"
                      htmlFor={`slot-${slot.key}`}
                    >
                      {slot.label}
                    </label>
                    <select
                      id={`slot-${slot.key}`}
                      className="panel-detail-modal__mapping-select"
                      value={fieldMapping[slot.key] ?? ""}
                      onChange={(e) =>
                        setFieldMapping((prev) => ({
                          ...prev,
                          [slot.key]: e.target.value,
                        }))
                      }
                      aria-label={`${slot.label} field`}
                    >
                      <option value="">— None —</option>
                      {selectedType.fields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className="panel-detail-modal__data-section">
              <label className="panel-detail-modal__data-label" htmlFor="refresh-interval">
                Refresh interval
              </label>
              <select
                id="refresh-interval"
                className="panel-detail-modal__mapping-select"
                value={refreshInterval ?? ""}
                onChange={(e) =>
                  setRefreshInterval(e.target.value === "" ? null : Number(e.target.value))
                }
                aria-label="Refresh interval"
              >
                <option value="">Manual</option>
                <option value="30">30s</option>
                <option value="60">1m</option>
                <option value="300">5m</option>
                <option value="900">15m</option>
                <option value="3600">1h</option>
              </select>
            </div>

            <InlineError error={dataSaveError} />
          </form>
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
          ) : (
            <button
              type="submit"
              form="panel-detail-data-form"
              className="panel-detail-modal__btn panel-detail-modal__btn--save"
              aria-label="Save data binding"
              disabled={isDataSaving}
            >
              {isDataSaving ? "Saving..." : "Save"}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
