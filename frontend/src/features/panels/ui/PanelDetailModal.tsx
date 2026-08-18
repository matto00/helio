import type { FormEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./PanelDetailModal.css";
import "./PanelDetailModal.binding.css";
import "./PanelDetailModal.sections.css";
import "./PanelDetailModal.appearance.css";
import "./PanelDetailModal.mobile.css";
import { Modal } from "../../../shared/ui/Modal";
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
  isTimelinePanel,
} from "../state/panelNarrowing";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { usePanelData } from "../hooks/usePanelData";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  clampTransparency,
  defaultChartAppearance,
  getColorInputValue,
  getPanelAppearanceEditorFallback,
  getPanelTextEditorFallback,
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
import { TimelineEditor } from "./editors/TimelineEditor";
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
  /** F-123 — lets a caller (e.g. the panel card's "Customize" action) open the
   *  modal straight into the settings form instead of the read-only view a
   *  plain card click lands on. Defaults to "view" (unchanged behavior). */
  initialMode?: "view" | "edit";
}

export function PanelDetailModal({ panel, onClose, initialMode = "view" }: PanelDetailModalProps) {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const { data, rawRows, headers, isLoading, error, noData, chartAggregate } = usePanelData(panel);

  // Modal mode: "view" is the default on open; "edit" shows the unified settings form
  const [modalMode, setModalMode] = useState<"view" | "edit">(initialMode);

  // ── Appearance state (common to every subtype) ──────────────────────────
  // Background / color hold the RAW appearance value — which may be a sentinel
  // (`"transparent"` / `"inherit"`), not the display-fallback hex. They are only
  // resolved to a color-input-safe hex at the `<AppearanceEditor>` prop boundary.
  // The native `<input type="color">` onChange always emits a 6-digit hex, so an
  // untouched field keeps its raw sentinel while an edited field is overwritten
  // with the chosen hex — and the save payload is built from state directly. This
  // preserves an untouched sentinel through save (HEL-322).
  const initialTitle = panel.title;
  const initialBackground = panel.appearance.background;
  const initialColor = panel.appearance.color;
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
  const timelineEditorRef = useRef<PanelEditorHandle | null>(null);

  function activeEditorRef(): RefObject<PanelEditorHandle | null> | null {
    if (isMetricPanel(panel) || isChartPanel(panel) || isTablePanel(panel)) {
      return bindingEditorRef;
    }
    if (isMarkdownPanel(panel)) return markdownEditorRef;
    if (isTextPanel(panel)) return textEditorRef;
    if (isImagePanel(panel)) return imageEditorRef;
    if (isDividerPanel(panel)) return dividerEditorRef;
    if (isCollectionPanel(panel)) return collectionEditorRef;
    if (isTimelinePanel(panel)) return timelineEditorRef;
    return null;
  }

  // ── Unified saving / dirty state ─────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [subtypeDirty, setSubtypeDirty] = useState(false);
  const handleSubtypeDirtyChange = useCallback((d: boolean) => {
    setSubtypeDirty(d);
  }, []);

  const [showDiscardWarning, setShowDiscardWarning] = useState(false);

  const appearanceDirty =
    title !== initialTitle ||
    background !== initialBackground ||
    color !== initialColor ||
    transparency !== initialTransparency ||
    (panel.type === "chart" && JSON.stringify(chartAppearance) !== JSON.stringify(initialChart));

  const isAnyDirty = appearanceDirty || subtypeDirty;

  const resetFormToPanel = useCallback(() => {
    setTitle(panel.title);
    setBackground(panel.appearance.background);
    setColor(panel.appearance.color);
    setTransparency(Math.round(clampTransparency(panel.appearance.transparency) * 100));
    setChartAppearance(buildInitialChart(panel));
    activeEditorRef()?.current?.reset();
    // activeEditorRef is recomputed inside the effect; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // F-303/HEL-716 — the E-key edit-mode shortcut is unrelated to close
  // semantics, so it's a plain document-scoped listener gated on the
  // component's mounted lifetime (equivalent to the old dialog-scoped
  // listener, since focus is always trapped inside the open dialog).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (modalMode !== "view") return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "e" || e.key === "E") {
        setModalMode("edit");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalMode]);

  function handleDiscard() {
    resetFormToPanel();
    setShowDiscardWarning(false);
    setModalMode("view");
  }

  // HEL-716 — the single "close requested" handler for every dismiss vector
  // Modal funnels through onClose (header close button, backdrop click,
  // Escape) as well as the footer's own Cancel button: view mode closes the
  // modal; edit mode with unsaved changes shows the discard-confirm banner
  // (confirming it always returns to view mode — see openspec design.md
  // Decision 5); edit mode with no changes reverts to view directly.
  function attemptClose() {
    if (modalMode === "view") {
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
    if (isTimelinePanel(panel)) {
      return (
        <TimelineEditor
          ref={timelineEditorRef}
          panel={panel}
          onDirtyChange={handleSubtypeDirtyChange}
        />
      );
    }
    return null;
  }

  return (
    <Modal
      open
      size={modalMode === "view" ? "full" : "md"}
      title={panel.title}
      ariaLabel={`${panel.title} settings`}
      className={`panel-detail-modal${modalMode === "view" ? " panel-detail-modal--view" : ""}`}
      onClose={attemptClose}
      headerActions={
        <>
          {modalMode === "edit" && isAnyDirty && (
            <span className="panel-detail-modal__unsaved-badge">Unsaved changes</span>
          )}
          {modalMode === "view" && (
            <button
              type="button"
              className="panel-detail-modal__edit-btn"
              aria-label="Edit panel"
              title="Edit (E)"
              onClick={() => setModalMode("edit")}
            >
              Edit
            </button>
          )}
        </>
      }
      footer={
        modalMode === "edit" ? (
          <>
            <button
              type="button"
              className="panel-detail-modal__btn panel-detail-modal__btn--cancel"
              onClick={attemptClose}
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
          </>
        ) : undefined
      }
    >
      <div className="panel-detail-modal__inner">
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
                theme={theme}
                title={title}
                setTitle={setTitle}
                background={getColorInputValue(background, getPanelAppearanceEditorFallback(theme))}
                setBackground={setBackground}
                color={getColorInputValue(color, getPanelTextEditorFallback(theme))}
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
          </>
        )}
      </div>
    </Modal>
  );
}
