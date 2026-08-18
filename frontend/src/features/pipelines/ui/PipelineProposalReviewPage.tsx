import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { faCodeBranch } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { IS_DEV } from "../../../config/env";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { applyPipelineProposal } from "../state/pipelinesSlice";
import { PipelineProposalReview } from "./PipelineProposalReview";
import type { PipelineProposal } from "../types/pipelineProposal";

/** Route container for the Pipeline Proposal Review UI (HEL-739), mirroring
 *  `ProposalReviewPage.tsx`/`PatchSetReviewPage.tsx`'s structure exactly.
 *
 *  The proposal comes from either (a) router `location.state.proposal`
 *  (`ProposalHandoff`'s "Review proposal" hand-off for a `propose_pipeline`
 *  result) or (b) — DEV builds only (F-002) — a small, self-contained demo
 *  proposal (an inline `static` source, so it's always applyable regardless
 *  of the workspace's own data — no fetch needed to build it, unlike
 *  `ProposalReviewPage`'s DataType-derived fixture). This route sits inside
 *  `ProtectedRoute` with no other gate, so — like the two existing precedents
 *  — a signed-in production user landing here with no `location.state` gets
 *  an explicit "nothing to review" message, never a live, applyable proposal
 *  synthesized from their own real data (F-002). */
export function PipelineProposalReviewPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { proposal?: PipelineProposal } | null;
  const stateProposal = routeState?.proposal;

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // F-002: the demo-fixture fallback is a DEV-only convenience for local
  // development/Playwright — never in a production build, regardless of
  // whether `location.state` is empty.
  const useDemoFixture = IS_DEV && !stateProposal;

  const proposal = useMemo<PipelineProposal | null>(() => {
    if (stateProposal) return stateProposal;
    if (!useDemoFixture) return null;
    return demoPipelineProposal();
  }, [stateProposal, useDemoFixture]);

  const handleAccept = async () => {
    if (!proposal) return;
    setApplying(true);
    setApplyError(null);
    try {
      const response = await dispatch(applyPipelineProposal(proposal)).unwrap();
      navigate(`/pipelines/${response.pipeline.id}`);
    } catch (err) {
      setApplyError(typeof err === "string" ? err : "Failed to apply the pipeline proposal.");
      setApplying(false);
    }
  };

  // Mirrors `ProposalReviewPage`/`PatchSetReviewPage`'s reject destination
  // (design.md D6 only calls out ACCEPT's destination as diverging from
  // the shared "/" convention — nothing was created, so reject has no
  // reason to diverge from it too).
  const handleReject = () => navigate("/");

  // F-002: no proposal handed off via navigation state, and not a DEV build
  // — there is nothing to review and no reasonable proposal to synthesize.
  if (!stateProposal && !useDemoFixture) {
    return (
      <EmptyState
        icon={faCodeBranch}
        title="Nothing to review"
        description="This page reviews a pipeline proposal handed off from another flow. Start from the dashboards list instead."
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    );
  }

  if (!proposal) {
    // Unreachable in practice — `demoPipelineProposal()` is synchronous (no
    // workspace data to fetch first, unlike `ProposalReviewPage`'s
    // DataType-derived fixture), so once `stateProposal` or `useDemoFixture`
    // is truthy (the only way past the guard above), `proposal` is already
    // populated by the time of this render. Kept as a type-narrowing guard.
    return (
      <div
        className="pipeline-proposal-review__loading"
        aria-busy="true"
        aria-label="Loading proposal"
      />
    );
  }

  return (
    <PipelineProposalReview
      proposal={proposal}
      applying={applying}
      error={applyError}
      onAccept={handleAccept}
      onReject={handleReject}
    />
  );
}

/** Build a small, genuinely-applyable demo pipeline proposal: an inline
 *  `static` source (so it never depends on the workspace already having a
 *  data source), no transform steps, and a fresh output DataType name. */
function demoPipelineProposal(): PipelineProposal {
  return {
    pipelineName: "Demo proposed pipeline",
    source: {
      type: "static",
      name: "Demo source",
      config: {
        columns: [
          { name: "label", type: "string" },
          { name: "value", type: "number" },
        ],
        rows: [
          ["Alpha", 10],
          ["Beta", 20],
        ],
      },
    },
    outputDataTypeName: "Demo pipeline output",
    steps: [],
  };
}
