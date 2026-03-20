import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import "./DashboardList.css";
import {
  createDashboard,
  deleteDashboard,
  renameDashboard,
  setSelectedDashboardId,
} from "../features/dashboards/dashboardsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { ActionsMenu } from "./ActionsMenu";
import { InlineError } from "./InlineError";
import { StatusMessage } from "./StatusMessage";

interface DashboardListProps {
  onCollapse?: () => void;
}

export function DashboardList({ onCollapse }: DashboardListProps) {
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
    cancelledRef.current = false;
  }

  function cancelEditing() {
    cancelledRef.current = true;
    setEditingId(null);
    setEditingError(null);
  }

  async function commitRename(dashboardId: string) {
    if (cancelledRef.current) return;
    const trimmed = editingName.trim();
    if (trimmed.length === 0) {
      setEditingError("Name must not be blank.");
      return;
    }
    setEditingId(null);
    setEditingError(null);
    await dispatch(renameDashboard({ dashboardId, name: trimmed }));
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, dashboardId: string) {
    if (event.key === "Enter") {
      void commitRename(dashboardId);
    } else if (event.key === "Escape") {
      cancelEditing();
    }
  }

  async function handleDeleteDashboard(dashboardId: string) {
    await dispatch(deleteDashboard(dashboardId));
    setConfirmDeleteId(null);
  }

  return (
    <section className="dashboard-list" aria-label="dashboards">
      <header className="dashboard-list__header">
        <div className="dashboard-list__header-row">
          <span className="dashboard-list__eyebrow">Navigation</span>
          <div className="dashboard-list__header-actions">
            <button
              type="button"
              className="dashboard-list__add"
              aria-label={isCreateMode ? "Cancel dashboard create" : "Add dashboard"}
              onClick={() => {
                setIsCreateMode((open) => !open);
                setCreateError(null);
              }}
            >
              <span aria-hidden="true">+</span>
            </button>
            {onCollapse ? (
              <button
                type="button"
                className="dashboard-list__collapse"
                aria-label="Collapse dashboard list"
                onClick={onCollapse}
              >
                <span aria-hidden="true">⟨</span>
              </button>
            ) : null}
          </div>
        </div>
        <h2>Dashboards</h2>
        <p>Choose a workspace view and keep the panel content focused on the active dashboard.</p>
      </header>
      {isCreateMode ? (
        <form className="dashboard-list__create" onSubmit={handleCreateDashboard}>
          <label className="dashboard-list__create-label" htmlFor="dashboard-create-name">
            Dashboard name
          </label>
          <input
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
          <InlineError error={createError} />
        </form>
      ) : null}
      <StatusMessage
        status={status}
        message={status === "loading" ? "Loading dashboards..." : (error ?? undefined)}
      />
      <ul className="dashboard-list__items">
        {items.map((dashboard) => (
          <li key={dashboard.id} className="dashboard-list__item">
            {editingId === dashboard.id ? (
              <div className="dashboard-list__rename">
                <input
                  className="dashboard-list__rename-input"
                  type="text"
                  value={editingName}
                  autoFocus
                  aria-label="Dashboard name"
                  onChange={(e) => {
                    setEditingName(e.target.value);
                    setEditingError(null);
                  }}
                  onKeyDown={(e) => handleRenameKeyDown(e, dashboard.id)}
                  onBlur={() => void commitRename(dashboard.id)}
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
                <span className="dashboard-list__name">{dashboard.name}</span>
                <span className="dashboard-list__meta">
                  {selectedDashboardId === dashboard.id ? "Active" : "View"}
                </span>
              </button>
            )}
            {confirmDeleteId === dashboard.id ? (
              <div className="dashboard-list__delete-confirm">
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
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Cancel
                </button>
              </div>
            ) : editingId !== dashboard.id ? (
              <ActionsMenu
                label={`${dashboard.name} actions`}
                items={[
                  {
                    label: "Rename",
                    onClick: () => startEditing(dashboard.id, dashboard.name),
                  },
                  { label: "Duplicate", onClick: () => {}, disabled: true },
                  {
                    label: "Delete",
                    onClick: () => setConfirmDeleteId(dashboard.id),
                    danger: true,
                  },
                ]}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
