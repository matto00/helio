import { isAxiosError } from "axios";
import { useEffect, useState } from "react";

import { InlineError } from "../../../shared/chrome/InlineError";
import { ConfirmInline } from "../../../shared/ui/ConfirmInline";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { refreshSource } from "../services/dataSourceService";
import {
  deleteSource,
  fetchSourceReferences,
  fetchSources,
  isSourceDeleteConflict,
  type SourceDeleteConflict,
} from "../state/sourcesSlice";
import { sourceDeleteWarning } from "../utils/sourceReferences";
import { SourceDeleteConflictNotice } from "./SourceDeleteConflictNotice";
import type { DataSource } from "../types/dataSource";

interface EmptySchemaAffordanceProps {
  source: DataSource;
}

/** Recovery affordance for the SourceDetailPanel when a source has no linked
 *  DataType (HEL-256). Lets the user re-infer the schema via Refresh or fall
 *  back to delete + re-upload when the underlying file is missing. */
export function EmptySchemaAffordance({ source }: EmptySchemaAffordanceProps) {
  const dispatch = useAppDispatch();
  const summary = useAppSelector((state) => state.sources.references[source.id]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<SourceDeleteConflict | null>(null);
  // F-012: this was a single-click, zero-confirmation delete — every other
  // destructive action in the app (the sidebar's own source delete included,
  // see SidebarBody.tsx's `deleteWarning`) routes through the shared inline
  // confirm affordance with a dependents warning. Mirrors that same warning
  // copy so a source with live pipeline dependents warns identically whether
  // it's deleted from here or from the sidebar.
  const [confirmDelete, setConfirmDelete] = useState(false);
  // HEL-1258: the warning is the server's reference summary (every kind the delete guard refuses on),
  // refreshed on mount -- never a client-side count over the pipelines list.
  const deleteWarning = sourceDeleteWarning(summary);

  useEffect(() => {
    void dispatch(fetchSourceReferences());
  }, [dispatch]);

  async function handleRefresh() {
    setIsRefreshing(true);
    setError(null);
    try {
      await refreshSource(source.id, source.type);
      await dispatch(fetchSources());
    } catch (err: unknown) {
      const serverMessage =
        isAxiosError(err) && typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : null;
      setError(serverMessage ?? "Failed to refresh source.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleDelete() {
    setConfirmDelete(false);
    setDeleteConflict(null);
    // HEL-989: a 409 (pipelines still root on this source) is reported inline, naming them.
    const result = await dispatch(deleteSource(source.id));
    if (deleteSource.rejected.match(result) && isSourceDeleteConflict(result.payload)) {
      setDeleteConflict(result.payload);
    }
  }

  return (
    <section className="source-detail-panel__empty-schema" aria-label="Schema not available">
      <h4 className="eyebrow source-detail-panel__section-title">Schema not available</h4>
      <p className="source-detail-panel__empty-schema-text">
        The inferred schema for this source is missing. Refresh the source to re-infer it.
      </p>
      {/* F-051: the pre-migration hand-rolled `.source-detail-panel__error`
          class this replaces was the SAME boxed treatment used by
          SourceDetailPanel's own preview-failure message — a standalone
          async-operation result, not a form field's inline validation
          message — so this maps to InlineError's "banner" variant, not the
          plain-text default. */}
      <InlineError error={error} variant="banner" />
      {deleteConflict !== null ? (
        <SourceDeleteConflictNotice
          sourceName={source.name}
          conflict={deleteConflict}
          onDismiss={() => setDeleteConflict(null)}
        />
      ) : null}
      <div className="source-detail-panel__empty-schema-actions">
        <button
          type="button"
          className="source-detail-panel__preview-btn"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Refreshing…" : "Refresh source"}
        </button>
        {confirmDelete ? (
          <ConfirmInline
            label={
              deleteWarning === null
                ? `Delete "${source.name}"?`
                : `Delete "${source.name}"? ${deleteWarning}`
            }
            confirmAriaLabel={`Confirm delete ${source.name}`}
            cancelAriaLabel={`Cancel delete ${source.name}`}
            onConfirm={() => void handleDelete()}
            onCancel={() => setConfirmDelete(false)}
          />
        ) : (
          <button
            type="button"
            className="source-detail-panel__delete-btn"
            onClick={() => setConfirmDelete(true)}
            disabled={isRefreshing}
            title="Delete this source so you can re-upload it."
          >
            Delete and re-upload
          </button>
        )}
      </div>
    </section>
  );
}
