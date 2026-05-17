import { useState } from "react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { fetchDataTypes } from "../../dataTypes/state/dataTypesSlice";
import { refreshSource } from "../services/dataSourceService";
import { deleteSource } from "../state/sourcesSlice";
import type { DataSource } from "../types/dataSource";

interface EmptySchemaAffordanceProps {
  source: DataSource;
}

/** Recovery affordance for the SourceDetailPanel when a source has no linked
 *  DataType (HEL-256). Lets the user re-infer the schema via Refresh or fall
 *  back to delete + re-upload when the underlying file is missing. */
export function EmptySchemaAffordance({ source }: EmptySchemaAffordanceProps) {
  const dispatch = useAppDispatch();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setIsRefreshing(true);
    setError(null);
    try {
      await refreshSource(source.id, source.type);
      await dispatch(fetchDataTypes());
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message ? err.message : "Failed to refresh source.";
      setError(message);
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleDelete() {
    void dispatch(deleteSource(source.id));
  }

  return (
    <section className="source-detail-panel__empty-schema" aria-label="Schema not available">
      <h4 className="source-detail-panel__section-title">Schema not available</h4>
      <p className="source-detail-panel__empty-schema-text">
        The inferred schema for this source is missing. Refresh the source to re-infer it.
      </p>
      {error && (
        <p className="source-detail-panel__error" role="alert">
          {error}
        </p>
      )}
      <div className="source-detail-panel__empty-schema-actions">
        <button
          type="button"
          className="source-detail-panel__preview-btn"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Refreshing…" : "Refresh source"}
        </button>
        <button
          type="button"
          className="source-detail-panel__delete-btn"
          onClick={handleDelete}
          disabled={isRefreshing}
          title="Delete this source so you can re-upload it."
        >
          Delete and re-upload
        </button>
      </div>
    </section>
  );
}
