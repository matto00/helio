import { MessagesSquare, PencilRuler, Plus, Share2 } from "lucide-react";
import { useRef } from "react";

import { useSaveState } from "../../context/SaveStateContext";
import { DashboardAppearanceEditor } from "../../features/dashboards/ui/DashboardAppearanceEditor";
import { useShareDialog } from "../../features/dashboards/state/shareDialogContext";
import type { DashboardAppearance } from "../../features/dashboards/types/dashboard";
import { useLayoutEditEscape } from "../../features/layout/hooks/useLayoutEditEscape";
import { useLayoutUndoRedo } from "../../features/layout/hooks/useLayoutUndoRedo";
import {
  selectIsDesktopGridMounted,
  selectIsEditingLayout,
  setEditingLayoutDashboardId,
} from "../../features/layout/state/layoutHistorySlice";
import { useCreatePanelAction } from "../../features/panels/hooks/useCreatePanelAction";
import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import type { Panel } from "../../features/panels/types/panel";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { ActionsMenu, type ActionsMenuItem } from "../../shared/chrome/ActionsMenu";
import { formatCombo, isMacPlatform, shortcuts } from "../../shared/chrome/shortcuts";
import { IconButton } from "../../shared/ui/IconButton";
import { ICON_SIZE } from "../../shared/ui/iconSize";
import { DashboardMetaEditTools } from "./DashboardMetaEditTools";
import { DashboardMetaFacts } from "./DashboardMetaFacts";
import { useMetaRowTier } from "./useMetaRowTier";
import "./DashboardMetaRow.css";

const NO_PANELS: Panel[] = [];
const SHARE_TRIGGER_SELECTOR = 'button[aria-label="Share dashboard"]';
// At the kebab tiers Share is a menu item that unmounts when the dialog opens, so focus returns to the kebab trigger.
const KEBAB_TRIGGER_SELECTOR = '.dashboard-meta-row button[aria-label="Dashboard actions"]';

interface DashboardMetaRowProps {
  onOpenRefinement: () => void;
  onOpenQuickLauncher: () => void;
  setDraftAppearance: (appearance: DashboardAppearance | null) => void;
}

/**
 * HEL-1576: the dashboard view's chrome row. On the rail shell's dashboard view it REPLACES the command
 * bar (design D1, owner answer 1): it reuses the command bar's grid slot through the `app-command-bar`
 * root class, and absorbs what the command bar carried there (the save state, the appearance editor,
 * the assistant button and the actions kebab). It states facts (panel count, last refresh, sources),
 * carries no title and no dashboard name (the tab, the context list and ⌘K carry identity), and holds
 * the dashboard actions: Edit layout (with Undo/Redo/Tidy while on), Share and the one primary, Add panel.
 */
export function DashboardMetaRow({
  onOpenRefinement,
  onOpenQuickLauncher,
  setDraftAppearance,
}: DashboardMetaRowProps) {
  const dispatch = useAppDispatch();
  const { flush } = useSaveState();
  const shareDialog = useShareDialog();
  const createPanelAction = useCreatePanelAction();
  const rowRef = useRef<HTMLElement>(null);

  const selectedDashboardId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  const selectedDashboard = useAppSelector((state) =>
    state.dashboards.items.find(
      (dashboard) => dashboard.id === state.dashboards.selectedDashboardId,
    ),
  );
  const panels = useAppSelector((state) =>
    state.panels.loadedDashboardId === state.dashboards.selectedDashboardId &&
    state.dashboards.selectedDashboardId !== null
      ? state.panels.items
      : NO_PANELS,
  );
  const gridIsMovable = useAppSelector(selectIsDesktopGridMounted(selectedDashboardId));
  const isEditing = useAppSelector(selectIsEditingLayout(selectedDashboardId)) && gridIsMovable;

  // The keyboard undo/redo shortcuts live here now: the command bar no longer mounts on this view.
  useLayoutUndoRedo(selectedDashboardId);
  useLayoutEditEscape(selectedDashboardId);

  const meta = useDashboardMeta(selectedDashboardId, panels);
  const tier = useMetaRowTier(rowRef, isEditing);
  const iconOnly = tier >= 1;
  const shareInKebab = tier >= 2;

  const quickLauncherCombo = shortcuts.find((s) => s.id === "quick-launcher")?.combo;
  const quickLauncherLabel = quickLauncherCombo
    ? formatCombo(quickLauncherCombo, { mac: isMacPlatform() }).join("+")
    : "";

  function openShare() {
    if (!selectedDashboard) return;
    shareDialog.open({
      dashboardId: selectedDashboard.id,
      dashboardName: selectedDashboard.name,
      restoreFocusSelector: shareInKebab ? KEBAB_TRIGGER_SELECTOR : SHARE_TRIGGER_SELECTOR,
    });
  }

  function toggleEditing() {
    if (selectedDashboardId === null) return;
    dispatch(setEditingLayoutDashboardId(isEditing ? null : selectedDashboardId));
  }

  const kebabItems: ActionsMenuItem[] = [{ label: "Refine with AI", onClick: onOpenRefinement }];
  if (shareInKebab) {
    kebabItems.push({ label: "Share", ariaLabel: "Share dashboard", onClick: openShare });
    kebabItems.push({ label: "Open assistant", onClick: onOpenQuickLauncher });
  }

  const editLabel = isEditing ? "Done" : "Edit layout";
  const assistantButton = (
    <IconButton
      icon={<MessagesSquare size={ICON_SIZE.md} />}
      variant="secondary"
      size="sm"
      onClick={onOpenQuickLauncher}
      aria-label="Open assistant"
      title={`Assistant (${quickLauncherLabel})`}
    />
  );

  return (
    <header
      ref={rowRef}
      className="app-command-bar app-command-bar--dashboard-meta dashboard-meta-row"
    >
      <div className="app-command-bar__left dashboard-meta-row__left">
        {selectedDashboard && (
          <DashboardMetaFacts meta={meta} countOnly={tier >= 3} showSaveState onSaveNow={flush} />
        )}
      </div>
      <div className="app-command-bar__right dashboard-meta-row__actions">
        {selectedDashboard && selectedDashboardId !== null && (
          <div role="group" aria-label="Dashboard actions" className="dashboard-meta-row__group">
            {isEditing && (
              <DashboardMetaEditTools dashboardId={selectedDashboardId} iconOnly={iconOnly} />
            )}
            {gridIsMovable &&
              (iconOnly ? (
                <IconButton
                  icon={<PencilRuler size={ICON_SIZE.sm} />}
                  variant="secondary"
                  size="sm"
                  className={isEditing ? "dashboard-meta-row__pressed" : undefined}
                  onClick={toggleEditing}
                  aria-pressed={isEditing}
                  aria-label={editLabel}
                  title={editLabel}
                />
              ) : (
                <button
                  type="button"
                  className={isEditing ? "cmd-btn dashboard-meta-row__pressed" : "cmd-btn"}
                  onClick={toggleEditing}
                  aria-pressed={isEditing}
                >
                  <PencilRuler size={ICON_SIZE.sm} /> {editLabel}
                </button>
              ))}
            {!shareInKebab &&
              (iconOnly ? (
                <IconButton
                  icon={<Share2 size={ICON_SIZE.sm} />}
                  variant="secondary"
                  size="sm"
                  onClick={openShare}
                  aria-label="Share dashboard"
                  title="Share dashboard"
                />
              ) : (
                <button
                  type="button"
                  className="cmd-btn"
                  onClick={openShare}
                  aria-label="Share dashboard"
                  title="Share dashboard"
                >
                  <Share2 size={ICON_SIZE.sm} /> Share
                </button>
              ))}
            <button
              type="button"
              className="cmd-btn cmd-btn--primary"
              onClick={createPanelAction.cta.onClick}
              disabled={createPanelAction.cta.disabled}
            >
              <Plus size={ICON_SIZE.sm} /> Add panel
            </button>
          </div>
        )}
        {selectedDashboard && (
          <DashboardAppearanceEditor
            dashboard={selectedDashboard}
            onPreviewChange={setDraftAppearance}
          />
        )}
        {(!shareInKebab || !selectedDashboard) && assistantButton}
        {selectedDashboard && <ActionsMenu label="Dashboard actions" items={kebabItems} />}
      </div>
    </header>
  );
}
