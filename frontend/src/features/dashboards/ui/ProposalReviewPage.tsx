import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { faTableColumns } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";
import { IS_DEV } from "../../../config/env";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { fetchDataTypes } from "../../dataTypes/services/dataTypeService";
import type { DataType } from "../../dataTypes/types/dataType";
import { postAuthoringOutcome } from "../services/authoringService";
import { applyProposal } from "../state/dashboardsSlice";
import { EMPTY_WORKSPACE_COPY } from "../utils/emptyWorkspaceCopy";
import {
  classifyRequestError,
  type RequestErrorKind,
} from "../../../services/classifyRequestError";
import { ProposalReview, type ReviewDataType } from "./ProposalReview";
import type { DashboardProposal } from "../types/proposal";

/** Route container for the Proposal Review UI (HEL-224).
 *
 *  The proposal comes from either (a) router `location.state.proposal` (e.g.
 *  produced by the MCP `propose_dashboard` tool and handed to the app) or
 *  (b) — DEV builds only (F-002) — a demo proposal synthesized from the first
 *  pipeline-output DataType in the workspace, the fixture path used for
 *  local development and Playwright. This route sits inside `ProtectedRoute`
 *  with no other gate, so a signed-in production user landing here with no
 *  `location.state` (a stale bookmark, a back-navigation, a typo) used to get
 *  a *live, applyable* proposal synthesized from their own real data instead
 *  of a "nothing to review" message — see F-002. Wiring an in-app
 *  natural-language → Claude author for the proposal is a deliberate
 *  follow-on and is intentionally not done here. */
export function ProposalReviewPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as {
    proposal?: DashboardProposal;
    authoringRequestId?: string;
  } | null;
  const stateProposal = routeState?.proposal;
  // HEL-401 design.md D4 — additive, alongside `proposal`. Present only when the proposal came
  // from a successful AI-authoring call (AuthoringChatDrawer's "Review & apply"); absent for the
  // pre-existing MCP hand-off and demo-fixture paths, which never carry one — Accept/Reject below
  // skip the new outcome call entirely in that case, unchanged from today's behavior.
  const authoringRequestId = routeState?.authoringRequestId;

  const [dataTypes, setDataTypes] = useState<DataType[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<RequestErrorKind | null>(null);
  // HEL-539: bumped by the Retry action to re-trigger the load effect below;
  // `retrying` drives the button's disabled/"Retrying…" state.
  const [retryToken, setRetryToken] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // F-002: the demo-fixture fallback is a DEV-only convenience for local
  // development/Playwright — never in a production build, regardless of
  // whether `location.state` is empty. A signed-in prod user reaching this
  // route with no state (stale bookmark, back-navigation) gets an explicit
  // "nothing to review" message instead of a live proposal synthesized from
  // their own real data.
  const useDemoFixture = IS_DEV && !stateProposal;

  useEffect(() => {
    if (!useDemoFixture) return;
    let active = true;
    fetchDataTypes()
      .then((types) => {
        if (active) {
          setDataTypes(types);
          setRetrying(false);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          const classified = classifyRequestError(
            err,
            "Could not load DataTypes for this workspace.",
          );
          setLoadError(classified.message);
          setLoadErrorKind(classified.kind);
          setRetrying(false);
        }
      });
    return () => {
      active = false;
    };
    // retryToken deliberately re-triggers this effect on Retry — see
    // handleRetryLoad below.
  }, [useDemoFixture, retryToken]);

  // HEL-539 (design.md D5/task 2.8) — today's single `.catch`-only setter
  // above never resets `loadError`/`loadErrorKind`, so a successful retry
  // would otherwise still render the stale error forever. Clearing them here
  // (in addition to bumping retryToken) guarantees the EmptyState error
  // branch below stops rendering the instant a retry starts, not only once
  // it resolves.
  function handleRetryLoad() {
    setLoadError(null);
    setLoadErrorKind(null);
    setRetrying(true);
    setRetryToken((t) => t + 1);
  }

  const dataTypesById = useMemo<Record<string, ReviewDataType>>(() => {
    const map: Record<string, ReviewDataType> = {};
    for (const dt of dataTypes ?? []) map[dt.id] = { name: dt.name, sourceId: dt.sourceId };
    return map;
  }, [dataTypes]);

  const proposal = useMemo<DashboardProposal | null>(() => {
    if (stateProposal) return stateProposal;
    if (!useDemoFixture || !dataTypes) return null;
    return synthesizeDemoProposal(dataTypes);
  }, [stateProposal, useDemoFixture, dataTypes]);

  const handleAccept = async (edited: DashboardProposal) => {
    setApplying(true);
    setApplyError(null);
    try {
      // The thunk's fulfilled reducer inserts and selects the created dashboard
      // in the same dispatch cycle, so the sidebar list is never stale (HEL-290).
      await dispatch(applyProposal(edited)).unwrap();
      // HEL-401 design.md D4: fired AFTER apply succeeds, only when this proposal came from a
      // successful AI-authoring call — fire-and-forget (telemetry only, never blocks/affects the
      // real navigation below on failure).
      if (authoringRequestId) {
        postAuthoringOutcome(authoringRequestId, "accepted").catch(() => {
          // Telemetry data loss doesn't corrupt or block any real user-facing action — the apply
          // above already completed (design.md's own stated trade-off).
        });
      }
      navigate("/");
    } catch (err) {
      setApplyError(typeof err === "string" ? err : "Failed to apply the proposal.");
      setApplying(false);
    }
  };

  const handleReject = () => {
    // HEL-401 design.md D4: fire-and-forget, closing the one confirmed gap — reject previously had
    // no backend touchpoint at all. Only fires when this proposal came from a successful
    // AI-authoring call, never for the pre-existing MCP/demo entry paths.
    if (authoringRequestId) {
      postAuthoringOutcome(authoringRequestId, "rejected").catch(() => {
        // See handleAccept's identical rationale — telemetry loss is acceptable.
      });
    }
    navigate("/");
  };

  // F-002: no proposal handed off via navigation state, and not a DEV build
  // — there is nothing to review and, unlike the DEV fixture path, no
  // reasonable proposal to synthesize.
  if (!stateProposal && !useDemoFixture) {
    return (
      <PageShell>
        <EmptyState
          icon={faTableColumns}
          title="Nothing to review"
          description="This page reviews a dashboard proposal handed off from another flow. Start from the dashboards list instead."
          cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
        />
      </PageShell>
    );
  }

  if (loadError) {
    const kind = loadErrorKind ?? "error";
    const Icon = ERROR_KIND_ICON[kind];
    const description =
      kind === "not-found"
        ? "We couldn't find this workspace. It may have been deleted, or you may not have access to it."
        : kind === "forbidden"
          ? "You don't have access to this workspace."
          : loadError;
    return (
      <PageShell>
        {/* D5/D7 — this fetch is DEV-only demo-fixture data; Retry only for a generic "error" kind,
            and "Back to dashboards" stays available in every case (secondaryCta renders it alongside
            Retry rather than replacing it). */}
        <PageStatus
          status="failed"
          icon={<Icon />}
          title="Couldn't load the workspace"
          message={description}
          onRetry={kind === "error" ? handleRetryLoad : undefined}
          retrying={retrying}
          secondaryCta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
        />
      </PageShell>
    );
  }

  if (!proposal) {
    return (
      <PageShell>
        <PageStatus status="loading" loadingLabel="Loading proposal" />
      </PageShell>
    );
  }

  if (proposal.panels.length === 0) {
    return (
      <PageShell>
        <EmptyState
          icon={faTableColumns}
          title={EMPTY_WORKSPACE_COPY.title}
          description={EMPTY_WORKSPACE_COPY.description}
          cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <ProposalReview
        proposal={proposal}
        dataTypesById={dataTypesById}
        applying={applying}
        error={applyError}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    </PageShell>
  );
}

/** Build a valid demo proposal from the first pipeline-output DataType, so the
 *  fixture path is always applyable. Returns an empty-panel proposal when the
 *  workspace has no pipeline output yet (the page then shows guidance). */
function synthesizeDemoProposal(dataTypes: DataType[]): DashboardProposal {
  const output = dataTypes.find((dt) => dt.sourceId === null);
  if (!output) return { dashboardName: "Proposed dashboard", panels: [] };

  const fields = output.fields.map((f) => f.name);
  const first = fields[0] ?? "value";
  const second = fields[1] ?? first;

  return {
    dashboardName: `${output.name} overview`,
    panels: [
      {
        title: `Total ${second}`,
        type: "metric",
        dataTypeId: output.id,
        fieldMapping: { value: second, label: first },
        layout: { x: 0, y: 0, w: 4, h: 3 },
      },
      {
        title: `${second} by ${first}`,
        type: "chart",
        dataTypeId: output.id,
        fieldMapping: { xAxis: first, yAxis: second },
        layout: { x: 4, y: 0, w: 8, h: 3 },
      },
      {
        title: `${output.name} table`,
        type: "table",
        dataTypeId: output.id,
        fieldMapping: { columns: fields.join(",") },
        layout: { x: 0, y: 3, w: 12, h: 4 },
      },
    ],
  };
}
