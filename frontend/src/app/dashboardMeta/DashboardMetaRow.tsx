import { MessageCircleQuestion, MessagesSquare, PencilRuler, Plus, Share2 } from "lucide-react";
import { useRef } from "react";

import { useSaveState } from "../../context/SaveStateContext";
import { DashboardAppearanceEditor } from "../../features/dashboards/ui/DashboardAppearanceEditor";
import {
  selectCanEditDashboard,
  selectIsDashboardOwner,
} from "../../features/dashboards/state/dashboardAccess";
import { useShareDialog } from "../../features/dashboards/state/shareDialogContext";
import type { DashboardAppearance } from "../../features/dashboards/types/dashboard";
import { useLayoutEditEscape } from "../../features/layout/hooks/useLayoutEditEscape";
import { useLayoutUndoRedo } from "../../features/layout/hooks/useLayoutUndoRedo";
import {
  selectIsDesktopGridMounted,
  selectIsEditingLayout,
  setEditingLayoutDashboardId,
} from "../../features/layout/state/layoutHistorySlice";
import { panelsSettledFor } from "../../features/panels/state/panelsSettled";
import { useCreatePanelAction } from "../../features/panels/hooks/useCreatePanelAction";
import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import { useSharedDashboardMeta } from "../../features/panels/hooks/usePanelStatus";
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
  /** Opens the ask drawer; `restoreFocusSelector` is given when the opener was a menu item that unmounts (the kebab). */
  onOpenAsk: (restoreFocusSelector?: string) => void;
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
  onOpenAsk,
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
  // HEL-1773: only panels that BELONG to the selected dashboard. `fetchPanels.pending` marks the new dashboard loaded while
  // `items` still hold the previous one's panels; feeding those to `useDashboardMeta` would have it read (and keep in local
  // state) Output metadata through the previous dashboard's read scope.
  const panels = useAppSelector((state) =>
    panelsSettledFor(state.panels, state.dashboards.selectedDashboardId)
      ? state.panels.items
      : NO_PANELS,
  );
  // HEL-1773: what the caller's role on this dashboard allows. A viewer gets no editing control at all; an editor gets
  // the edits the server permits but not the owner-only actions (share) nor the owner-only Ask entry (child 3 of the ticket).
  const canEdit = useAppSelector((state) => selectCanEditDashboard(state, selectedDashboardId));
  const isOwner = useAppSelector((state) => selectIsDashboardOwner(state, selectedDashboardId));
  const gridIsMovable = useAppSelector(selectIsDesktopGridMounted(selectedDashboardId));
  const isEditing = useAppSelector(selectIsEditingLayout(selectedDashboardId)) && gridIsMovable;

  // The keyboard undo/redo shortcuts live here now: the command bar no longer mounts on this view.
  useLayoutUndoRedo(selectedDashboardId);
  useLayoutEditEscape(selectedDashboardId);

  // HEL-1786: the owner's facts read Output metadata and pipeline summaries (Output and pipeline routes); any other caller's
  // facts come from the dashboard panel-status route, which a dashboard grant alone admits. Each hook is given nothing to do
  // for the other role: the owner's gets no panels, a non-owner's gets no dashboard id (so neither makes a request).
  const ownerMeta = useDashboardMeta(selectedDashboardId, isOwner ? panels : NO_PANELS);
  const sharedMeta = useSharedDashboardMeta(isOwner ? null : selectedDashboardId, panels);
  const meta = isOwner ? ownerMeta : sharedMeta;
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

  const kebabItems: ActionsMenuItem[] = [];
  if (canEdit) kebabItems.push({ label: "Refine with AI", onClick: onOpenRefinement });
  if (shareInKebab) {
    if (isOwner) {
      kebabItems.push({ label: "Share", ariaLabel: "Share dashboard", onClick: openShare });
      kebabItems.push({
        label: "Ask about this dashboard",
        onClick: () => onOpenAsk(KEBAB_TRIGGER_SELECTOR),
      });
    }
    kebabItems.push({ label: "Open assistant", onClick: onOpenQuickLauncher });
  }

  const editLabel = isEditing ? "Done" : "Edit layout";
  // HEL-1746: a secondary icon-only control (Add panel stays the one accent control), immediately before the assistant's.
  const askButton = (
    <IconButton
      icon={<MessageCircleQuestion size={ICON_SIZE.md} />}
      variant="secondary"
      size="sm"
      onClick={() => onOpenAsk()}
      aria-label="Ask about this dashboard"
      title="Ask about this dashboard"
    />
  );
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
            {canEdit &&
              gridIsMovable &&
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
            {isOwner &&
              !shareInKebab &&
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
            {canEdit && (
              <button
                type="button"
                className="cmd-btn cmd-btn--primary"
                onClick={createPanelAction.cta.onClick}
                disabled={createPanelAction.cta.disabled}
              >
                <Plus size={ICON_SIZE.sm} /> Add panel
              </button>
            )}
          </div>
        )}
        {selectedDashboard && canEdit && (
          <DashboardAppearanceEditor
            dashboard={selectedDashboard}
            onPreviewChange={setDraftAppearance}
          />
        )}
        {selectedDashboard && isOwner && !shareInKebab && askButton}
        {(!shareInKebab || !selectedDashboard) && assistantButton}
        {selectedDashboard && kebabItems.length > 0 && (
          <ActionsMenu label="Dashboard actions" items={kebabItems} />
        )}
      </div>
    </header>
  );
}
