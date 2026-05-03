import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import "./PanelDetailModal.css";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { PANEL_SLOTS } from "../features/panels/panelSlots";
import {
  accumulatePanelUpdate,
  updatePanelBinding,
  updatePanelContent,
  updatePanelDivider,
  updatePanelImage,
} from "../features/panels/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { usePanelData } from "../hooks/usePanelData";
import {
  clampTransparency,
  getColorInputValue,
  panelAppearanceEditorFallback,
  panelTextEditorFallback,
} from "../theme/appearance";
import type {
  ChartAppearance,
  DividerOrientation,
  ImageFit,
  Panel,
  PanelAppearance,
} from "../types/models";
import { InlineError } from "./InlineError";
import { PanelContent } from "./PanelContent";

type Tab = "appearance" | "data" | "content" | "image" | "divider";

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
  chartType: "line",
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
  const sources = useAppSelector((state) => state.sources);
  const { data, rawRows, headers, isLoading, error, noData } = usePanelData(panel, dataTypes, sources);

  // Modal mode: "view" is the default on open; "edit" shows the full editing UI
  const [modalMode, setModalMode] = useState<"view" | "edit">("view");
  const modalModeRef = useRef<"view" | "edit">("view");
  modalModeRef.current = modalMode;

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

  // Chart appearance state (for chart panels only)
  const initialChart: ChartAppearance = {
    ...DEFAULT_CHART_APPEARANCE,
    ...(panel.appearance.chart ?? {}),
    seriesColors: padSeriesColors(panel.appearance.chart?.seriesColors ?? []),
    legend: panel.appearance.chart?.legend ?? DEFAULT_CHART_APPEARANCE.legend,
    tooltip: panel.appearance.chart?.tooltip ?? DEFAULT_CHART_APPEARANCE.tooltip,
    axisLabels: panel.appearance.chart?.axisLabels ?? DEFAULT_CHART_APPEARANCE.axisLabels,
    chartType: panel.appearance.chart?.chartType ?? "line",
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

  // Markdown content state (for markdown panels only)
  const initialContent = panel.content ?? "";
  const [markdownContent, setMarkdownContent] = useState(initialContent);
  const [isContentSaving, setIsContentSaving] = useState(false);
  const [contentSaveError, setContentSaveError] = useState<string | null>(null);
  const contentDirty = markdownContent !== initialContent;

  // Image state (for image panels only)
  const initialImageUrl = panel.imageUrl ?? "";
  const initialImageFit: ImageFit = panel.imageFit ?? "contain";
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [imageFit, setImageFit] = useState<ImageFit>(initialImageFit);
  const [isImageSaving, setIsImageSaving] = useState(false);
  const [imageSaveError, setImageSaveError] = useState<string | null>(null);
  const imageDirty = imageUrl !== initialImageUrl || imageFit !== initialImageFit;

  // Divider state (for divider panels only)
  const initialDividerOrientation: DividerOrientation =
    (panel.dividerOrientation as DividerOrientation) ?? "horizontal";
  const initialDividerWeight = panel.dividerWeight ?? 1;
  const initialDividerColor = panel.dividerColor ?? "#cccccc";
  const [dividerOrientation, setDividerOrientation] =
    useState<DividerOrientation>(initialDividerOrientation);
  const [dividerWeight, setDividerWeight] = useState(initialDividerWeight);
  const [dividerColor, setDividerColor] = useState(initialDividerColor);
  const [isDividerSaving, setIsDividerSaving] = useState(false);
  const [dividerSaveError, setDividerSaveError] = useState<string | null>(null);
  const dividerDirty =
    dividerOrientation !== initialDividerOrientation ||
    dividerWeight !== initialDividerWeight ||
    dividerColor !== initialDividerColor;

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

  const isAnyDirtyRef = useRef(isDirty || dataDirty || contentDirty || imageDirty || dividerDirty);
  isAnyDirtyRef.current = isDirty || dataDirty || contentDirty || imageDirty || dividerDirty;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function attemptClose() {
      // View mode is always clean — close immediately with no warning
      if (modalModeRef.current === "view") {
        dialog!.close();
        onCloseRef.current();
        return;
      }
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
    // View mode is always clean — close immediately with no warning
    if (modalMode === "view") {
      dialogRef.current?.close();
      onCloseRef.current();
      return;
    }
    if (isDirty || dataDirty || contentDirty || imageDirty || dividerDirty) {
      setShowDiscardWarning(true);
    } else {
      dialogRef.current?.close();
      onCloseRef.current();
    }
  }

  async function handleContentSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsContentSaving(true);
    setContentSaveError(null);
    try {
      await dispatch(updatePanelContent({ panelId: panel.id, content: markdownContent })).unwrap();
      dialogRef.current?.close();
      onCloseRef.current();
    } catch {
      setContentSaveError("Failed to save content.");
    } finally {
      setIsContentSaving(false);
    }
  }

  async function handleImageSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsImageSaving(true);
    setImageSaveError(null);
    try {
      await dispatch(updatePanelImage({ panelId: panel.id, imageUrl, imageFit })).unwrap();
      dialogRef.current?.close();
      onCloseRef.current();
    } catch {
      setImageSaveError("Failed to save image settings.");
    } finally {
      setIsImageSaving(false);
    }
  }

  async function handleDividerSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsDividerSaving(true);
    setDividerSaveError(null);
    try {
      // When the stored color is null and the picker is still at the initial
      // fallback (#cccccc), preserve null so the CSS design-token default is
      // kept in the DB rather than being silently overwritten on a no-op Save.
      const resolvedColor =
        panel.dividerColor === null && dividerColor === "#cccccc" ? null : dividerColor;
      await dispatch(
        updatePanelDivider({
          panelId: panel.id,
          dividerOrientation,
          dividerWeight,
          dividerColor: resolvedColor,
        }),
      ).unwrap();
      dialogRef.current?.close();
      onCloseRef.current();
    } catch {
      setDividerSaveError("Failed to save divider settings.");
    } finally {
      setIsDividerSaving(false);
    }
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    if (tab === "data" && dataTypesStatus === "idle") {
      void dispatch(fetchDataTypes());
    }
  }

  function handleAppearanceSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const appearancePayload: PanelAppearance = {
      background,
      color,
      transparency: clampTransparency(transparency / 100),
      ...(panel.type === "chart" ? { chart: chartAppearance } : {}),
    };
    dispatch(
      accumulatePanelUpdate({
        panelId: panel.id,
        fields: { appearance: appearancePayload },
      }),
    );
    dialogRef.current?.close();
    onCloseRef.current();
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
    <dialog ref={dialogRef} className={`panel-detail-modal${modalMode === "view" ? " panel-detail-modal--view" : ""}`} aria-label={`${panel.title} settings`}>
      <div className="panel-detail-modal__inner">
        <header className="panel-detail-modal__header">
          <span className="panel-detail-modal__title">{panel.title}</span>
          <div className="panel-detail-modal__header-actions">
            {modalMode === "view" && (
              <button
                type="button"
                className="panel-detail-modal__edit-btn"
                aria-label="Edit panel"
                onClick={() => setModalMode("edit")}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="panel-detail-modal__close"
              aria-label="Close panel settings"
              onClick={handleCancel}
            >
              ✕
            </button>
          </div>
        </header>

        {modalMode === "view" ? (
          <div className="panel-detail-modal__view-body">
            <PanelContent
              type={panel.type}
              data={data}
              rawRows={rawRows}
              headers={headers}
              fieldMapping={panel.fieldMapping}
              isLoading={isLoading}
              error={error}
              noData={noData}
              content={panel.content}
              imageUrl={panel.imageUrl}
              imageFit={panel.imageFit}
              dividerOrientation={panel.dividerOrientation}
              dividerWeight={panel.dividerWeight}
              dividerColor={panel.dividerColor}
            />
          </div>
        ) : (
          <>
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
              {panel.type === "markdown" ? (
                <button
                  type="button"
                  role="tab"
                  className="panel-detail-modal__tab"
                  aria-selected={activeTab === "content"}
                  onClick={() => setActiveTab("content")}
                >
                  Content
                </button>
              ) : panel.type === "image" ? (
                <button
                  type="button"
                  role="tab"
                  className="panel-detail-modal__tab"
                  aria-selected={activeTab === "image"}
                  onClick={() => setActiveTab("image")}
                >
                  Image
                </button>
              ) : panel.type === "divider" ? (
                <button
                  type="button"
                  role="tab"
                  className="panel-detail-modal__tab"
                  aria-selected={activeTab === "divider"}
                  onClick={() => setActiveTab("divider")}
                >
                  Divider
                </button>
              ) : (
                <button
                  type="button"
                  role="tab"
                  className="panel-detail-modal__tab"
                  aria-selected={activeTab === "data"}
                  onClick={() => handleTabChange("data")}
                >
                  Data
                </button>
              )}
            </div>

            {activeTab === "image" ? (
              <form
                id="panel-detail-image-form"
                className="panel-detail-modal__content"
                onSubmit={handleImageSubmit}
              >
                <div className="panel-detail-modal__data-section">
                  <label className="panel-detail-modal__data-label" htmlFor="image-url">
                    Image URL
                  </label>
                  <input
                    id="image-url"
                    type="text"
                    className="panel-detail-modal__type-search"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    aria-label="Image URL"
                    placeholder="https://example.com/image.png"
                  />
                </div>
                <div className="panel-detail-modal__data-section">
                  <label className="panel-detail-modal__data-label" htmlFor="image-fit">
                    Image fit
                  </label>
                  <select
                    id="image-fit"
                    className="panel-detail-modal__mapping-select"
                    value={imageFit}
                    onChange={(e) => setImageFit(e.target.value as ImageFit)}
                    aria-label="Image fit"
                  >
                    <option value="contain">Contain</option>
                    <option value="cover">Cover</option>
                    <option value="fill">Fill</option>
                  </select>
                </div>
                <InlineError error={imageSaveError} />
              </form>
            ) : activeTab === "content" ? (
              <form
                id="panel-detail-content-form"
                className="panel-detail-modal__content"
                onSubmit={handleContentSubmit}
              >
                <div className="panel-detail-modal__data-section">
                  <label className="panel-detail-modal__data-label" htmlFor="markdown-content">
                    Markdown content
                  </label>
                  <textarea
                    id="markdown-content"
                    className="panel-detail-modal__markdown-textarea"
                    value={markdownContent}
                    onChange={(e) => setMarkdownContent(e.target.value)}
                    aria-label="Markdown content"
                    placeholder="# Hello&#10;Write your markdown here…"
                    rows={12}
                  />
                </div>
                <InlineError error={contentSaveError} />
              </form>
            ) : activeTab === "divider" ? (
              <form
                id="panel-detail-divider-form"
                className="panel-detail-modal__content"
                onSubmit={handleDividerSubmit}
              >
                <div className="panel-detail-modal__data-section">
                  <label className="panel-detail-modal__data-label" htmlFor="divider-orientation">
                    Orientation
                  </label>
                  <select
                    id="divider-orientation"
                    className="panel-detail-modal__mapping-select"
                    value={dividerOrientation}
                    onChange={(e) => setDividerOrientation(e.target.value as DividerOrientation)}
                    aria-label="Divider orientation"
                  >
                    <option value="horizontal">Horizontal</option>
                    <option value="vertical">Vertical</option>
                  </select>
                </div>
                <div className="panel-detail-modal__data-section">
                  <label className="panel-detail-modal__data-label" htmlFor="divider-weight">
                    Weight (px)
                  </label>
                  <input
                    id="divider-weight"
                    type="number"
                    min="1"
                    max="100"
                    className="panel-detail-modal__type-search"
                    value={dividerWeight}
                    onChange={(e) => setDividerWeight(Math.max(1, Number(e.target.value)))}
                    aria-label="Divider weight"
                  />
                </div>
                <div className="panel-detail-modal__data-section">
                  <label className="panel-detail-modal__data-label" htmlFor="divider-color">
                    Color
                  </label>
                  <input
                    id="divider-color"
                    type="color"
                    value={dividerColor}
                    onChange={(e) => setDividerColor(e.target.value)}
                    aria-label="Divider color"
                  />
                </div>
                <InlineError error={dividerSaveError} />
              </form>
            ) : activeTab === "appearance" ? (
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

                    <div className="panel-detail-modal__chart-type-section">
                      <span className="panel-detail-modal__chart-type-label">Chart type</span>
                      <div className="panel-detail-modal__chart-type-selector">
                        {(
                          [
                            { type: "bar", icon: "▊", label: "Bar" },
                            { type: "line", icon: "∿", label: "Line" },
                            { type: "pie", icon: "◑", label: "Pie" },
                            { type: "scatter", icon: "⁖", label: "Scatter" },
                          ] as const
                        ).map(({ type, icon, label }) => (
                          <label
                            key={type}
                            className={[
                              "panel-detail-modal__chart-type-option",
                              chartAppearance.chartType === type
                                ? "panel-detail-modal__chart-type-option--active"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <input
                              type="radio"
                              name="chartType"
                              value={type}
                              checked={chartAppearance.chartType === type}
                              onChange={() =>
                                setChartAppearance((prev) => ({ ...prev, chartType: type }))
                              }
                              aria-label={`Chart type ${type}`}
                              className="panel-detail-modal__chart-type-radio"
                            />
                            <span className="panel-detail-modal__chart-type-icon">{icon}</span>
                            <span className="panel-detail-modal__chart-type-name">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
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
                              <span className="panel-detail-modal__selected-type-name">
                                {dt.name}
                              </span>
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
                >
                  Save
                </button>
              ) : activeTab === "content" ? (
                <button
                  type="submit"
                  form="panel-detail-content-form"
                  className="panel-detail-modal__btn panel-detail-modal__btn--save"
                  aria-label="Save markdown content"
                  disabled={isContentSaving}
                >
                  {isContentSaving ? "Saving..." : "Save"}
                </button>
              ) : activeTab === "image" ? (
                <button
                  type="submit"
                  form="panel-detail-image-form"
                  className="panel-detail-modal__btn panel-detail-modal__btn--save"
                  aria-label="Save image settings"
                  disabled={isImageSaving}
                >
                  {isImageSaving ? "Saving..." : "Save"}
                </button>
              ) : activeTab === "divider" ? (
                <button
                  type="submit"
                  form="panel-detail-divider-form"
                  className="panel-detail-modal__btn panel-detail-modal__btn--save"
                  aria-label="Save divider settings"
                  disabled={isDividerSaving}
                >
                  {isDividerSaving ? "Saving..." : "Save"}
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
          </>
        )}
      </div>
    </dialog>
  );
}
