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
import type { ChartAppearance, Panel, PanelAppearance } from "../types/models";
import { ChartPanel } from "./ChartPanel";
import { InlineError } from "./InlineError";

type Tab = "appearance" | "data";

const DEFAULT_CHART_APPEARANCE: ChartAppearance = {
  seriesColors: [
    "#5470c6",
    "#91cc75",
    "#fac858",
    "#ee6666",
    "#73c0de",
    "#3ba272",
    "#fc8452",
    "#9a60b4",
  ],
  legend: { show: true, position: "top" },
  tooltip: { enabled: true },
  axisLabels: {
    x: { show: true, label: "X Axis" },
    y: { show: true, label: "Y Axis" },
  },
};

function padSeriesColors(colors: string[]): string[] {
  const defaults = DEFAULT_CHART_APPEARANCE.seriesColors;
  const padded = [...colors];
  while (padded.length < 8) {
    padded.push(defaults[padded.length]);
  }
  return padded.slice(0, 8);
}

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

  // Chart appearance state (for chart panels only)
  const initialChart: ChartAppearance = {
    ...DEFAULT_CHART_APPEARANCE,
    ...(panel.appearance.chart ?? {}),
    seriesColors: padSeriesColors(panel.appearance.chart?.seriesColors ?? []),
    legend: panel.appearance.chart?.legend ?? DEFAULT_CHART_APPEARANCE.legend,
    tooltip: panel.appearance.chart?.tooltip ?? DEFAULT_CHART_APPEARANCE.tooltip,
    axisLabels: panel.appearance.chart?.axisLabels ?? DEFAULT_CHART_APPEARANCE.axisLabels,
  };
  const [chartAppearance, setChartAppearance] = useState<ChartAppearance>(initialChart);

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
    transparency !== initialTransparency ||
    (panel.type === "chart" && JSON.stringify(chartAppearance) !== JSON.stringify(initialChart));

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
      const appearancePayload: PanelAppearance = {
        background,
        color,
        transparency: clampTransparency(transparency / 100),
        ...(panel.type === "chart" ? { chart: chartAppearance } : {}),
      };
      await dispatch(
        updatePanelAppearance({
          panelId: panel.id,
          appearance: appearancePayload,
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
            {panel.type === "chart" && (
              <div className="panel-detail-modal__chart-section">
                <span className="panel-detail-modal__section-heading">Chart</span>

                <div className="panel-detail-modal__chart-preview">
                  <ChartPanel
                    appearance={{
                      background,
                      color,
                      transparency: clampTransparency(transparency / 100),
                      chart: chartAppearance,
                    }}
                  />
                </div>

                <div className="panel-detail-modal__chart-subsection">
                  <span className="panel-detail-modal__chart-label">Series colors</span>
                  <div className="panel-detail-modal__color-swatches">
                    {chartAppearance.seriesColors.map((hex, i) => (
                      <input
                        key={i}
                        type="color"
                        value={hex}
                        aria-label={`Series color ${String(i + 1)}`}
                        onChange={(e) =>
                          setChartAppearance((prev) => {
                            const next = [...prev.seriesColors];
                            next[i] = e.target.value;
                            return { ...prev, seriesColors: next };
                          })
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="panel-detail-modal__chart-subsection">
                  <label className="panel-detail-modal__chart-label">
                    <input
                      type="checkbox"
                      checked={chartAppearance.legend.show}
                      onChange={(e) =>
                        setChartAppearance((prev) => ({
                          ...prev,
                          legend: { ...prev.legend, show: e.target.checked },
                        }))
                      }
                      aria-label="Show legend"
                    />
                    Show legend
                  </label>
                  {chartAppearance.legend.show && (
                    <div className="panel-detail-modal__row">
                      <label className="panel-detail-modal__field">
                        <span>Legend position</span>
                        <select
                          value={chartAppearance.legend.position}
                          onChange={(e) =>
                            setChartAppearance((prev) => ({
                              ...prev,
                              legend: {
                                ...prev.legend,
                                position: e.target.value as "top" | "bottom" | "left" | "right",
                              },
                            }))
                          }
                          aria-label="Legend position"
                        >
                          <option value="top">Top</option>
                          <option value="bottom">Bottom</option>
                          <option value="left">Left</option>
                          <option value="right">Right</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>

                <div className="panel-detail-modal__chart-subsection">
                  <label className="panel-detail-modal__chart-label">
                    <input
                      type="checkbox"
                      checked={chartAppearance.tooltip.enabled}
                      onChange={(e) =>
                        setChartAppearance((prev) => ({
                          ...prev,
                          tooltip: { enabled: e.target.checked },
                        }))
                      }
                      aria-label="Enable tooltip"
                    />
                    Enable tooltip
                  </label>
                </div>

                <div className="panel-detail-modal__chart-subsection">
                  <label className="panel-detail-modal__chart-label">
                    <input
                      type="checkbox"
                      checked={chartAppearance.axisLabels.x.show}
                      onChange={(e) =>
                        setChartAppearance((prev) => ({
                          ...prev,
                          axisLabels: {
                            ...prev.axisLabels,
                            x: { ...prev.axisLabels.x, show: e.target.checked },
                          },
                        }))
                      }
                      aria-label="Show X-axis label"
                    />
                    Show X-axis label
                  </label>
                  {chartAppearance.axisLabels.x.show && (
                    <input
                      type="text"
                      className="panel-detail-modal__type-search"
                      placeholder="X axis label text"
                      value={chartAppearance.axisLabels.x.label ?? ""}
                      onChange={(e) =>
                        setChartAppearance((prev) => ({
                          ...prev,
                          axisLabels: {
                            ...prev.axisLabels,
                            x: { ...prev.axisLabels.x, label: e.target.value },
                          },
                        }))
                      }
                      aria-label="X-axis label text"
                    />
                  )}
                </div>

                <div className="panel-detail-modal__chart-subsection">
                  <label className="panel-detail-modal__chart-label">
                    <input
                      type="checkbox"
                      checked={chartAppearance.axisLabels.y.show}
                      onChange={(e) =>
                        setChartAppearance((prev) => ({
                          ...prev,
                          axisLabels: {
                            ...prev.axisLabels,
                            y: { ...prev.axisLabels.y, show: e.target.checked },
                          },
                        }))
                      }
                      aria-label="Show Y-axis label"
                    />
                    Show Y-axis label
                  </label>
                  {chartAppearance.axisLabels.y.show && (
                    <input
                      type="text"
                      className="panel-detail-modal__type-search"
                      placeholder="Y axis label text"
                      value={chartAppearance.axisLabels.y.label ?? ""}
                      onChange={(e) =>
                        setChartAppearance((prev) => ({
                          ...prev,
                          axisLabels: {
                            ...prev.axisLabels,
                            y: { ...prev.axisLabels.y, label: e.target.value },
                          },
                        }))
                      }
                      aria-label="Y-axis label text"
                    />
                  )}
                </div>
              </div>
            )}
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
                      {(selectedType.computedFields ?? []).map((cf) => (
                        <option key={`computed:${cf.name}`} value={cf.name}>
                          {cf.name} (computed)
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
