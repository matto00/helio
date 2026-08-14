import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { faTableColumns } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { fetchDataTypes } from "../../dataTypes/services/dataTypeService";
import type { DataType } from "../../dataTypes/types/dataType";
import { postAuthoringOutcome } from "../services/authoringService";
import { applyProposal } from "../state/dashboardsSlice";
import { EMPTY_WORKSPACE_COPY } from "../utils/emptyWorkspaceCopy";
import { ProposalReview, type ReviewDataType } from "./ProposalReview";
import type { DashboardProposal } from "../types/proposal";

/** Route container for the Proposal Review UI (HEL-224).
 *
 *  The proposal comes from either (a) router `location.state.proposal` (e.g.
 *  produced by the MCP `propose_dashboard` tool and handed to the app) or
 *  (b) a demo proposal synthesized from the first pipeline-output DataType in
 *  the workspace — the fixture path used for development and Playwright, kept
 *  valid so Accept actually applies. Wiring an in-app natural-language → Claude
 *  author for the proposal is a deliberate follow-on and is intentionally not
 *  done here. */
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
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchDataTypes()
      .then((types) => {
        if (active) setDataTypes(types);
      })
      .catch(() => {
        if (active) setLoadError("Could not load DataTypes for this workspace.");
      });
    return () => {
      active = false;
    };
  }, []);

  const dataTypesById = useMemo<Record<string, ReviewDataType>>(() => {
    const map: Record<string, ReviewDataType> = {};
    for (const dt of dataTypes ?? []) map[dt.id] = { name: dt.name, sourceId: dt.sourceId };
    return map;
  }, [dataTypes]);

  const proposal = useMemo<DashboardProposal | null>(() => {
    if (stateProposal) return stateProposal;
    if (!dataTypes) return null;
    return synthesizeDemoProposal(dataTypes);
  }, [stateProposal, dataTypes]);

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

  if (loadError) {
    return (
      <EmptyState
        icon={faTableColumns}
        title="Couldn't load the workspace"
        description={loadError}
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    );
  }

  if (!proposal) {
    return (
      <div className="proposal-review__loading" aria-busy="true" aria-label="Loading proposal" />
    );
  }

  if (proposal.panels.length === 0) {
    return (
      <EmptyState
        icon={faTableColumns}
        title={EMPTY_WORKSPACE_COPY.title}
        description={EMPTY_WORKSPACE_COPY.description}
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    );
  }

  return (
    <ProposalReview
      proposal={proposal}
      dataTypesById={dataTypesById}
      applying={applying}
      error={applyError}
      onAccept={handleAccept}
      onReject={handleReject}
    />
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
