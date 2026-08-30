import { useEffect, useState } from "react";

import "./PipelinesPage.css";
import { useCreatePipelineAction } from "../hooks/useCreatePipelineAction";
import { fetchPipelines, setCreatePipelineModalOpen } from "../state/pipelinesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { CreatePipelineModal } from "./CreatePipelineModal";
import { PipelineEmptyState } from "./PipelineEmptyState";
import { PipelineListTable } from "./PipelineListTable";
import { PipelineShareDialog } from "./PipelineShareDialog";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { PageHeader } from "../../../shared/ui/PageHeader";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";
import type { PipelineSummary } from "../types/pipelineStep";

export function PipelinesPage() {
  const dispatch = useAppDispatch();
  const { items, status, error, errorKind, createModalOpen } = useAppSelector(
    (state) => state.pipelines,
  );
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const createPipelineAction = useCreatePipelineAction();

  // Computed outside the `status === "failed"`-narrowed JSX branch below.
  const isRetryingPipelines = status === "loading";
  const PipelinesErrorIcon = ERROR_KIND_ICON[errorKind ?? "error"];

  const [sharingPipeline, setSharingPipeline] = useState<PipelineSummary | null>(null);

  useEffect(() => {
    void dispatch(fetchPipelines());
  }, [dispatch]);

  // HEL-528 design.md D3/D11 — widened to `idle` too: the mount effect above
  // dispatches after paint, so a loading-only gate would paint the empty
  // state first for one frame.
  const showPipelinesSkeleton = (status === "idle" || status === "loading") && items.length === 0;

  return (
    <PageShell className="pipelines-page">
      <PageHeader title="Data Pipelines" />

      <div className="pipelines-page__section">
        {showPipelinesSkeleton && (
          <PageStatus status="loading" variant="skeleton">
            <PageContentSkeleton />
          </PageStatus>
        )}

        {status === "failed" && error && (
          <PageStatus
            status="failed"
            icon={<PipelinesErrorIcon />}
            title="Couldn't load pipelines"
            message={
              errorKind === "not-found"
                ? "We couldn't find these pipelines. They may have been deleted, or you may not have access to them."
                : errorKind === "forbidden"
                  ? "You don't have access to these pipelines."
                  : error
            }
            onRetry={
              errorKind === "forbidden" || errorKind === "not-found"
                ? undefined
                : () => dispatch(fetchPipelines())
            }
            retrying={isRetryingPipelines}
          />
        )}

        {!showPipelinesSkeleton &&
          (status === "succeeded" || status === "idle") &&
          items.length === 0 && (
            <PipelineEmptyState onCreateClick={createPipelineAction.cta.onClick} />
          )}

        {
          // HEL-528 design.md D4 — was `status === "succeeded"`, which never
          // matched a "loading" refetch and so rendered NOTHING once items
          // already existed (the same "content vanishes mid-refetch" class
          // of bug this ticket exists to close, currently unreachable via any
          // real user action since nothing re-dispatches `fetchPipelines()`
          // once loaded, but not a state worth being wrong in either).
          status !== "failed" && items.length > 0 && (
            <>
              <PipelineListTable
                pipelines={items}
                currentUserId={currentUser?.id}
                onShare={(p) => setSharingPipeline(p)}
              />
              {/* Below the list, not above it (HEL sweep F-133 put it above,
               *  mirroring MetricsPage): as a header-height block it pushed
               *  the list itself down the page, and the list is what the
               *  page is for. The sidebar "+" is still the other way in. */}
              <div className="pipelines-page__toolbar">
                <button
                  type="button"
                  className="pipelines-page__create-btn"
                  onClick={() => dispatch(setCreatePipelineModalOpen(true))}
                >
                  New pipeline
                </button>
              </div>
            </>
          )
        }
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
    </PageShell>
  );
}
