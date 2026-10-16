import { LayoutList, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { selectCanRedo, selectCanUndo } from "../../features/layout/state/layoutHistorySlice";
import {
  applyLayoutRedo,
  applyLayoutTidy,
  applyLayoutUndo,
  selectCanTidyLayout,
} from "../../features/layout/state/layoutHistoryThunks";
import { formatCombo, isMacPlatform, shortcuts } from "../../shared/chrome/shortcuts";
import { IconButton } from "../../shared/ui/IconButton";
import { ICON_SIZE } from "../../shared/ui/iconSize";

function comboTitle(id: string, fallback: string): string {
  const combo = shortcuts.find((s) => s.id === id)?.combo;
  return combo
    ? `${fallback} (${formatCombo(combo, { mac: isMacPlatform() }).join("+")})`
    : fallback;
}

interface DashboardMetaEditToolsProps {
  dashboardId: string;
  /** Icon-only buttons (the narrow-width ladder). */
  iconOnly: boolean;
}

/** Undo, Redo and Tidy layout (HEL-1576): mounted only while layout edit mode is on, so the history
 *  and tidy selectors run only then. Undo/Redo dispatch the same thunks as the keyboard shortcuts. */
export function DashboardMetaEditTools({ dashboardId, iconOnly }: DashboardMetaEditToolsProps) {
  const dispatch = useAppDispatch();
  const canUndo = useAppSelector(selectCanUndo(dashboardId));
  const canRedo = useAppSelector(selectCanRedo(dashboardId));
  const canTidy = useAppSelector(selectCanTidyLayout(dashboardId));

  const undoTitle = comboTitle("layout-undo", "Undo layout change");
  const redoTitle = comboTitle("layout-redo", "Redo layout change");
  const tidyTitle = canTidy ? "Tidy layout" : "Nothing to tidy";
  const undo = () => void dispatch(applyLayoutUndo(dashboardId));
  const redo = () => void dispatch(applyLayoutRedo(dashboardId));
  // A successful tidy disables Tidy itself ("Nothing to tidy"), which would drop keyboard focus to the body:
  // move it to Undo, the natural next control. Keyed on a per-tidy counter, not on Undo becoming enabled
  // (it may already be), so no other layout change ever moves focus. A tidy always pushes a history entry.
  const [undoFocusRequest, setUndoFocusRequest] = useState(0);
  useEffect(() => {
    if (undoFocusRequest === 0) return;
    document
      .querySelector<HTMLElement>('.dashboard-meta-row button[aria-label="Undo layout change"]')
      ?.focus();
  }, [undoFocusRequest]);
  const tidy = () => {
    if (dispatch(applyLayoutTidy(dashboardId))) setUndoFocusRequest((n) => n + 1);
  };

  if (iconOnly) {
    return (
      <>
        <IconButton
          icon={<RotateCcw size={ICON_SIZE.sm} />}
          variant="secondary"
          size="sm"
          onClick={undo}
          disabled={!canUndo}
          aria-label="Undo layout change"
          title={undoTitle}
        />
        <IconButton
          icon={<RotateCw size={ICON_SIZE.sm} />}
          variant="secondary"
          size="sm"
          onClick={redo}
          disabled={!canRedo}
          aria-label="Redo layout change"
          title={redoTitle}
        />
        <IconButton
          icon={<LayoutList size={ICON_SIZE.sm} />}
          variant="secondary"
          size="sm"
          onClick={tidy}
          disabled={!canTidy}
          aria-label="Tidy layout"
          title={tidyTitle}
        />
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className="cmd-btn"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo layout change"
        title={undoTitle}
      >
        <RotateCcw size={ICON_SIZE.sm} /> Undo
      </button>
      <button
        type="button"
        className="cmd-btn"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo layout change"
        title={redoTitle}
      >
        Redo <RotateCw size={ICON_SIZE.sm} />
      </button>
      <button
        type="button"
        className="cmd-btn"
        onClick={tidy}
        disabled={!canTidy}
        aria-label="Tidy layout"
        title={tidyTitle}
      >
        <LayoutList size={ICON_SIZE.sm} /> Tidy layout
      </button>
    </>
  );
}
