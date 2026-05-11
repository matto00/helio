import { useEffect } from "react";

import "./SourcesPage.css";
import {
  deleteSource,
  fetchSources,
  setAddSourceModalOpen,
  setSelectedSourceId,
} from "../features/sources/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { AddSourceModal } from "./AddSourceModal";
import { SourceDetailPanel } from "./SourceDetailPanel";

export function SourcesPage() {
  const dispatch = useAppDispatch();
  const {
    items: sources,
    status: sourcesStatus,
    error: sourcesError,
    selectedSourceId,
    addModalOpen,
  } = useAppSelector((state) => state.sources);

  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  // Derive the effective selection so the panel is never blank: explicit user
  // choice from the sidebar wins; otherwise fall back to the first item.
  const selected = sources.find((s) => s.id === selectedSourceId) ?? sources[0] ?? null;

  async function handleDelete(id: string) {
    await dispatch(deleteSource(id));
    // After delete, clear the explicit selection so the page falls back to
    // the next first item rather than showing a stale blank panel.
    if (selectedSourceId === id) dispatch(setSelectedSourceId(null));
    void dispatch(fetchSources());
  }

  return (
    <div className="sources-page">
      <div className="sources-page__section">
        <div className="sources-page__section-header">
          <h2 className="sources-page__section-title">Data Sources</h2>
        </div>

        {sourcesStatus === "loading" && <p className="sources-page__loading">Loading sources…</p>}
        {sourcesStatus === "failed" && sourcesError && (
          <p className="sources-page__error" role="alert">
            {sourcesError}
          </p>
        )}
        {(sourcesStatus === "succeeded" || sourcesStatus === "idle") &&
          (selected !== null ? (
            <SourceDetailPanel source={selected} onDelete={() => void handleDelete(selected.id)} />
          ) : (
            <div className="sources-page__empty-state">
              <p>No data sources yet. Use the + button in the sidebar to add one.</p>
            </div>
          ))}
      </div>

      {addModalOpen && <AddSourceModal onClose={() => dispatch(setAddSourceModalOpen(false))} />}
    </div>
  );
}
