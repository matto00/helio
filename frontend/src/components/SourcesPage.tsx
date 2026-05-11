import { useEffect } from "react";

import "./SourcesPage.css";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { fetchSources, setAddSourceModalOpen } from "../features/sources/sourcesSlice";
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
    // Schema preview needs the inferred DataType for the selected source.
    void dispatch(fetchDataTypes());
  }, [dispatch]);

  // Derive the effective selection so the panel is never blank: explicit user
  // choice from the sidebar wins; otherwise fall back to the first item.
  const selected = sources.find((s) => s.id === selectedSourceId) ?? sources[0] ?? null;

  return (
    <div className="sources-page">
      <div className="sources-page__section">
        {sourcesStatus === "loading" && <p className="sources-page__loading">Loading sources…</p>}
        {sourcesStatus === "failed" && sourcesError && (
          <p className="sources-page__error" role="alert">
            {sourcesError}
          </p>
        )}
        {(sourcesStatus === "succeeded" || sourcesStatus === "idle") &&
          (selected !== null ? (
            <SourceDetailPanel source={selected} />
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
