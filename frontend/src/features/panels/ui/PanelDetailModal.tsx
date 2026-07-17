import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import type { FormEvent, RefObject } from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import "./PanelDetailModal.css";
import { accumulatePanelUpdate } from "../state/panelsSlice";
import {
  isChartPanel,
  isCollectionPanel,
  isDividerPanel,
  isImagePanel,
  isMarkdownPanel,
  isTablePanel,
  isMetricPanel,
  isTextPanel,
} from "../state/panelNarrowing";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelDetailModalLifecycle } from "../hooks/usePanelDetailModalLifecycle";
import {
  clampTransparency,
  defaultChartAppearance,
  getColorInputValue,
  panelAppearanceEditorFallback,
  panelTextEditorFallback,
} from "../../../theme/appearance";
import type { ChartAppearance, Panel, PanelAppearance } from "../types/panel";
import { PanelContent } from "./PanelContent";
import { AppearanceEditor } from "./editors/AppearanceEditor";
import { BindingEditor } from "./editors/BindingEditor";
import { CollectionEditor } from "./editors/CollectionEditor";
import { DividerEditor } from "./editors/DividerEditor";
import { ImageEditor } from "./editors/ImageEditor";
import { MarkdownEditor } from "./editors/MarkdownEditor";
import { TextContentEditor } from "./editors/TextContentEditor";
import type { PanelEditorHandle } from "./editors/editorTypes";

function padSeriesColors(colors: string[]): string[] {
  const defaults = defaultChartAppearance.seriesColors;
  const padded = [...colors];
  while (padded.length < 8) {
    padded.push(defaults[padded.length]);
  }
  return padded.slice(0, 8);
}

function buildInitialChart(panel: Panel): ChartAppearance {
  return {
    ...defaultChartAppearance,
    ...(panel.appearance.chart ?? {}),
    seriesColors: padSeriesColors(panel.appearance.chart?.seriesColors ?? []),
    legend: panel.appearance.chart?.legend ?? defaultChartAppearance.legend,
    tooltip: panel.appearance.chart?.tooltip ?? defaultChartAppearance.tooltip,
    axisLabels: panel.appearance.chart?.axisLabels ?? defaultChartAppearance.axisLabels,
    chartType: panel.appearance.chart?.chartType ?? "line",
  };
}

interface PanelDetailModalProps {
  panel: Panel;
  onClose: () => void;
}

export function PanelDetailModal({ panel, onClose }: PanelDetailModalProps) {
  const dispatch = useAppDispatch();
  const { data, rawRows, headers, isLoading, error, noData, chartAggregate } = usePanelData(panel);

  // Modal mode: "view" is the default on open; "edit" shows the unified settings form
  const [modalMode, setModalMode] = useState<"view" | "edit">("view");

  // ── Appearance state (common to every subtype) ──────────────────────────
  const initialTitle = panel.title;
  const initialBackground = getColorInputValue(
    panel.appearance.background,
    panelAppearanceEditorFallback,
  );
  const initialColor = getColorInputValue(panel.appearance.color, panelTextEditorFallback);
  const initialTransparency = Math.round(clampTransparency(panel.appearance.transparency) * 100);
  const initialChart = useMemo(() => buildInitialChart(panel), [panel]);

  const [title, setTitle] = useState(initialTitle);
  const [background, setBackground] = useState(initialBackground);
  const [color, setColor] = useState(initialColor);
  const [transparency, setTransparency] = useState(initialTransparency);
  const [chartAppearance, setChartAppearance] = useState<ChartAppearance>(initialChart);

  // ── Subtype editor refs (only one is mounted at a time per `panel.type`) ─
  const bindingEditorRef = useRef<PanelEditorHandle | null>(null);
  const markdownEditorRef = useRef<PanelEditorHandle | null>(null);
  const textEditorRef = useRef<PanelEditorHandle | null>(null);
  const imageEditorRef = useRef<PanelEditorHandle | null>(null);
  const dividerEditorRef = useRef<PanelEditorHandle | null>(null);
  const collectionEditorRef = useRef<PanelEditorHandle | null>(null);

  function activeEditorRef(): RefObject<PanelEditorHandle | null> | null {
    if (isMetricPanel(panel) || isChartPanel(panel) || isTablePanel(panel)) {
      return bindingEditorRef;
    }
    if (isMarkdownPanel(panel)) return markdownEditorRef;
    if (isTextPanel(panel)) return textEditorRef;
    if (isImagePanel(panel)) return imageEditorRef;
    if (isDividerPanel(panel)) return dividerEditorRef;
    if (isCollectionPanel(panel)) return collectionEditorRef;
    return null;
  }

  // ── Unified saving / dirty state ─────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [subtypeDirty, setSubtypeDirty] = useState(false);
  const handleSubtypeDirtyChange = useCallback((d: boolean) => {
    setSubtypeDirty(d);
  }, []);

  const [showDiscardWarning, setShowDiscardWarning] = useState(false);
  const [discardClosesModal, setDiscardClosesModal] = useState(false);

  const appearanceDirty =
    title !== initialTitle ||
    background !== initialBackground ||
    color !== initialColor ||
    transparency !== initialTransparency ||
    (panel.type === "chart" && JSON.stringify(chartAppearance) !== JSON.stringify(initialChart));

  const isAnyDirty = appearanceDirty || subtypeDirty;

  const resetFormToPanel = useCallback(() => {
    setTitle(panel.title);
    setBackground(getColorInputValue(panel.appearance.background, panelAppearanceEditorFallback));
    setColor(getColorInputValue(panel.appearance.color, panelTextEditorFallback));
    setTransparency(Math.round(clampTransparency(panel.appearance.transparency) * 100));
    setChartAppearance(buildInitialChart(panel));
    activeEditorRef()?.current?.reset();
    // activeEditorRef is recomputed inside the effect; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  const { dialogRef } = usePanelDetailModalLifecycle({
    modalMode,
    isAnyDirty,
    setShowDiscardWarning,
    setModalMode,
    onClose,
    resetFormToPanel,
  });

  function handleDiscard() {
    resetFormToPanel();
    setShowDiscardWarning(false);
    if (discardClosesModal) {
      setDiscardClosesModal(false);
      dialogRef.current?.close();
      onClose();
    } else {
      setModalMode("view");
    }
  }

  function handleCloseButton() {
    if (modalMode === "view") {
      dialogRef.current?.close();
      onClose();
      return;
    }
    if (isAnyDirty) {
      setDiscardClosesModal(true);
      setShowDiscardWarning(true);
    } else {
      dialogRef.current?.close();
      onClose();
    }
  }

  function handleCancel() {
    if (modalMode === "view") {
      dialogRef.current?.close();
      onClose();
      return;
    }
    if (isAnyDirty) {
      setShowDiscardWarning(true);
    } else {
      resetFormToPanel();
      setModalMode("view");
    }
  }

  async function handleEditSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSaving(true);

    try {
      // 1. Dispatch appearance (and title if changed) — synchronous accumulation
      const appearancePayload: PanelAppearance = {
        background,
        color,
        transparency: clampTransparency(transparency / 100),
        ...(panel.type === "chart" ? { chart: chartAppearance } : {}),
      };
      dispatch(
        accumulatePanelUpdate({
          panelId: panel.id,
          fields: {
            appearance: appearancePayload,
            ...(title !== initialTitle ? { title } : {}),
          },
        }),
      );

      // 2. Dispatch subtype-specific section via the active editor's ref
      const ref = activeEditorRef();
      if (ref?.current && subtypeDirty) {
        const result = await ref.current.save();
        if (!result.ok) {
          // Error surfaced inside the editor via InlineError — leave modal in edit mode
          return;
        }
      }

      setModalMode("view");
    } finally {
      setIsSaving(false);
    }
  }

  function renderSubtypeEditor() {
    if (isMetricPanel(panel) || isChartPanel(panel) || isTablePanel(panel)) {
      return (
        <BindingEditor
          ref={bindingEditorRef}
          panel={panel}
          initialRefreshInterval={panel.refreshInterval ?? null}
          chartType={chartAppearance.chartType}
          onDirtyChange={handleSubtypeDirtyChange}
        />
      );
    }
    if (isMarkdownPanel(panel)) {
      return (
        <MarkdownEditor
          ref={markdownEditorRef}
          panel={panel}
          onDirtyChange={handleSubtypeDirtyChange}
        />
      );
    }
    if (isTextPanel(panel)) {
      return (
        <TextContentEditor
          ref={textEditorRef}
          panel={panel}
          onDirtyChange={handleSubtypeDirtyChange}
        />
      );
    }
    if (isImagePanel(panel)) {
      return (
        <ImageEditor ref={imageEditorRef} panel={panel} onDirtyChange={handleSubtypeDirtyChange} />
      );
    }
    if (isDividerPanel(panel)) {
      return (
        <DividerEditor
          ref={dividerEditorRef}
          panel={panel}
          onDirtyChange={handleSubtypeDirtyChange}
        />
      );
    }
    if (isCollectionPanel(panel)) {
      return (
        <CollectionEditor
          ref={collectionEditorRef}
          panel={panel}
          onDirtyChange={handleSubtypeDirtyChange}
        />
      );
    }
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      className={`panel-detail-modal${modalMode === "view" ? " panel-detail-modal--view" : ""}`}
      aria-label={`${panel.title} settings`}
    >
      <div className="panel-detail-modal__inner">
        <header className="panel-detail-modal__header">
          <span className="panel-detail-modal__title">{panel.title}</span>
          {modalMode === "edit" && isAnyDirty && (
            <span className="panel-detail-modal__unsaved-badge">Unsaved changes</span>
          )}
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
              onClick={handleCloseButton}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </header>

        {modalMode === "view" ? (
          <div className="panel-detail-modal__view-body">
            <PanelContent
              panel={panel}
              data={data}
              rawRows={rawRows}
              headers={headers}
              isLoading={isLoading}
              error={error}
              noData={noData}
              chartAggregate={chartAggregate}
            />
          </div>
        ) : (
          <>
            <form
              id="panel-detail-edit-form"
              className="panel-detail-modal__content"
              onSubmit={handleEditSubmit}
            >
              <AppearanceEditor
                panelTitle={panel.title}
                title={title}
                setTitle={setTitle}
                background={background}
                setBackground={setBackground}
                color={color}
                setColor={setColor}
                transparency={transparency}
                setTransparency={setTransparency}
                showChartSection={panel.type === "chart"}
                chartAppearance={chartAppearance}
                setChartAppearance={setChartAppearance}
              />
              {renderSubtypeEditor()}
            </form>

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
              <button
                type="submit"
                form="panel-detail-edit-form"
                className="panel-detail-modal__btn panel-detail-modal__btn--save"
                aria-label="Save panel settings"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
