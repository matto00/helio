import { useState } from "react";

import "./DataSourceList.css";
import { deleteSource, fetchSources } from "../features/sources/sourcesSlice";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { refreshSource } from "../services/dataSourceService";

export function DataSourceList() {
  const dispatch = useAppDispatch();
  const { items } = useAppSelector((state) => state.sources);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function handleRefresh(sourceId: string, sourceType: string) {
    setRefreshingId(sourceId);
    setRefreshError(null);
    try {
      await refreshSource(sourceId, sourceType);
      void dispatch(fetchDataTypes());
    } catch {
      setRefreshError("Failed to refresh source.");
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleDelete(sourceId: string) {
    await dispatch(deleteSource(sourceId));
    setConfirmDeleteId(null);
    void dispatch(fetchSources());
  }

  if (items.length === 0) {
    return <p className="data-source-list__empty">No data sources yet. Add one to get started.</p>;
  }

  return (
    <div className="data-source-list">
      {refreshError && (
        <p className="data-source-list__refresh-error" role="alert">
          {refreshError}
        </p>
      )}
      <ul className="data-source-list__items" aria-label="Data sources">
        {items.map((source) => (
          <li key={source.id} className="data-source-list__item">
            <div className="data-source-list__item-info">
              <span className="data-source-list__item-name">{source.name}</span>
              <span className="data-source-list__item-type">
                {source.sourceType === "rest_api"
                  ? "REST API"
                  : source.sourceType === "csv"
                    ? "CSV"
                    : source.sourceType === "static"
                      ? "Static"
                      : source.sourceType}
              </span>
            </div>
            <div className="data-source-list__item-actions">
              <button
                type="button"
                className="data-source-list__action-btn"
                aria-label={`Refresh ${source.name}`}
                disabled={refreshingId === source.id}
                onClick={() => void handleRefresh(source.id, source.sourceType)}
              >
                {refreshingId === source.id ? "Refreshing…" : "Refresh"}
              </button>
              {confirmDeleteId === source.id ? (
                <>
                  <span className="data-source-list__confirm-text">Delete?</span>
                  <button
                    type="button"
                    className="data-source-list__action-btn data-source-list__action-btn--danger"
                    aria-label={`Confirm delete ${source.name}`}
                    onClick={() => void handleDelete(source.id)}
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    className="data-source-list__action-btn"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="data-source-list__action-btn data-source-list__action-btn--danger"
                  aria-label={`Delete ${source.name}`}
                  onClick={() => setConfirmDeleteId(source.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
