import { useState } from "react";

import "./SourceBrowser.css";
import { deleteSource, fetchSources } from "../features/sources/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import type { DataSource } from "../types/models";
import { SourceDetailPanel } from "./SourceDetailPanel";

interface SourceBrowserProps {
  onAddSource?: () => void;
}

function labelForSourceType(sourceType: string): string {
  if (sourceType === "rest_api") return "REST API";
  if (sourceType === "csv") return "CSV";
  if (sourceType === "static") return "Static";
  if (sourceType === "sql") return "SQL";
  return sourceType;
}

export function SourceBrowser({ onAddSource }: SourceBrowserProps) {
  const dispatch = useAppDispatch();
  const { items } = useAppSelector((state) => state.sources);
  // Tracks the explicit user selection; null means "fall back to first item".
  // We derive the effective selection rather than syncing it via useEffect so we
  // don't run into the set-state-in-effect lint rule and avoid cascading renders.
  const [explicitSelectedId, setExplicitSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selected: DataSource | null =
    items.find((s) => s.id === explicitSelectedId) ?? items[0] ?? null;
  const selectedId = selected?.id ?? null;

  async function handleDeleteConfirm(id: string) {
    setDeleteError(null);
    const result = await dispatch(deleteSource(id));
    if (deleteSource.rejected.match(result)) {
      setDeleteError(result.payload ?? "Failed to delete source.");
    } else {
      void dispatch(fetchSources());
    }
    setConfirmDeleteId(null);
  }

  if (items.length === 0) {
    return (
      <div className="source-browser__empty-state">
        <p className="source-browser__empty-message">
          No data sources yet. Add one to get started.
        </p>
        {onAddSource && (
          <button type="button" className="source-detail-panel__preview-btn" onClick={onAddSource}>
            Add a data source
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="source-browser">
      <div>
        {deleteError && (
          <p className="source-browser__delete-error" role="alert">
            {deleteError}
          </p>
        )}
        <ul className="source-browser__list" aria-label="Data sources">
          {items.map((source) => {
            const isSelected = source.id === selectedId;
            const isConfirming = confirmDeleteId === source.id;
            return (
              <li
                key={source.id}
                className={
                  isSelected
                    ? "source-browser__item source-browser__item--selected"
                    : "source-browser__item"
                }
              >
                <div className="source-browser__item-row">
                  <button
                    type="button"
                    className="source-browser__item-btn"
                    aria-pressed={isSelected}
                    onClick={() => setExplicitSelectedId(source.id)}
                  >
                    <span className="source-browser__item-name">{source.name}</span>
                    <span className="source-browser__item-type">
                      {labelForSourceType(source.sourceType)}
                    </span>
                  </button>
                  {isConfirming ? (
                    <div className="source-browser__item-confirm">
                      <span className="source-browser__confirm-text">Delete?</span>
                      <button
                        type="button"
                        className="source-browser__confirm-btn source-browser__confirm-btn--danger"
                        aria-label={`Confirm delete ${source.name}`}
                        onClick={() => void handleDeleteConfirm(source.id)}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="source-browser__confirm-btn"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="source-browser__delete-btn"
                      aria-label={`Delete ${source.name}`}
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmDeleteId(source.id);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {selected && <SourceDetailPanel source={selected} />}
    </div>
  );
}
