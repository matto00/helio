import { useEffect } from "react";

import "./SourcesPage.css";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { TypeRegistryBrowser } from "./TypeRegistryBrowser";

export function SourcesPage() {
  const dispatch = useAppDispatch();
  const { status: typesStatus } = useAppSelector((state) => state.dataTypes);

  useEffect(() => {
    void dispatch(fetchDataTypes());
  }, [dispatch]);

  return (
    <div className="sources-page">
      <div className="sources-page__section">
        <div className="sources-page__section-header">
          <h2 className="sources-page__section-title">Type Registry</h2>
        </div>

        {typesStatus === "loading" && <p className="sources-page__loading">Loading types…</p>}
        {(typesStatus === "succeeded" || typesStatus === "idle") && <TypeRegistryBrowser />}
      </div>
    </div>
  );
}
