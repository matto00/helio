import { useEffect, useState } from "react";

import "./SourcesPage.css";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { fetchSources } from "../features/sources/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { AddSourceModal } from "./AddSourceModal";
import { DataSourceList } from "./DataSourceList";
import { TypeRegistryBrowser } from "./TypeRegistryBrowser";

export function SourcesPage() {
  const dispatch = useAppDispatch();
  const { status: sourcesStatus, error: sourcesError } = useAppSelector((state) => state.sources);
  const { status: typesStatus } = useAppSelector((state) => state.dataTypes);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    void dispatch(fetchSources());
    void dispatch(fetchDataTypes());
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
        {(sourcesStatus === "succeeded" || sourcesStatus === "idle") && <DataSourceList />}
      </div>

      <div className="sources-page__section">
        <div className="sources-page__section-header">
          <h2 className="sources-page__section-title">Type Registry</h2>
        </div>

        {typesStatus === "loading" && <p className="sources-page__loading">Loading types…</p>}
        {(typesStatus === "succeeded" || typesStatus === "idle") && <TypeRegistryBrowser />}
      </div>

      {isAddModalOpen && <AddSourceModal onClose={() => setIsAddModalOpen(false)} />}
    </div>
  );
}
