import { useParams } from "react-router-dom";

import { PipelineDetailSkeleton } from "./PipelineDetailSkeleton";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";
import { useIsPhoneShell } from "../../../app/shell/useIsPhoneShell";
import { PipelineDetailDialogs } from "./PipelineDetailDialogs";
import { PipelineDraftDialogs } from "./PipelineDraftDialogs";
import { PipelineMobileLayout } from "./mobile/PipelineMobileLayout";
import { PipelineSpineLayout } from "./spine/PipelineSpineLayout";

import "./PipelineDetailPage.css";
import { usePipelineDetailPage } from "../hooks/usePipelineDetailPage";
import { useStepDeepLink } from "../hooks/useStepDeepLink";

// HEL-682 — this component is now a pure page shell: all state, effects, and
// mutation handlers live in `usePipelineDetailPage` (frontend/src/features/
// pipelines/hooks/usePipelineDetailPage.ts). Split is strictly
// behavior-preserving — see that hook's F-146/F-105 comments for the
// ref/memo-identity invariants carried over unchanged.
//
// HEL-1483 -- the router reuses this component instance when only `:id` changes (list/sidebar,
// command palette, recents, back/forward all navigate `/pipelines/A` -> `/pipelines/B` in place), so
// the page is keyed by the route id: a pipeline switch becomes "leave A, open B", the same unmount
// -> mount every other navigation already is. That drops everything pipeline-local at once -- the
// seeded/edited step list, unsaved AI drafts, pending debounced step saves (the StepCards' timers
// clear on unmount), the analyze fingerprint/defer watchdog, the SSE subscription, the run-history
// modal, the share/schedule dialogs, the Output sheet/history, the output-name field and the
// Steps/Outputs tab -- instead of a reset effect that must name every one of them.
export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <PipelineDetailPageContent key={id} />;
}

function PipelineDetailPageContent() {
  // HEL-1579 (design.md D1): above the 768px phone boundary the page is the step spine; at or below it the page is
  // the phone layout (HEL-1582: header, Steps / Preview / Runs tabs, step list and sheet, floating run pills).
  const isPhoneShell = useIsPhoneShell();
  const page = usePipelineDetailPage();
  // HEL-1668 D1: the initial `?step=` is consumed once, at the first steps load, whichever layout is showing.
  const deepLink = useStepDeepLink(!page.stepsLoading && !page.stepsFailed, isPhoneShell);
  const { id, currentPipeline, currentPipelineStatus, currentPipelineError } = page;

  // ── Loading / Error guards ──
  // Show error if we have a known error and no pipeline data yet.
  // This takes priority over loading so a re-fetch does not hide the error.
  if (currentPipeline === null && currentPipelineError !== null) {
    const kind = page.currentPipelineErrorKind ?? "error";
    const Icon = ERROR_KIND_ICON[kind];
    const description =
      kind === "not-found"
        ? "We couldn't find this pipeline. It may have been deleted, or you may not have access to it."
        : kind === "forbidden"
          ? "You don't have access to this pipeline."
          : currentPipelineError;
    return (
      <PageShell className="pipeline-detail-page">
        <PageStatus
          status="failed"
          icon={<Icon />}
          title="Couldn't load this pipeline"
          message={description}
          onRetry={kind === "error" && id !== undefined ? page.retryPipelineLoad : undefined}
          retrying={currentPipelineStatus === "loading"}
        />
      </PageShell>
    );
  }

  // Show loading when we have no pipeline data yet
  if (currentPipeline === null) {
    return (
      <PageShell className="pipeline-detail-page">
        <PageStatus status="loading" variant="skeleton" loadingLabel="Loading pipeline">
          <PipelineDetailSkeleton />
        </PageStatus>
      </PageShell>
    );
  }

  // The dialogs (Output sheet, History views, share, schedule) are a SIBLING of the layout, not inside it, so
  // crossing the 768px boundary while one is open does not remount it and lose its state (HEL-1579).
  return (
    <>
      {isPhoneShell ? (
        <PipelineMobileLayout page={page} deepLink={deepLink} />
      ) : (
        <PipelineSpineLayout page={page} />
      )}
      <PipelineDetailDialogs page={page} />
      <PipelineDraftDialogs page={page} />
    </>
  );
}
