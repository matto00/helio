import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";

import "./PanelList.css";
import { defaultDashboardLayout } from "../features/dashboards/dashboardLayout";
import { createPanel } from "../features/panels/panelsSlice";
import { PanelGrid } from "./PanelGrid";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { InlineError } from "./InlineError";
import { StatusMessage } from "./StatusMessage";
import { resolveDashboardGridBackground } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";
import type { PanelType } from "../types/models";

const PANEL_TYPES: { value: PanelType; label: string }[] = [
  { value: "metric", label: "Metric" },
  { value: "chart", label: "Chart" },
  { value: "text", label: "Text" },
  { value: "table", label: "Table" },
];

export function PanelList() {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const { items: dashboards, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const { items, status, error } = useAppSelector((state) => state.panels);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [title, setTitle] = useState("");
  const [panelType, setPanelType] = useState<PanelType>("metric");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const selectedDashboard =
    dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;

  async function handleCreatePanel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedDashboardId === null) {
      return;
    }

    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      await dispatch(
        createPanel({ dashboardId: selectedDashboardId, title: normalizedTitle, type: panelType }),
      ).unwrap();
      setTitle("");
      setPanelType("metric");
      setIsCreateMode(false);
    } catch {
      setCreateError("Failed to create panel.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section
      className="panel-list"
      aria-label="panels"
      style={
        selectedDashboard?.appearance.gridBackground &&
        selectedDashboard.appearance.gridBackground !== "transparent"
          ? ({
              "--dashboard-grid-background-override": resolveDashboardGridBackground(
                theme,
                selectedDashboard.appearance,
              ),
            } as CSSProperties)
          : undefined
      }
    >
      <header className="panel-list__header">
        <h2>Panels</h2>
        <div className="panel-list__header-actions">
          <span className="panel-list__count">
            {items.length} panel{items.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="panel-list__add"
            aria-label={isCreateMode ? "Cancel panel create" : "Add panel"}
            onClick={() => {
              setIsCreateMode((open) => !open);
              setCreateError(null);
              setPanelType("metric");
            }}
            disabled={selectedDashboardId === null}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </header>
      {isCreateMode ? (
        <form className="panel-list__create" onSubmit={handleCreatePanel}>
          <label className="panel-list__create-label" htmlFor="panel-create-title">
            Panel title
          </label>
          <input
            id="panel-create-title"
            className="panel-list__create-input"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Revenue Pulse"
            aria-label="Panel title"
            autoFocus
          />
          <fieldset className="panel-list__type-selector">
            <legend className="panel-list__create-label">Panel type</legend>
            {PANEL_TYPES.map(({ value, label }) => (
              <label key={value} className="panel-list__type-option">
                <input
                  type="radio"
                  name="panel-type"
                  value={value}
                  checked={panelType === value}
                  onChange={() => setPanelType(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            className="panel-list__create-submit"
            disabled={isCreating || selectedDashboardId === null || title.trim().length === 0}
          >
            {isCreating ? "Creating..." : "Create panel"}
          </button>
          <InlineError error={createError} />
        </form>
      ) : null}
      <StatusMessage
        status={status}
        message={status === "loading" ? "Loading panels..." : (error ?? undefined)}
      />
      {status !== "loading" && status !== "failed" && selectedDashboardId === null ? (
        <p className="panel-list__state">Select a dashboard to view panels.</p>
      ) : null}
      {status === "succeeded" && items.length === 0 && !isCreateMode ? (
        <div className="panel-list__empty-state">
          <img
            className="panel-list__empty-icon"
            src="/empty-panel-grid.svg"
            alt=""
            aria-hidden="true"
          />
          <h3 className="panel-list__empty-heading">No panels yet</h3>
          <p className="panel-list__empty-subtext">Add a panel to start building your dashboard</p>
          <button
            type="button"
            className="panel-list__empty-cta"
            onClick={() => setIsCreateMode(true)}
            disabled={selectedDashboardId === null}
          >
            Add panel
          </button>
        </div>
      ) : null}
      {items.length > 0 && selectedDashboardId !== null ? (
        <PanelGrid
          key={selectedDashboardId}
          dashboardId={selectedDashboardId}
          layout={selectedDashboard?.layout ?? defaultDashboardLayout}
          panels={items}
        />
      ) : null}
    </section>
  );
}
