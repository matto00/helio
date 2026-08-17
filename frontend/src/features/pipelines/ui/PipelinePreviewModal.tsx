import { useCallback, useEffect, useState } from "react";

import "./PipelinePreviewModal.css";
import { Modal } from "../../../shared/ui/Modal";
import { DataGrid } from "../../../shared/ui/index";
import { fetchDataTypeRows } from "../../dataTypes/services/dataTypeService";

interface PipelinePreviewModalProps {
  /** This run session's in-memory result (Run/Dry-run since the page loaded). */
  rows: Record<string, unknown>[] | null;
  rowCount: number | null;
  isDry: boolean | null;
  onClose: () => void;
  /** The pipeline's bound output DataType id — used to fetch the persisted
   *  last-run snapshot (HEL sweep F-135) when this session hasn't run the
   *  pipeline yet but an earlier run already wrote rows. */
  outputDataTypeId?: string;
  /** Persisted last-run metadata from the pipeline summary (`GET
   *  /api/pipelines`), used to decide whether fetching a snapshot is worth
   *  attempting and to label the header before the fetch resolves. */
  lastRunAt: string | null;
  lastRunRowCount: number | null;
  onRunPipeline: () => void;
  onDryRun: () => void;
}

export function PipelinePreviewModal({
  rows,
  rowCount,
  isDry,
  onClose,
  outputDataTypeId,
  lastRunAt,
  lastRunRowCount,
  onRunPipeline,
  onDryRun,
}: PipelinePreviewModalProps) {
  const hasSessionRun = rows !== null;
  // A prior session already ran this pipeline and wrote a snapshot — fetch it
  // so "No output yet" doesn't lie about a pipeline that has real output.
  const shouldFetchPersisted = !hasSessionRun && lastRunAt !== null && outputDataTypeId != null;

  const [persistedRows, setPersistedRows] = useState<Record<string, unknown>[] | null>(null);
  const [persistedLoading, setPersistedLoading] = useState(false);
  const [persistedError, setPersistedError] = useState<string | null>(null);

  // Matches `TypeDetailPanel.tsx`'s `handlePreview` shape: the fetch lives in
  // a `useCallback`-wrapped handler invoked from the effect (not inlined in
  // the effect body), so the loading/error state updates that kick it off
  // don't read as a synchronous setState-in-effect.
  const loadPersistedRows = useCallback(async (dataTypeId: string) => {
    setPersistedLoading(true);
    setPersistedError(null);
    try {
      const result = await fetchDataTypeRows(dataTypeId);
      setPersistedRows(result.rows);
    } catch (err: unknown) {
      setPersistedError(err instanceof Error ? err.message : "Failed to load last run.");
    } finally {
      setPersistedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!shouldFetchPersisted || outputDataTypeId == null) return;
    void loadPersistedRows(outputDataTypeId);
  }, [shouldFetchPersisted, outputDataTypeId, loadPersistedRows]);

  const hasPersistedRun = persistedRows !== null;
  const displayRows = hasSessionRun ? rows : persistedRows;

  let subtitle: string | undefined;
  if (hasSessionRun) {
    const count = rowCount ?? rows?.length ?? 0;
    subtitle = `${isDry ? "Dry run" : "Last run"} — ${count.toLocaleString()} row${count === 1 ? "" : "s"}`;
  } else if (hasPersistedRun) {
    const count = lastRunRowCount ?? persistedRows?.length ?? 0;
    subtitle = `Last run — ${count.toLocaleString()} row${count === 1 ? "" : "s"}`;
  }

  return (
    <Modal
      open
      title="Pipeline output preview"
      description={subtitle}
      size="lg"
      ariaLabel="Pipeline output preview"
      onClose={onClose}
    >
      {displayRows !== null ? (
        <DataGrid variant="preview" rows={displayRows} emptyText="Pipeline returned no rows." />
      ) : persistedLoading ? (
        <p className="pipeline-preview-modal__empty">Loading last run…</p>
      ) : persistedError ? (
        <p className="pipeline-preview-modal__empty" role="alert">
          {persistedError}
        </p>
      ) : (
        <div className="pipeline-preview-modal__empty-state">
          <p className="pipeline-preview-modal__empty">No output yet.</p>
          <div className="pipeline-preview-modal__empty-actions">
            <button
              type="button"
              className="ui-modal-btn ui-modal-btn--secondary"
              onClick={onDryRun}
            >
              Dry run
            </button>
            <button
              type="button"
              className="ui-modal-btn ui-modal-btn--primary"
              onClick={onRunPipeline}
            >
              Run pipeline
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
