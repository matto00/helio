import { useEffect, useState } from "react";

import "./SourcesPage.css";
import { fetchSources } from "../features/sources/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { AddSourceModal } from "./AddSourceModal";
import { DataSourceList } from "./DataSourceList";

export function SourcesPage() {
  const dispatch = useAppDispatch();
  const { status: sourcesStatus, error: sourcesError } = useAppSelector((state) => state.sources);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  return (
    <div className="sources-page">
      <div className="sources-page__section">
        <div className="sources-page__section-header">
          <h2 className="sources-page__section-title">Data Sources</h2>
          <button
            type="button"
            className="sources-page__add-btn"
            onClick={() => setIsAddModalOpen(true)}
          >
            Add source
          </button>
        </div>

        {sourcesStatus === "loading" && <p className="sources-page__loading">Loading sources…</p>}
        {sourcesStatus === "failed" && sourcesError && (
          <p className="sources-page__error" role="alert">
            {sourcesError}
          </p>
        )}
        {(sourcesStatus === "succeeded" || sourcesStatus === "idle") && (
          <DataSourceList onAddSource={() => setIsAddModalOpen(true)} />
        )}
      </div>

      {isAddModalOpen && <AddSourceModal onClose={() => setIsAddModalOpen(false)} />}
    </div>
  );
}
