import { useEffect, useState } from "react";

import "./PipelinesPage.css";
import { fetchPipelines, setCreatePipelineModalOpen } from "../state/pipelinesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { CreatePipelineModal } from "./CreatePipelineModal";
import { PipelineEmptyState } from "./PipelineEmptyState";
import { PipelineListTable } from "./PipelineListTable";
import { PipelineShareDialog } from "./PipelineShareDialog";
import { Spinner } from "../../../shared/ui/Spinner";
import type { PipelineSummary } from "../types/pipelineStep";

export function PipelinesPage() {
  const dispatch = useAppDispatch();
  const { items, status, error, createModalOpen } = useAppSelector((state) => state.pipelines);
  const currentUser = useAppSelector((state) => state.auth.currentUser);

  const [sharingPipeline, setSharingPipeline] = useState<PipelineSummary | null>(null);

  useEffect(() => {
    void dispatch(fetchPipelines());
  }, [dispatch]);

  return (
    <div className="pipelines-page">
      <div className="pipelines-page__section">
        {status === "loading" && (
          <div className="pipelines-page__loading" aria-label="Loading pipelines">
            <Spinner size="lg" />
            Loading pipelines…
          </div>
        )}

        {status === "failed" && error && (
          <p className="pipelines-page__error" role="alert">
            {error}
          </p>
        )}

        {(status === "succeeded" || status === "idle") && items.length === 0 && (
          <PipelineEmptyState onCreateClick={() => dispatch(setCreatePipelineModalOpen(true))} />
        )}

        {status === "succeeded" && items.length > 0 && (
          <>
            {/* HEL sweep F-133: mirrors MetricsPage.tsx's toolbar — the
             *  sidebar "+" was the only way to create a pipeline once the
             *  list was non-empty. */}
            <div className="pipelines-page__toolbar">
              <button
                type="button"
                className="pipelines-page__create-btn"
                onClick={() => dispatch(setCreatePipelineModalOpen(true))}
              >
                New pipeline
              </button>
            </div>
            <PipelineListTable
              pipelines={items}
              currentUserId={currentUser?.id}
              onShare={(p) => setSharingPipeline(p)}
            />
          </>
        )}
      </div>

      {createModalOpen && (
        <CreatePipelineModal onClose={() => dispatch(setCreatePipelineModalOpen(false))} />
      )}

      {/* ── Share dialog (owner-only, driven by row action) ── */}
      {sharingPipeline != null && (
        <PipelineShareDialog
          pipelineId={sharingPipeline.id}
          pipelineName={sharingPipeline.name}
          open={true}
          onClose={() => setSharingPipeline(null)}
        />
      )}
    </div>
  );
}
