// Detail-modal, delete-confirm and card-click state for `DesktopPanelGrid` (HEL-1418 split;
// behaviour unchanged).

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

import type { Panel } from "../../types/panel";

/** HEL-1584 D8: the viewport rectangle of a panel's card, found by the `data-panel-id` its `<article>` carries, for the
 *  paths that open the detail modal without a click event on the card (the card menu's Customize). */
export function panelCardRect(panelId: string): DOMRectReadOnly | null {
  if (!/^[\w-]+$/.test(panelId)) return null;
  return document.querySelector(`[data-panel-id="${panelId}"]`)?.getBoundingClientRect() ?? null;
}

export function usePanelDetailState(
  panels: Panel[],
  panelsStatus: string,
  beginTitleEdit: (panelId: string, currentTitle: string) => void,
) {
  const [confirmDeletePanelId, setConfirmDeletePanelId] = useState<string | null>(null);
  const [detailPanelId, setDetailPanelId] = useState<string | null>(null);
  // F-123 — the "Customize" panel-actions-menu item (wired to `onDetail`)
  // opens the settings form directly; a plain card click (`onCardClick`)
  // still opens the read-only view. Both previously funneled into the same
  // `setDetailPanelId` call with no way to tell them apart.
  const [detailPanelMode, setDetailPanelMode] = useState<"view" | "edit">("view");
  // HEL-1584 D8: where the modal grows out of -- the clicked card's rectangle at the moment it opened.
  const [detailOrigin, setDetailOrigin] = useState<DOMRectReadOnly | null>(null);
  const mousedownPos = useRef<{ x: number; y: number } | null>(null);

  // HEL-651: `detailPanel` is genuinely `Panel | undefined` — the render
  // guard in the grid (`detailPanel ?`) is what prevents ever mounting
  // `PanelDetailModal` with an undefined panel, regardless of *why*
  // `detailPanel` is momentarily undefined (transient loading/failed, or
  // truly deleted). See design.md's Decision (design-gate round 2).
  const detailPanel =
    detailPanelId !== null ? panels.find((p) => p.id === detailPanelId) : undefined;

  useEffect(() => {
    // Only auto-close (clear detailPanelId) once the panels list is
    // known-loaded ("succeeded") and still doesn't contain this panel; never
    // on "loading"/"failed", so a transient refetch window doesn't
    // permanently dismiss the modal. This does NOT preserve unsaved
    // edit-mode state — the render guard unmounts `PanelDetailModal`
    // (destroying its local useState) on ANY unmount, gated or not.
    if (detailPanelId !== null && detailPanel === undefined && panelsStatus === "succeeded") {
      // HEL-651: this effect exists specifically to synchronize local
      // `detailPanelId` with an external signal (the `panels` list confirming
      // the backing panel is gone) — the exact "subscribe for updates from
      // some external system" case the lint rule allows for, not internal
      // derived state that should be computed during render instead. The
      // render guard already prevents the crash unconditionally; this
      // setState only tidies `detailPanelId` back to a genuine "closed" state
      // once the removal is confirmed (design.md's Decision + Alternatives).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailPanelId(null);
    }
  }, [detailPanelId, detailPanel, panelsStatus]);

  // Starting a title edit dismisses the delete confirm and the detail modal. `beginTitleEdit` is
  // stable, so this keeps a stable identity (it was `[]`-deps before the split).
  const handleStartEdit = useCallback(
    (panelId: string, currentTitle: string) => {
      setConfirmDeletePanelId(null);
      setDetailPanelId(null);
      beginTitleEdit(panelId, currentTitle);
    },
    [beginTitleEdit],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    mousedownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleCardClick = useCallback((panelId: string, e: React.MouseEvent<HTMLElement>) => {
    const pos = mousedownPos.current;
    if (pos !== null && Math.abs(e.clientX - pos.x) + Math.abs(e.clientY - pos.y) > 5) return;
    if ((e.target as Element).closest("button, input, a, .react-resizable-handle")) return;
    setDetailPanelMode("view");
    setDetailOrigin(e.currentTarget.getBoundingClientRect());
    setDetailPanelId(panelId);
  }, []);

  const handleRequestDelete = useCallback((panelId: string) => {
    setConfirmDeletePanelId(panelId);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setConfirmDeletePanelId(null);
  }, []);

  const handleDetail = useCallback((panelId: string) => {
    // F-123 — "Customize" in the panel actions menu should open the editor
    // directly, not the same read-only view a plain card click lands on.
    setDetailPanelMode("edit");
    setDetailOrigin(panelCardRect(panelId));
    setDetailPanelId(panelId);
  }, []);

  const closeDetail = useCallback(() => setDetailPanelId(null), []);

  return {
    confirmDeletePanelId,
    detailPanelId,
    detailPanel,
    detailPanelMode,
    detailOrigin,
    closeDetail,
    handleStartEdit,
    handleMouseDown,
    handleCardClick,
    handleRequestDelete,
    handleCancelDelete,
    handleDetail,
  };
}
