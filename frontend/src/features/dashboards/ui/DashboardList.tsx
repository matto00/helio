import {
  isBackgroundTabClick,
  openInBackgroundTab,
  suppressMiddleMouseDown,
} from "../tabs/ui/backgroundTabClick";
import { FolderPlus, LayoutDashboard, Plus, SearchX, X } from "lucide-react";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import "./DashboardList.css";
import {
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  exportDashboard,
  importDashboard,
  renameDashboard,
  setSelectedDashboardId,
} from "../state/dashboardsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useInFlightGuard } from "../../../hooks/useInFlightGuard";
import type { Dashboard, DashboardSnapshot } from "../types/dashboard";
import {
  createDashboardFolder,
  fetchDashboardFolders,
  moveDashboardToFolder,
} from "../state/dashboardFoldersSlice";
import { DashboardFolderGroup } from "./DashboardFolderGroup";
import { DashboardMovePicker } from "./DashboardMovePicker";
import { ActionsMenu } from "../../../shared/chrome/ActionsMenu";
import { InlineError } from "../../../shared/chrome/InlineError";
import { SidebarRowsSkeleton } from "../../../shared/chrome/SidebarRowsSkeleton";
import { StatusMessage } from "../../../shared/chrome/StatusMessage";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { IconButton } from "../../../shared/ui/IconButton";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { TextField } from "../../../shared/ui/TextField";
import { useShareDialog } from "../state/shareDialogContext";

/** Escapes `"` and `\` for safe embedding inside a double-quoted CSS attribute-selector value
 *  (`[aria-label="..."]`) -- e.g. `escapeAttributeSelectorValue('Say "hi"')` -- unlike
 *  `CSS.escape`, which escapes bare identifier characters (spaces included) and is the wrong tool
 *  for a value that's already inside quotes. Used only by the Share action's
 *  `restoreFocusSelector` (evaluation-2.md CR-E). */
function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function DashboardList() {
  const dispatch = useAppDispatch();
  const { items, selectedDashboardId, status, error } = useAppSelector((state) => state.dashboards);
  const {
    folders,
    assignments,
    error: foldersError,
  } = useAppSelector((state) => state.dashboardFolders);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [isFolderCreateMode, setIsFolderCreateMode] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderCreateError, setFolderCreateError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);
  const [renameStatus, setRenameStatus] = useState<"idle" | "saving">("idle");
  // Shared failure surface for Duplicate/Export/Delete (F-031) — none of
  // these has its own dedicated error slot the way rename's inline input
  // does, so a single per-dashboard {id, message} keeps the three from
  // silently swallowing a rejected dispatch.
  const [actionError, setActionError] = useState<{ dashboardId: string; message: string } | null>(
    null,
  );
  const [filterQuery, setFilterQuery] = useState("");
  // HEL-590 (evaluation-1.md CR4): opens the dialog via shell-level context rather than local
  // state + a locally-rendered `DashboardShareDialog` -- see `shareDialogContext.tsx`'s docstring
  // for why (this component's DOM subtree is hidden entirely below the desktop breakpoint).
  const shareDialog = useShareDialog();
  const cancelledRef = useRef(false);

  useEffect(() => {
    void dispatch(fetchDashboardFolders());
  }, [dispatch]);

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = folderName.trim();
    if (trimmed.length === 0) return;
    setFolderCreateError(null);
    try {
      await dispatch(createDashboardFolder({ name: trimmed })).unwrap();
      setFolderName("");
      setIsFolderCreateMode(false);
    } catch (err) {
      setFolderCreateError(typeof err === "string" ? err : "Failed to create folder.");
    }
  }

  async function handleMove(dashboardId: string, folderId: string | null) {
    setMovingId(null);
    setActionError(null);
    try {
      await dispatch(moveDashboardToFolder({ dashboardId, folderId })).unwrap();
    } catch {
      setActionError({ dashboardId, message: "Failed to move dashboard." });
    }
  }
  const { isPending: isDuplicatePending, guardedRun: guardedDuplicateRun } =
    useInFlightGuard<string>();

  async function handleCreateDashboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      return;
    }

    setIsSaving(true);
    setCreateError(null);
    try {
      await dispatch(createDashboard({ name: normalizedName })).unwrap();
      setName("");
      setIsCreateMode(false);
    } catch (err) {
      // HEL-548 D6a — bind the thunk's own (now-specific, D6) rejection
      // message instead of a hardcoded generic string, matching every other
      // `.unwrap()` catch in this file.
      setCreateError(typeof err === "string" ? err : "Failed to create dashboard.");
    } finally {
      setIsSaving(false);
    }
  }

  function startEditing(dashboardId: string, currentName: string) {
    setConfirmDeleteId(null);
    setEditingId(dashboardId);
    setEditingName(currentName);
    setEditingError(null);
    setRenameStatus("idle");
    cancelledRef.current = false;
  }

  function cancelEditing() {
    cancelledRef.current = true;
    setEditingId(null);
    setEditingError(null);
    setRenameStatus("idle");
  }

  async function commitRename(dashboardId: string) {
    if (cancelledRef.current) return;
    const trimmed = editingName.trim();
    if (trimmed.length === 0) {
      setEditingError("Name must not be blank.");
      return;
    }
    setRenameStatus("saving");
    setEditingError(null);
    try {
      await dispatch(renameDashboard({ dashboardId, name: trimmed })).unwrap();
      setEditingId(null);
      setRenameStatus("idle");
    } catch (err) {
      // Keep the row in edit mode (matches SidebarItemList.onRename's
      // contract elsewhere in the app) so the failure is visible next to the
      // input instead of the box just quietly closing (F-031).
      setRenameStatus("idle");
      setEditingError(typeof err === "string" ? err : "Failed to rename dashboard.");
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, dashboardId: string) {
    if (event.key === "Enter") {
      void commitRename(dashboardId);
    } else if (event.key === "Escape") {
      cancelEditing();
    }
  }

  async function handleDeleteDashboard(dashboardId: string) {
    setActionError(null);
    try {
      await dispatch(deleteDashboard(dashboardId)).unwrap();
      setConfirmDeleteId(null);
    } catch {
      // Leave the Confirm/Cancel row open on failure (instead of closing it
      // as if the delete had succeeded) and surface the error inline so a
      // rejected delete isn't silently swallowed (F-031).
      setActionError({ dashboardId, message: "Failed to delete dashboard." });
    }
  }

  async function handleDuplicateDashboard(dashboardId: string) {
    setActionError(null);
    try {
      await dispatch(duplicateDashboard(dashboardId)).unwrap();
    } catch {
      setActionError({ dashboardId, message: "Failed to duplicate dashboard." });
    }
  }

  async function handleExportDashboard(dashboardId: string, dashboardName: string) {
    setActionError(null);
    try {
      await dispatch(exportDashboard({ dashboardId, dashboardName })).unwrap();
    } catch {
      setActionError({ dashboardId, message: "Failed to export dashboard." });
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsSaving(true);
    setCreateError(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const snapshot = JSON.parse(text) as DashboardSnapshot;
        await dispatch(importDashboard(snapshot)).unwrap();
        setIsCreateMode(false);
      } catch (err) {
        setCreateError(typeof err === "string" ? err : "Failed to import dashboard.");
      } finally {
        setIsSaving(false);
        // Reset input so the same file can be re-selected
        event.target.value = "";
      }
    };
    reader.onerror = () => {
      setCreateError("Failed to read the selected file.");
      setIsSaving(false);
    };
    reader.readAsText(file);
  }

  // Active dashboard is always pinned first; matching non-active items follow; non-matches hidden.
  const normalizedQuery = filterQuery.toLowerCase().trim();
  const visibleItems = (() => {
    if (normalizedQuery.length === 0) return items;
    const active = items.find((d) => d.id === selectedDashboardId);
    const matches = items.filter(
      (d) => d.id !== selectedDashboardId && d.name.toLowerCase().includes(normalizedQuery),
    );
    return active ? [active, ...matches] : matches;
  })();

  // HEL-1574: folders are per-user and server-side. A filing whose folder no longer exists counts as unfiled.
  const folderIds = new Set(folders.map((folder) => folder.id));
  const folderOf = (dashboardId: string): string | null => {
    const folderId = assignments[dashboardId];
    return folderId !== undefined && folderIds.has(folderId) ? folderId : null;
  };
  // Navigating into a folder saved as collapsed reveals it once. After that the disclosure always flips what is shown
  // (and what it saves), so the folder holding the open dashboard can still be closed. React's "adjust state while
  // rendering" pattern: the reveal is keyed on (open dashboard, its folder), so it fires on navigation and when the
  // folder list first arrives, never on a later re-render.
  const activeFolderId = selectedDashboardId === null ? null : folderOf(selectedDashboardId);
  const revealKey = `${selectedDashboardId ?? ""}:${activeFolderId ?? ""}`;
  const [seenRevealKey, setSeenRevealKey] = useState(revealKey);
  const [revealedFolderIds, setRevealedFolderIds] = useState<ReadonlySet<string>>(new Set());
  if (seenRevealKey !== revealKey) {
    setSeenRevealKey(revealKey);
    const folder = folders.find((f) => f.id === activeFolderId);
    if (folder?.collapsed) setRevealedFolderIds((ids) => new Set(ids).add(folder.id));
  }
  const folderGroups = folders
    .map((folder) => ({
      folder,
      dashboards: visibleItems.filter((d) => folderOf(d.id) === folder.id),
      total: items.filter((d) => folderOf(d.id) === folder.id).length,
    }))
    // A filter hides the folders it leaves empty; unfiltered, an empty folder still shows.
    .filter((group) => normalizedQuery.length === 0 || group.dashboards.length > 0);
  const unfiledItems = visibleItems.filter((d) => folderOf(d.id) === null);
  const unfiledTotal = items.filter((d) => folderOf(d.id) === null).length;

  function renderRow(dashboard: Dashboard) {
    const matchesQuery = dashboard.name.toLowerCase().includes(normalizedQuery);
    const isActive = dashboard.id === selectedDashboardId;
    const isOutsideFilter = !matchesQuery && isActive && normalizedQuery.length > 0;
    const itemClassName = isOutsideFilter
      ? "dashboard-list__item dashboard-list__item--outside-filter"
      : "dashboard-list__item";

    const isConfirmingDelete = confirmDeleteId === dashboard.id;
    return (
      <li key={dashboard.id} className={`${itemClassName} dashboard-list__item--row`}>
        <div className="dashboard-list__item-row">
          {editingId === dashboard.id ? (
            <div className="dashboard-list__rename">
              <input
                className="dashboard-list__rename-input"
                type="text"
                value={editingName}
                autoFocus
                disabled={renameStatus === "saving"}
                aria-label="Dashboard name"
                onChange={(e) => {
                  setEditingName(e.target.value);
                  setEditingError(null);
                }}
                onKeyDown={(e) => handleRenameKeyDown(e, dashboard.id)}
                onBlur={() => {
                  // Disabling the input while a save is in flight blurs it
                  // (a disabled element can't hold focus) — that's not a
                  // user-initiated blur, so it must not double-commit.
                  if (renameStatus === "saving") return;
                  void commitRename(dashboard.id);
                }}
              />
              <InlineError error={editingError} />
            </div>
          ) : (
            <button
              type="button"
              className="dashboard-list__button"
              aria-label={dashboard.name}
              aria-pressed={selectedDashboardId === dashboard.id}
              onMouseDown={suppressMiddleMouseDown}
              onAuxClick={(event) => {
                if (isBackgroundTabClick(event)) openInBackgroundTab(dispatch, dashboard.id);
              }}
              onClick={(event) => {
                setConfirmDeleteId(null);
                if (isBackgroundTabClick(event)) {
                  openInBackgroundTab(dispatch, dashboard.id);
                  return;
                }
                dispatch(setSelectedDashboardId(dashboard.id));
              }}
            >
              <span className="dashboard-list__name-group">
                <span className="dashboard-list__name">{dashboard.name}</span>
                {isOutsideFilter && (
                  <span className="dashboard-list__pinned-badge" aria-hidden="true">
                    active
                  </span>
                )}
              </span>
              {selectedDashboardId === dashboard.id && (
                <span className="dashboard-list__active-dot" aria-label="Active dashboard" />
              )}
            </button>
          )}
          {editingId !== dashboard.id && !isConfirmingDelete ? (
            <ActionsMenu
              label={`${dashboard.name} actions`}
              items={[
                {
                  label: "Rename",
                  onClick: () => startEditing(dashboard.id, dashboard.name),
                },
                {
                  label: "Duplicate",
                  onClick: () =>
                    guardedDuplicateRun(dashboard.id, () => handleDuplicateDashboard(dashboard.id)),
                  disabled: isDuplicatePending(dashboard.id),
                },
                {
                  label: "Share",
                  onClick: () =>
                    shareDialog.open({
                      dashboardId: dashboard.id,
                      dashboardName: dashboard.name,
                      // HEL-590 (evaluation-2.md CR-E): this ActionsMenu's own trigger
                      // button carries `aria-label={`${dashboard.name} actions`}` --
                      // see ActionsMenu.tsx. Restoring focus to it on close is the
                      // sensible target, since the item just clicked unmounts along
                      // with the popover in the same commit the dialog opens in.
                      restoreFocusSelector: `button[aria-label="${escapeAttributeSelectorValue(`${dashboard.name} actions`)}"]`,
                    }),
                },
                {
                  label: "Export",
                  onClick: () => void handleExportDashboard(dashboard.id, dashboard.name),
                },
                ...(folders.length > 0
                  ? [
                      {
                        label: "Move to…",
                        onClick: () => {
                          setConfirmDeleteId(null);
                          setMovingId(dashboard.id);
                        },
                      },
                    ]
                  : []),
                {
                  label: "Delete",
                  onClick: () => setConfirmDeleteId(dashboard.id),
                  danger: true,
                },
              ]}
            />
          ) : null}
        </div>
        {isConfirmingDelete ? (
          <div className="dashboard-list__delete-confirm-row">
            <div className="dashboard-list__delete-confirm-actions">
              <button
                type="button"
                className="dashboard-list__delete-confirm-btn"
                onClick={() => void handleDeleteDashboard(dashboard.id)}
              >
                Confirm
              </button>
              <button
                type="button"
                className="dashboard-list__delete-cancel-btn"
                onClick={() => {
                  setConfirmDeleteId(null);
                  setActionError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {movingId === dashboard.id ? (
          <DashboardMovePicker
            folders={folders}
            currentFolderId={folderOf(dashboard.id)}
            onPick={(folderId) => void handleMove(dashboard.id, folderId)}
            onCancel={() => setMovingId(null)}
          />
        ) : null}
        {actionError?.dashboardId === dashboard.id ? (
          <InlineError error={actionError.message} />
        ) : null}
      </li>
    );
  }

  return (
    <section className="dashboard-list" aria-label="dashboards">
      <header className="dashboard-list__header">
        <span />
        <div className="dashboard-list__header-actions">
          <IconButton
            icon={<FolderPlus size={ICON_SIZE.sm} />}
            variant="secondary"
            size="xs"
            aria-label={isFolderCreateMode ? "Cancel folder create" : "New folder"}
            onClick={() => {
              setIsFolderCreateMode((open) => !open);
              setFolderCreateError(null);
            }}
          />
          <IconButton
            icon="+"
            variant="secondary"
            size="xs"
            aria-label={isCreateMode ? "Cancel dashboard create" : "Add dashboard"}
            onClick={() => {
              setIsCreateMode((open) => !open);
              setCreateError(null);
            }}
          />
        </div>
      </header>
      <div className="dashboard-list__filter">
        <label className="dashboard-list__filter-label" htmlFor="dashboard-filter-input">
          Filter dashboards
        </label>
        <div className="dashboard-list__filter-wrapper">
          <TextField
            id="dashboard-filter-input"
            className="dashboard-list__filter-input"
            type="text"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Search..."
            aria-label="Filter dashboards by name"
          />
          {filterQuery.length > 0 ? (
            <button
              type="button"
              className="dashboard-list__filter-clear"
              aria-label="Clear filter"
              title="Clear filter"
              onClick={() => setFilterQuery("")}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      {isFolderCreateMode ? (
        <form className="dashboard-list__create" onSubmit={handleCreateFolder}>
          <label className="dashboard-list__create-label" htmlFor="dashboard-folder-name">
            Folder name
          </label>
          <TextField
            id="dashboard-folder-name"
            className="dashboard-list__create-input"
            type="text"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="Daily"
            aria-label="Folder name"
            autoFocus
          />
          <button
            type="submit"
            className="dashboard-list__create-submit"
            disabled={folderName.trim().length === 0}
          >
            Create folder
          </button>
          <InlineError error={folderCreateError} variant="banner" />
        </form>
      ) : null}
      {foldersError !== null ? <InlineError error={foldersError} /> : null}
      {isCreateMode ? (
        <form className="dashboard-list__create" onSubmit={handleCreateDashboard}>
          <label className="dashboard-list__create-label" htmlFor="dashboard-create-name">
            Dashboard name
          </label>
          <TextField
            id="dashboard-create-name"
            className="dashboard-list__create-input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Operations"
            aria-label="Dashboard name"
            autoFocus
          />
          <button
            type="submit"
            className="dashboard-list__create-submit"
            disabled={isSaving || name.trim().length === 0}
          >
            {isSaving ? "Creating..." : "Create dashboard"}
          </button>
          <input
            id="dashboard-import-file"
            className="dashboard-list__import-input"
            type="file"
            accept=".json"
            disabled={isSaving}
            onChange={handleImportFile}
            aria-label="Import dashboard from JSON file"
          />
          <label className="dashboard-list__import-label" htmlFor="dashboard-import-file">
            {isSaving ? "Importing..." : "Import from file"}
          </label>
          {/* HEL-548 D6a — "banner" (role="alert" + lucide error icon,
              InlineError.tsx:67-73) instead of the bare-text default, so this
              surface meets the bar `toast-emission-integrity` requires before
              the createDashboard.rejected toast can be removed (task 3.6). */}
          <InlineError error={createError} variant="banner" />
        </form>
      ) : null}
      {
        // HEL-528 design.md D3/D4/D11 — initial-load skeleton takes the same
        // (idle-or-loading, no items) gate the sidebar's other sections use, so
        // the pre-dispatch idle frame (`App.tsx` dispatches `fetchDashboards()`
        // unconditionally, but its mount effect runs after paint) renders the
        // skeleton rather than this list's own "No dashboards yet" empty state
        // one frame early. A refetch with dashboards already loaded keeps
        // rendering them instead of flashing back to placeholders.
        (status === "idle" || status === "loading") && items.length === 0 ? (
          <SidebarRowsSkeleton ariaLabel="Loading dashboards…" />
        ) : status === "failed" ? (
          <StatusMessage status="failed" message={error ?? undefined} />
        ) : visibleItems.length === 0 && !isCreateMode ? (
          normalizedQuery.length > 0 ? (
            // HEL-548 D3/6.1 — filter-to-zero is its own state: distinct
            // title/icon from "No dashboards yet" below, names the query,
            // offers only a way to clear it (never the create action, which
            // does not resolve a query that matched nothing).
            <EmptyState
              variant="sidebar"
              icon={<SearchX />}
              title="No matches"
              description={`No dashboards match "${filterQuery.trim()}".`}
              cta={{
                label: "Clear filter",
                onClick: () => setFilterQuery(""),
              }}
            />
          ) : (
            <EmptyState
              variant="sidebar"
              icon={<LayoutDashboard />}
              title="No dashboards yet"
              description="Create your first dashboard to start visualizing data."
              cta={{
                label: "New dashboard",
                icon: <Plus />,
                onClick: () => {
                  setIsCreateMode(true);
                  setCreateError(null);
                },
              }}
            />
          )
        ) : (
          <div className="dashboard-list__groups">
            {folders.length === 0 ? (
              <ul className="dashboard-list__items">{unfiledItems.map(renderRow)}</ul>
            ) : (
              <>
                {folderGroups.map(({ folder, dashboards, total }) => (
                  <DashboardFolderGroup
                    key={folder.id}
                    folder={folder}
                    count={total}
                    expanded={!folder.collapsed || revealedFolderIds.has(folder.id)}
                    onToggle={() =>
                      setRevealedFolderIds((ids) => {
                        const next = new Set(ids);
                        next.delete(folder.id);
                        return next;
                      })
                    }
                  >
                    <ul className="dashboard-list__items">{dashboards.map(renderRow)}</ul>
                  </DashboardFolderGroup>
                ))}
                {unfiledItems.length > 0 && (
                  <section className="dashboard-list__folder" aria-label="Unfiled">
                    <h3 className="dashboard-list__folder-static-title">
                      <span className="dashboard-list__folder-name">Unfiled</span>
                      <span className="dashboard-list__folder-count">{unfiledTotal}</span>
                    </h3>
                    <ul className="dashboard-list__items">{unfiledItems.map(renderRow)}</ul>
                  </section>
                )}
              </>
            )}
          </div>
        )
      }
    </section>
  );
}
