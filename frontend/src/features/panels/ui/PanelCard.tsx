import React, { useCallback, useMemo, type CSSProperties } from "react";

import { buildPanelSurface, resolvePanelTextColor } from "../../../theme/appearance";
import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { getDataTypeId } from "../state/panelNarrowing";
import { deletePanel, duplicatePanel, fetchPanelPage } from "../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { ActionsMenu } from "../../../shared/chrome/ActionsMenu";
import { InlineError } from "../../../shared/chrome/InlineError";
import { PanelContent } from "./PanelContent";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import type { Panel } from "../types/panel";

// ─── Style helper ────────────────────────────────────────────────────────────

function getPanelCardStyle(
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

// ─── PanelCardBody ────────────────────────────────────────────────────────────
// Data-driven body content of a panel.  Wrapped in React.memo so it skips
// re-renders when its `panel` prop is referentially unchanged, and returns null
// immediately when `frozen` is true so expensive chart/table repaints are
// suppressed during drag operations.

interface PanelCardBodyProps {
  panel: Panel;
  /** When true the body short-circuits and renders nothing (drag-freeze). */
  frozen: boolean;
}

export const PanelCardBody = React.memo(function PanelCardBody({
  panel,
  frozen,
}: PanelCardBodyProps) {
  const dispatch = useAppDispatch();
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);
  const { data, rawRows, headers, isLoading, error, noData, chartAggregate, refresh } =
    usePanelData(panel);
  usePanelPolling(refresh, panel.refreshInterval ?? null, getDataTypeId(panel));

  const handleLoadMore = useCallback(() => {
    if (paginationEntry && !paginationEntry.isLoadingMore) {
      void dispatch(
        fetchPanelPage({
          panelId: panel.id,
          page: paginationEntry.currentPage + 1,
          pageSize: 50,
        }),
      );
    }
  }, [dispatch, panel.id, paginationEntry]);

  // All hooks are called unconditionally above; the early return is safe here.
  // Body is hidden only during active drag — title and handle remain visible.
  if (frozen) return null;

  // For table panels, determine loading from pagination state (initial load)
  const tableIsLoading =
    panel.type === "table" &&
    paginationEntry != null &&
    paginationEntry.isLoadingMore &&
    paginationEntry.rows.length === 0;

  return (
    <PanelContent
      panel={panel}
      appearance={panel.appearance}
      data={data}
      rawRows={rawRows}
      headers={headers}
      isLoading={panel.type === "table" ? tableIsLoading : isLoading}
      error={error}
      noData={noData}
      paginationRows={paginationEntry?.rows ?? null}
      paginationHasMore={paginationEntry?.hasMore ?? false}
      paginationIsLoadingMore={paginationEntry?.isLoadingMore ?? false}
      onLoadMore={handleLoadMore}
      chartAggregate={chartAggregate}
    />
  );
});

// ─── PanelCard ────────────────────────────────────────────────────────────────
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
              <input
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
              {panel.dataAsOf ? (
                <p className="panel-grid-card__freshness">
                  Data as of {formatRelativeTime(panel.dataAsOf)}
                </p>
              ) : null}
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
              <button
                type="button"
                className="panel-grid-card__delete-cancel-btn"
                onClick={onCancelDelete}
              >
                ×
              </button>
            </>
          ) : isEditingTitle ? null : (
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
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <PanelCardBody panel={panel} frozen={isDragging} />
      <div className="panel-grid-card__footer">
        <span className="panel-grid-card__type-badge">{panel.type}</span>
        <span>Updated {new Date(panel.meta.lastUpdated).toLocaleDateString()}</span>
      </div>
    </article>
  );
});
