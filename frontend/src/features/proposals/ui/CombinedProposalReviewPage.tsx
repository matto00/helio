import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { faTableColumns } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { IS_DEV } from "../../../config/env";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchConnectors } from "../../connectors/state/connectorsSlice";
import { applyCombinedProposal } from "../state/combinedProposalsSlice";
import {
  detectUnresolvedConnectorRefsForCombined,
  resolveCombinedConnectorRef,
} from "../utils/unresolvedConnectorRefs";
import { CombinedProposalReview } from "./CombinedProposalReview";
import type { CombinedProposal } from "../types/combinedProposal";

/** Route container for the Combined Proposal Review UI (HEL-739), mirroring
 *  `ProposalReviewPage.tsx`/`PatchSetReviewPage.tsx`/`PipelineProposalReviewPage.tsx`'s
 *  structure exactly.
 *
 *  The proposal comes from either (a) router `location.state.proposal`
 *  (`ProposalHandoff`'s "Review proposal" hand-off for a `propose_combined`
 *  result) or (b) — DEV builds only (F-002) — a small, self-contained demo
 *  proposal nesting `PipelineProposalReviewPage`'s own demo pipeline
 *  proposal alongside a small dashboard proposal whose one panel binds to
 *  the pipeline's own output via the `"$pipelineOutput"` sentinel (design.md
 *  Risk 1) — always applyable, no workspace data needed. This route sits
 *  inside `ProtectedRoute` with no other gate, so — like the other review
 *  pages — a signed-in production user landing here with no
 *  `location.state` gets an explicit "nothing to review" message, never a
 *  live, applyable proposal (F-002).
 *
 *  `applying`/`error` are read from `combinedProposalsSlice` (design.md D7)
 *  rather than local `useState`, since the thunk's own reducer already
 *  tracks both. */
export function CombinedProposalReviewPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { proposal?: CombinedProposal } | null;
  const stateProposal = routeState?.proposal;

  const applying = useAppSelector((state) => state.combinedProposals.applying);
  const applyError = useAppSelector((state) => state.combinedProposals.error);

  // F-002: the demo-fixture fallback is a DEV-only convenience for local
  // development/Playwright — never in a production build, regardless of
  // whether `location.state` is empty.
  const useDemoFixture = IS_DEV && !stateProposal;

  const initialProposal = useMemo<CombinedProposal | null>(() => {
    if (stateProposal) return stateProposal;
    if (!useDemoFixture) return null;
    return demoCombinedProposal();
  }, [stateProposal, useDemoFixture]);

  // HEL-829: local copy, patched in place as each unresolved connector
  // reference resolves (design.md Decision 3, Point 5) — never round-trips
  // through router state or any Redux slice other than
  // `connectorsSlice.fetchConnectors`'s read-only list below.
  const [proposal, setProposal] = useState<CombinedProposal | null>(initialProposal);

  const connectorsStatus = useAppSelector((state) => state.connectors.status);
  const connectors = useAppSelector((state) => state.connectors.items);
  useEffect(() => {
    if (connectorsStatus === "idle") {
      void dispatch(fetchConnectors());
    }
  }, [connectorsStatus, dispatch]);

  const unresolvedConnectorRefs = useMemo(
    () => (proposal ? detectUnresolvedConnectorRefsForCombined(proposal, connectors) : []),
    [proposal, connectors],
  );

  const handleConnectorResolved = (connectorId: string) => {
    setProposal((current) =>
      current ? resolveCombinedConnectorRef(current, connectorId) : current,
    );
  };

  const handleAccept = async () => {
    if (!proposal || unresolvedConnectorRefs.length > 0) return;
    try {
      await dispatch(applyCombinedProposal(proposal)).unwrap();
      navigate("/");
    } catch {
      // The rejected reducer already populated `combinedProposals.error`
      // (read via `applyError` above) — nothing further to do here.
    }
  };

  const handleReject = () => navigate("/");

  // F-002: no proposal handed off via navigation state, and not a DEV build
  // — there is nothing to review and no reasonable proposal to synthesize.
  if (!stateProposal && !useDemoFixture) {
    return (
      <PageShell>
        <EmptyState
          icon={faTableColumns}
          title="Nothing to review"
          description="This page reviews a combined proposal handed off from another flow. Start from the dashboards list instead."
          cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
        />
      </PageShell>
    );
  }

  if (!proposal) {
    // Unreachable in practice — see `PipelineProposalReviewPage`'s identical
    // guard for why the demo fixture is always synchronously populated by
    // the time of this render. Kept as a type-narrowing guard.
    return (
      <PageShell>
        <PageStatus status="loading" loadingLabel="Loading proposal" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <CombinedProposalReview
        proposal={proposal}
        applying={applying}
        error={applyError}
        unresolvedConnectorRefs={unresolvedConnectorRefs}
        onConnectorResolved={handleConnectorResolved}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    </PageShell>
  );
}

/** Build a small, genuinely-applyable demo combined proposal: the same
 *  self-contained demo pipeline proposal (inline `static` source, no
 *  workspace dependency) plus a one-panel dashboard proposal bound to that
 *  pipeline's own not-yet-created output via the `"$pipelineOutput"`
 *  sentinel — exercises the exact binding this page's dashboard-half
 *  rendering must special-case (design.md Risk 1). */
function demoCombinedProposal(): CombinedProposal {
  return {
    pipeline: {
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
      steps: [],
      outputs: [{ kind: "table", name: "Demo pipeline output" }],
    },
    dashboard: {
      dashboardName: "Demo proposed dashboard",
      panels: [
        {
          title: "Pipeline output",
          type: "output",
          dataTypeId: "$pipelineOutput",
          layout: { x: 0, y: 0, w: 12, h: 6 },
        },
      ],
    },
  };
}
