import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faTableColumns, faPlus } from "@fortawesome/free-solid-svg-icons";

import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

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
import type { DashboardSnapshot } from "../types/dashboard";
import { ActionsMenu } from "../../../shared/chrome/ActionsMenu";
import { InlineError } from "../../../shared/chrome/InlineError";
import { SidebarRowsSkeleton } from "../../../shared/chrome/SidebarRowsSkeleton";
import { StatusMessage } from "../../../shared/chrome/StatusMessage";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { IconButton } from "../../../shared/ui/IconButton";
import { TextField } from "../../../shared/ui/TextField";

export function DashboardList() {
  const dispatch = useAppDispatch();
  const { items, selectedDashboardId, status, error } = useAppSelector((state) => state.dashboards);
  const [isCreateMode, setIsCreateMode] = useState(false);
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
  const cancelledRef = useRef(false);

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
    } catch {
      setCreateError("Failed to create dashboard.");
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

  return (
    <section className="dashboard-list" aria-label="dashboards">
      <header className="dashboard-list__header">
        <h2>Dashboards</h2>
        <div className="dashboard-list__header-actions">
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
              <FontAwesomeIcon icon={faXmark} />
            </button>
          ) : null}
        </div>
      </div>
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
          <InlineError error={createError} />
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
            <p className="dashboard-list__status">No matches</p>
          ) : (
            <EmptyState
              variant="sidebar"
              icon={faTableColumns}
              title="No dashboards yet"
              description="Create your first dashboard to start visualizing data."
              cta={{
                label: "New dashboard",
                icon: faPlus,
                onClick: () => {
                  setIsCreateMode(true);
                  setCreateError(null);
                },
              }}
            />
          )
        ) : (
          <ul className="dashboard-list__items">
            {visibleItems.map((dashboard) => {
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
                        onClick={() => {
                          setConfirmDeleteId(null);
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
                          <span
                            className="dashboard-list__active-dot"
                            aria-label="Active dashboard"
                          />
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
                            onClick: () => void handleDuplicateDashboard(dashboard.id),
                          },
                          {
                            label: "Export",
                            onClick: () => void handleExportDashboard(dashboard.id, dashboard.name),
                          },
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
                  {actionError?.dashboardId === dashboard.id ? (
                    <InlineError error={actionError.message} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      }
    </section>
  );
}
