import React, { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical } from "@fortawesome/free-solid-svg-icons";

import { buildPanelSurface, resolvePanelTextColor } from "../../../theme/appearance";
import { getOutputId } from "../state/panelNarrowing";
import { deletePanel, duplicatePanel, fetchPanelPage } from "../state/panelsSlice";
import { getAssertionStatus } from "../../pipelines/services/outputService";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { ActionsMenu } from "../../../shared/chrome/ActionsMenu";
import { InlineError } from "../../../shared/chrome/InlineError";
import { IconButton } from "../../../shared/ui/IconButton";
import { TextField } from "../../../shared/ui/TextField";
import { PanelContent } from "./PanelContent";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import type { Panel } from "../types/panel";

// Exported for reuse by `MobilePanelStack` (HEL-301), which builds its own
// read-only card markup rather than reusing this file's drag/edit-oriented
// `PanelCard` wrapper — the appearance-to-style mapping is the one piece
// worth sharing so custom panel backgrounds/colors stay consistent between
// the desktop grid and the phone stack.
export function getPanelCardStyle(
  appearance: Panel["appearance"],
  theme: "dark" | "light",
): CSSProperties {
  const style = {} as CSSProperties & Record<string, string>;
  style["--panel-surface-override"] = buildPanelSurface(
    theme,
    appearance.background,
    appearance.transparency,
  );
  style["--panel-text-override"] = resolvePanelTextColor(
    theme,
    appearance.background,
    appearance.transparency,
    appearance.color,
  );
  return style;
}

// Data-driven body content of a panel.  Wrapped in React.memo so it skips
// re-renders when its `panel` prop is referentially unchanged, and returns null
// immediately when `frozen` is true so expensive chart/table repaints are
// suppressed during drag operations.

interface PanelCardBodyProps {
  panel: Panel;
  /** When true the body short-circuits and renders nothing (drag-freeze). */
  frozen: boolean;
  /** HEL-301: true when rendered in the phone stack — forwarded to
   *  `ChartRenderer` so ECharts hides the legend and shrinks axis labels
   *  instead of overflowing a narrow phone width (W5). No effect on other
   *  renderers; unset (desktop grid) is unchanged. */
  compact?: boolean;
}

export const PanelCardBody = React.memo(function PanelCardBody({
  panel,
  frozen,
  compact,
}: PanelCardBodyProps) {
  const dispatch = useAppDispatch();
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);
  const { data, rawRows, headers, isLoading, error, errorKind, noData, chartAggregate, refresh } =
    usePanelData(panel);
  usePanelPolling(refresh, panel.refreshInterval ?? null, getOutputId(panel));

  const outputId = getOutputId(panel);
  const handleLoadMore = useCallback(() => {
    if (paginationEntry && !paginationEntry.isLoadingMore && outputId) {
      void dispatch(
        fetchPanelPage({
          panelId: panel.id,
          outputId,
          page: paginationEntry.currentPage + 1,
          pageSize: 50,
        }),
      );
    }
  }, [dispatch, panel.id, outputId, paginationEntry]);

  // All hooks are called unconditionally above; the early return is safe here.
  // Body is hidden only during active drag — title and handle remain visible.
  if (frozen) return null;

  return (
    <PanelContent
      panel={panel}
      appearance={panel.appearance}
      data={data}
      rawRows={rawRows}
      headers={headers}
      isLoading={isLoading}
      error={error}
      errorKind={errorKind}
      onRetry={refresh}
      retryVariant="icon-only"
      noData={noData}
      paginationRows={paginationEntry?.rows ?? null}
      paginationHasMore={paginationEntry?.hasMore ?? false}
      paginationIsLoadingMore={paginationEntry?.isLoadingMore ?? false}
      onLoadMore={handleLoadMore}
      chartAggregate={chartAggregate}
      compact={compact}
    />
  );
});

// Shell component for a single panel in the grid.  Wrapped in React.memo with a
// stable props contract so only the actively dragged panel (and the grid wrapper)
// re-renders during a drag operation — not all N panels.

export interface PanelCardProps {
  panel: Panel;
  theme: "dark" | "light";
  /** True while the user is dragging any panel; freezes this card's body. */
  isDragging: boolean;
  dashboardId: string;
  /** Pre-computed: editingTitleId === panel.id */
  isEditingTitle: boolean;
  /** Masked as "" for non-editing cards so their props are stable while user types. */
  editingTitle: string;
  editingTitleError: string | null;
  /** Pre-computed: confirmDeletePanelId === panel.id */
  isConfirmingDelete: boolean;
  // Stable callbacks from PanelGrid (all useCallback-wrapped there).
  onMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  onCardClick: (panelId: string, e: React.MouseEvent<HTMLElement>) => void;
  onStartEdit: (panelId: string, currentTitle: string) => void;
  onTitleChange: (value: string) => void;
  onTitleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, panelId: string) => void;
  onTitleBlur: (panelId: string) => void;
  onRequestDelete: (panelId: string) => void;
  onCancelDelete: () => void;
  onDetail: (panelId: string) => void;
}

export const PanelCard = React.memo(function PanelCard({
  panel,
  theme,
  isDragging,
  dashboardId,
  isEditingTitle,
  editingTitle,
  editingTitleError,
  isConfirmingDelete,
  onMouseDown,
  onCardClick,
  onStartEdit,
  onTitleChange,
  onTitleKeyDown,
  onTitleBlur,
  onRequestDelete,
  onCancelDelete,
  onDetail,
}: PanelCardProps) {
  const dispatch = useAppDispatch();

  // HEL-909: assertion status now reads the panel's bound Output
  // (`GET /api/outputs/:id/assertion-status`) rather than a DataType. Not
  // yet Redux-cached/deduped across panels sharing an Output — a follow-up,
  // since the prior DataType path's slice-level dedupe (`fetchAssertionStatus`'s
  // `condition`) has no Output-side equivalent yet.
  const outputId = getOutputId(panel);
  const [isDataInvalid, setIsDataInvalid] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (outputId) {
      void getAssertionStatus(outputId)
        .then((status) => {
          if (!cancelled) setIsDataInvalid(status.invalid);
        })
        .catch(() => {
          if (!cancelled) setIsDataInvalid(false);
        });
    } else {
      // No bound Output — resolve asynchronously (not a synchronous setState
      // call inside the effect body) so switching a panel away from an
      // Output still clears a previously-set invalid flag.
      void Promise.resolve().then(() => {
        if (!cancelled) setIsDataInvalid(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [outputId]);

  // 2.2 — Memoize style to avoid a new object identity on every render.
  const style = useMemo(
    () => getPanelCardStyle(panel.appearance, theme),
    [panel.appearance, theme],
  );

  // 2.3 — Stable panel-specific callbacks; only recreate when panel.id changes.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => onCardClick(panel.id, e),
    [panel.id, onCardClick],
  );

  const handleRename = useCallback(
    () => onStartEdit(panel.id, panel.title),
    [panel.id, panel.title, onStartEdit],
  );

  const handleDetail = useCallback(() => onDetail(panel.id), [panel.id, onDetail]);

  const handleDuplicate = useCallback(
    () => void dispatch(duplicatePanel({ panelId: panel.id, dashboardId })),
    [dispatch, panel.id, dashboardId],
  );

  const handleRequestDelete = useCallback(
    () => onRequestDelete(panel.id),
    [panel.id, onRequestDelete],
  );

  const handleConfirmDelete = useCallback(() => {
    void dispatch(deletePanel({ panelId: panel.id, dashboardId }));
    onCancelDelete();
  }, [dispatch, panel.id, dashboardId, onCancelDelete]);

  const handleTitleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onTitleChange(e.target.value),
    [onTitleChange],
  );

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => onTitleKeyDown(e, panel.id),
    [panel.id, onTitleKeyDown],
  );

  const handleTitleBlur = useCallback(() => onTitleBlur(panel.id), [panel.id, onTitleBlur]);

  return (
    <article
      className="panel-grid-card"
      style={style}
      onMouseDown={onMouseDown}
      onClick={handleClick}
    >
      <div className="panel-grid-card__top">
        <div className="panel-grid-card__title-area">
          {isEditingTitle ? (
            <>
              <TextField
                className="panel-grid-card__title-input"
                type="text"
                value={editingTitle}
                autoFocus
                aria-label="Panel title"
                onChange={handleTitleInputChange}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleBlur}
              />
              <InlineError error={editingTitleError} />
            </>
          ) : (
            <>
              <h3 className="panel-grid-card__title">{panel.title}</h3>
            </>
          )}
        </div>
        <div className="panel-grid-card__actions">
          {isConfirmingDelete ? (
            <>
              <button
                type="button"
                className="panel-grid-card__delete-confirm-btn"
                onClick={handleConfirmDelete}
              >
                Confirm
              </button>
              <IconButton
                icon="×"
                variant="secondary"
                size="xs"
                aria-label={`Cancel delete ${panel.title}`}
                onClick={onCancelDelete}
              />
            </>
          ) : (
            // F-128: the drag handle is only meaningful once the header
            // returns to its normal (non-delete-confirm) state — rendering it
            // alongside Confirm/× crowds the header at the exact moment the
            // user should be making a focused binary choice.
            <>
              {isEditingTitle ? null : (
                <ActionsMenu
                  label={`${panel.title} panel actions`}
                  items={[
                    { label: "Rename", onClick: handleRename },
                    { label: "Customize", onClick: handleDetail },
                    { label: "Duplicate", onClick: handleDuplicate },
                    { label: "Delete", onClick: handleRequestDelete, danger: true },
                  ]}
                />
              )}
              <button
                type="button"
                className="panel-grid-card__handle"
                aria-label={`Move ${panel.title} panel`}
                title={`Move ${panel.title} panel`}
              >
                {/* F-099: a grip-vertical glyph reads as distinctly different
                    from the adjacent ActionsMenu trigger's horizontal 3-dot
                    ellipsis, instead of the old 2-dot mark that only differed
                    from it by dot count. */}
                <FontAwesomeIcon icon={faGripVertical} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      <PanelCardBody panel={panel} frozen={isDragging} />
      <div className="panel-grid-card__footer">
        <span className="panel-grid-card__type-badge">{panel.type}</span>
        {isDataInvalid && (
          <span
            className="panel-grid-card__type-badge panel-grid-card__type-badge--invalid"
            title="The latest pipeline run for this panel's data failed an assertion rule"
          >
            Invalid data
          </span>
        )}
        <span>Updated {new Date(panel.meta.lastUpdated).toLocaleDateString()}</span>
      </div>
    </article>
  );
});
