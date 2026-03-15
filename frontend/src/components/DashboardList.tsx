import { useState, type FormEvent } from "react";

import "./DashboardList.css";
import { createDashboard, setSelectedDashboardId } from "../features/dashboards/dashboardsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
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
          <li key={dashboard.id}>
            <button
              type="button"
              className="dashboard-list__button"
              aria-label={dashboard.name}
              aria-pressed={selectedDashboardId === dashboard.id}
              onClick={() => dispatch(setSelectedDashboardId(dashboard.id))}
            >
              <span className="dashboard-list__name">{dashboard.name}</span>
              <span className="dashboard-list__meta">
                {selectedDashboardId === dashboard.id ? "Active" : "View"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
