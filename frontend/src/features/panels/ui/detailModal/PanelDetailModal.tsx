import type { FormEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import "./PanelDetailModal.css";
import "./PanelDetailModal.binding.css";
import "./PanelDetailModal.sections.css";
import "./PanelDetailModal.appearance.css";
import "./PanelDetailModal.mobile.css";
import { Modal } from "../../../../shared/ui/Modal";
import { accumulatePanelUpdate } from "../../state/panelsSlice";
import {
  isDividerPanel,
  isImagePanel,
  isMarkdownPanel,
  isOutputPanel,
  isTextPanel,
} from "../../state/panelNarrowing";
import { useAppDispatch } from "../../../../hooks/reduxHooks";
import { usePanelData } from "../../hooks/usePanelData";
import { useOutputMeta } from "../../hooks/useOutputMeta";
import { listOutputPanels } from "../../../pipelines/services/outputService";
import { OutputPicker } from "../OutputPicker";
import { useTheme } from "../../../../theme/ThemeProvider";
import {
  clampTransparency,
  defaultChartAppearance,
  getColorInputValue,
  getPanelAppearanceEditorFallback,
  getPanelTextEditorFallback,
} from "../../../../theme/appearance";
import type { ChartAppearance, Panel, PanelAppearance } from "../../types/panel";
import { PanelContent } from "../PanelContent";
import { AppearanceEditor } from "../editors/AppearanceEditor";
import { DividerEditor } from "../editors/DividerEditor";
import { ImageEditor } from "../editors/ImageEditor";
import { MarkdownEditor } from "../editors/MarkdownEditor";
import { TextContentEditor } from "../editors/TextContentEditor";
import type { PanelEditorHandle } from "../editors/editorTypes";

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

/** HEL-909 — the placements/Output-link/Swap-output section of the Panel
 *  sheet for an output-kind panel. Fetches the Output's own metadata (for
 *  the pipeline link) and its placement count separately from
 *  `usePanelData` (which only fetches rows). */
function OutputPanelSection({ panel }: { panel: Panel }) {
  const outputId = isOutputPanel(panel) ? panel.config.outputId : "";
  const { output } = useOutputMeta(outputId);
  const [placementCount, setPlacementCount] = useState<number | null>(null);
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listOutputPanels(outputId)
      .then((placements) => {
        // "Used on N dashboards" counts distinct dashboards, not panel
        // placements -- two panels on the same dashboard bound to this
        // Output must read "Used on 1 dashboards", not 2 (HEL-909
        // non-blocking suggestion).
        const dashboardCount = new Set(placements.map((p) => p.dashboardId)).size;
        if (!cancelled) setPlacementCount(dashboardCount);
      })
      .catch(() => {
        if (!cancelled) setPlacementCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [outputId]);

  return (
    <div className="panel-detail-modal__data-section">
      <h3 className="panel-detail-modal__edit-section-heading">Output</h3>
      {output ? (
        <Link
          to={`/pipelines/${output.pipelineId}?outputId=${output.id}`}
          className="panel-detail-modal__output-link"
        >
          {output.name}
        </Link>
      ) : (
        <span className="panel-detail-modal__output-link-loading">Loading…</span>
      )}
      <button
        type="button"
        className="panel-detail-modal__swap-output-btn"
        onClick={() => setSwapPickerOpen(true)}
      >
        Swap output
      </button>
      <p className="panel-detail-modal__placements-note">
        {placementCount === null
          ? "Used on — dashboards"
          : `Used on ${placementCount} dashboard${placementCount === 1 ? "" : "s"}`}
      </p>
      {swapPickerOpen ? (
        <OutputPicker
          dashboardId={panel.dashboardId}
          currentDashboardPanels={[]}
          mode="swap"
          swapPanelId={panel.id}
          onClose={() => setSwapPickerOpen(false)}
        />
      ) : null}
    </div>
  );
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
  const {
    data,
    rawRows,
    headers,
    isLoading,
    error,
    errorKind,
    noData,
    neverMaterialized,
    chartAggregate,
    refresh,
  } = usePanelData(panel);
  // HEL-946 Bug C(2) — the never-materialized empty state's "Run pipeline"
  // link needs the bound Output's pipelineId, which the panel itself
  // doesn't carry (only `config.outputId`) — same lookup `OutputPanelSection`
  // below already makes for its own "Output" link.
  const viewOutputId = isOutputPanel(panel) ? panel.config.outputId : null;
  const { output: viewOutput } = useOutputMeta(viewOutputId);
  const navigate = useNavigate();

  // Modal mode: "view" is the default on open; "edit" shows the unified settings form
  const [modalMode, setModalMode] = useState<"view" | "edit">(initialMode);

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

  // ── Subtype editor refs (only one is mounted at a time, content-kind panels
  //    only — an output-kind panel has no subtype editor, see
  //    `OutputPanelSection` above) ─
  const markdownEditorRef = useRef<PanelEditorHandle | null>(null);
  const textEditorRef = useRef<PanelEditorHandle | null>(null);
  const imageEditorRef = useRef<PanelEditorHandle | null>(null);
  const dividerEditorRef = useRef<PanelEditorHandle | null>(null);

  function activeEditorRef(): RefObject<PanelEditorHandle | null> | null {
    if (isMarkdownPanel(panel)) return markdownEditorRef;
    if (isTextPanel(panel)) return textEditorRef;
    if (isImagePanel(panel)) return imageEditorRef;
    if (isDividerPanel(panel)) return dividerEditorRef;
    return null;
  }

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
    transparency !== initialTransparency;

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
      //    (content-kind panels only — output-kind panels have none).
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
    // Output-kind panels: no subtype editor — see OutputPanelSection instead.
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
              errorKind={errorKind}
              onRetry={refresh}
              retryVariant="button"
              noData={noData}
              neverMaterialized={neverMaterialized}
              onGoToPipeline={
                viewOutput ? () => navigate(`/pipelines/${viewOutput.pipelineId}`) : undefined
              }
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
                showChartSection={false}
                chartAppearance={chartAppearance}
                setChartAppearance={setChartAppearance}
              />
              {isOutputPanel(panel) ? <OutputPanelSection panel={panel} /> : renderSubtypeEditor()}
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
