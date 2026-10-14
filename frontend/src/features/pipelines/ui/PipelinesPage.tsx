import { useEffect, useState } from "react";

import "./PipelinesPage.css";
import { useCreatePipelineAction } from "../hooks/useCreatePipelineAction";
import {
  deletePipeline,
  fetchPipelines,
  setCreatePipelineModalOpen,
} from "../state/pipelinesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { CreatePipelineModal } from "./CreatePipelineModal";
import { PipelineEmptyState } from "./PipelineEmptyState";
import { PipelineListTable } from "./PipelineListTable";
import { PipelineShareDialog } from "./PipelineShareDialog";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { PageHeader } from "../../../shared/ui/PageHeader";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { ERROR_KIND_ICON, InlineError } from "../../../shared/chrome/InlineError";
import { ConfirmInline } from "../../../shared/ui/ConfirmInline";
import {
  focusAfterRowDeleted,
  focusOnMount,
  focusRowDelete,
  neighbourDeleteLabel,
} from "../../../shared/chrome/rowDeleteFocus";
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
  // HEL-1574: Delete lives on the overview rows (owner ruling 2026-10-14). The warning is the retired sidebar's.
  const [deletingPipeline, setDeletingPipeline] = useState<PipelineSummary | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  async function confirmDelete(pipeline: PipelineSummary) {
    // Read the neighbouring row now: once the row is gone, focus goes to it (else the heading).
    const neighbour = neighbourDeleteLabel(pipeline.name);
    setDeletingPipeline(null);
    setDeleteError(null);
    try {
      await dispatch(deletePipeline(pipeline.id)).unwrap();
      focusAfterRowDeleted(neighbour, ".pipelines-page");
    } catch {
      setDeleteError({ id: pipeline.id, message: `Failed to delete ${pipeline.name}.` });
      focusRowDelete(pipeline.name);
    }
  }

  // The confirm (or a refusal) renders as a full-width row directly below the clicked row, so opening it never moves
  // the row under the pointer: the row's own Delete stays where it is (HEL-1574, AgentMemoryList pattern).
  const rowExtra =
    deletingPipeline !== null
      ? {
          id: deletingPipeline.id,
          content: (
            <div
              role="group"
              tabIndex={-1}
              ref={focusOnMount}
              aria-label={`Confirm delete ${deletingPipeline.name}`}
            >
              <ConfirmInline
                label={`Delete ${deletingPipeline.name}? Any panels bound to this pipeline's Outputs will stop working.`}
                confirmLabel="Delete"
                confirmAriaLabel={`Confirm delete ${deletingPipeline.name}`}
                onConfirm={() => void confirmDelete(deletingPipeline)}
                onCancel={() => {
                  const name = deletingPipeline.name;
                  setDeletingPipeline(null);
                  focusRowDelete(name);
                }}
              />
            </div>
          ),
        }
      : deleteError !== null
        ? {
            id: deleteError.id,
            content: <InlineError error={deleteError.message} variant="banner" />,
          }
        : undefined;

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
                onRequestDelete={(p) => {
                  setDeleteError(null);
                  setDeletingPipeline(p);
                }}
                rowExtra={rowExtra}
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
