import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import "./PanelDetailModal.css";
import "./PanelDetailModal.binding.css";
import "./PanelDetailModal.sections.css";
import "./PanelDetailModal.appearance.css";
import "./PanelDetailModal.mobile.css";
import { Modal } from "../../../../shared/ui/Modal";
import { accumulatePanelUpdate } from "../../state/panelsSlice";
import { isOutputPanel } from "../../state/panelNarrowing";
import { useAppDispatch } from "../../../../hooks/reduxHooks";
import { ProvenanceTrigger } from "../../provenance/ProvenanceTrigger";
import { OutputViewerControlBar } from "../OutputViewerControlBar";
import { useTheme } from "../../../../theme/ThemeProvider";
import {
  clampTransparency,
  getColorInputValue,
  getPanelAppearanceEditorFallback,
  getPanelTextEditorFallback,
} from "../../../../theme/appearance";
import type { Panel, PanelAppearance } from "../../types/panel";
import { PanelContent } from "../PanelContent";
import { AppearanceEditor } from "../editors/AppearanceEditor";
import { OutputControlsEditor } from "../editors/OutputControlsEditor";
import { OutputPanelSection } from "./OutputPanelSection";
import { renderSubtypeEditor } from "./renderSubtypeEditor";
import { usePanelDetailData } from "./usePanelDetailData";
import { usePanelDetailEditState } from "./usePanelDetailEditState";

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
    controls,
    controlValues,
    setControlValue,
    clearControlValue,
    controlFilterOps,
    hasVisibleControls,
    fetchDistinctValues,
    viewOutputId,
    viewOutput,
    crossFilterMode,
    data,
    rawRows,
    headers,
    isLoading,
    error,
    errorKind,
    noData,
    neverMaterialized,
    paginationRows,
    rowsTruncated,
    refresh,
    totalRowCount,
  } = usePanelDetailData(panel);
  const navigate = useNavigate();
  const {
    modalMode,
    setModalMode,
    initialTitle,
    title,
    setTitle,
    background,
    setBackground,
    color,
    setColor,
    transparency,
    setTransparency,
    chartAppearance,
    setChartAppearance,
    markdownEditorRef,
    textEditorRef,
    imageEditorRef,
    dividerEditorRef,
    formEditorRef,
    controlsEditorRef,
    activeEditorRef,
    isSaving,
    setIsSaving,
    subtypeDirty,
    handleSubtypeDirtyChange,
    showDiscardWarning,
    setShowDiscardWarning,
    isAnyDirty,
    resetFormToPanel,
  } = usePanelDetailEditState(panel, initialMode);

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
          {modalMode === "view" && viewOutputId && (
            <ProvenanceTrigger
              panelId={panel.id}
              panelTitle={panel.title}
              outputId={viewOutputId}
              variant="authenticated"
            />
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
            {hasVisibleControls && (
              <OutputViewerControlBar
                controls={controls}
                values={controlValues}
                onChange={setControlValue}
                onClear={clearControlValue}
                fetchDistinctValues={fetchDistinctValues}
              />
            )}
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
              paginationRows={paginationRows}
              // HEL-451 design D4/task 4.0: the detail modal has NO
              // pagination props (`rawRows`/`headers` only), so this is the
              // surface where `usingPagination && paginationHasMore` was
              // always false regardless of real truncation — see
              // `usePanelData`'s `rowsTruncated` doc comment.
              rowsTruncated={rowsTruncated}
              totalRowCount={totalRowCount}
              crossFilterMode={crossFilterMode}
              viewerFilterActive={controlFilterOps.length > 0}
            />
            {/* HEL-1190 design.md D10 (task 5.5) — this modal had NO live region at all before this
                ticket; a control-driven row-count change is announced here, mirroring
                `PanelCardBody.tsx`'s own region (reused there; added fresh here since none existed). */}
            {hasVisibleControls && (
              <div className="sr-only" role="status">
                {`${rawRows?.length ?? 0} result${(rawRows?.length ?? 0) === 1 ? "" : "s"}.`}
              </div>
            )}
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
              {isOutputPanel(panel) ? (
                <>
                  <OutputPanelSection panel={panel} />
                  <OutputControlsEditor
                    ref={controlsEditorRef}
                    panel={panel}
                    onDirtyChange={handleSubtypeDirtyChange}
                  />
                </>
              ) : (
                renderSubtypeEditor({
                  panel,
                  markdownEditorRef,
                  textEditorRef,
                  imageEditorRef,
                  dividerEditorRef,
                  formEditorRef,
                  handleSubtypeDirtyChange,
                })
              )}
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
