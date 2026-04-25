import { useRef, useState } from "react";

import "./DataSourceList.css";
import { deleteSource, fetchSources, updateSource } from "../features/sources/sourcesSlice";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { refreshSource } from "../services/dataSourceService";

interface DataSourceListProps {
  onAddSource?: () => void;
}

export function DataSourceList({ onAddSource }: DataSourceListProps) {
  const dispatch = useAppDispatch();
  const { items } = useAppSelector((state) => state.sources);
  const dataTypes = useAppSelector((state) => state.dataTypes.items);
  const panels = useAppSelector((state) => state.panels.items);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  function isBoundToPanel(sourceId: string): boolean {
    const relatedType = dataTypes.find((dt) => dt.sourceId === sourceId);
    if (!relatedType) return false;
    return panels.some((p) => p.typeId === relatedType.id);
  }

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

  function startEdit(sourceId: string, currentName: string) {
    setEditingId(sourceId);
    setEditingName(currentName);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }

  async function confirmEdit(sourceId: string) {
    const trimmed = editingName.trim();
    if (trimmed) {
      await dispatch(updateSource({ id: sourceId, name: trimmed }));
    }
    cancelEdit();
  }

  if (items.length === 0) {
    return (
      <div className="data-source-list__empty-state">
        <p className="data-source-list__empty-message">
          No data sources yet. Add one to get started.
        </p>
        {onAddSource && (
          <button type="button" className="data-source-list__empty-cta" onClick={onAddSource}>
            Add a data source
          </button>
        )}
      </div>
    );
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
              {editingId === source.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  className="data-source-list__name-input"
                  aria-label={`Rename ${source.name}`}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void confirmEdit(source.id);
                    if (e.key === "Escape") cancelEdit();
                  }}
                />
              ) : (
                <span className="data-source-list__item-name">{source.name}</span>
              )}
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
              {editingId === source.id ? (
                <>
                  <button
                    type="button"
                    className="data-source-list__action-btn"
                    aria-label={`Save new name for ${source.name}`}
                    onClick={() => void confirmEdit(source.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="data-source-list__action-btn"
                    onClick={cancelEdit}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="data-source-list__action-btn"
                    aria-label={`Edit ${source.name}`}
                    onClick={() => startEdit(source.id, source.name)}
                  >
                    Edit
                  </button>
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
                      {isBoundToPanel(source.id) && (
                        <span className="data-source-list__bound-warning" role="alert">
                          This source has a type bound to one or more panels.
                        </span>
                      )}
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
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
