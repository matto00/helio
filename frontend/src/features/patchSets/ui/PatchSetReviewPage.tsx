import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { faTableColumns } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { fetchDashboards } from "../../dashboards/services/dashboardService";
import { fetchPanels } from "../../panels/services/panelService";
import { applyPatchSet, previewPatchSet } from "../state/patchSetsSlice";
import { PatchSetReview } from "./PatchSetReview";
import type { PatchSet, PatchSetPreviewResponse } from "../types/patchSet";

/** Route container for the Patch Set Review UI (HEL-408), mirroring
 *  `ProposalReviewPage.tsx`'s ACTUAL structure (verified against its own git
 *  history, not a "component shipped unwired" precedent — design.md D6).
 *
 *  The patch set comes from either (a) router `location.state.patchSet`
 *  (the future NL-authored-refinement caller this ticket's own Non-Goal
 *  leaves out of scope) or (b) a small, genuinely-applyable demo patch set
 *  synthesized from the first dashboard's first panel — the fixture path
 *  used for development and Playwright, kept valid so Accept actually
 *  applies, mirroring `ProposalReviewPage`'s own `synthesizeDemoProposal`
 *  bootstrapping precedent for the identical "no real producer yet"
 *  problem. */
export function PatchSetReviewPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { patchSet?: PatchSet } | null;
  const statePatchSet = routeState?.patchSet;

  const [demoPatchSet, setDemoPatchSet] = useState<PatchSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PatchSetPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const patchSet = statePatchSet ?? demoPatchSet;

  useEffect(() => {
    if (statePatchSet) return;
    let active = true;
    synthesizeDemoPatchSet()
      .then((ps) => {
        if (active) setDemoPatchSet(ps);
      })
      .catch(() => {
        if (active) setLoadError("Could not build a demo patch set for this workspace.");
      });
    return () => {
      active = false;
    };
  }, [statePatchSet]);

  useEffect(() => {
    if (!patchSet) return;
    let active = true;
    dispatch(previewPatchSet(patchSet))
      .unwrap()
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((err) => {
        if (active) {
          setPreviewError(typeof err === "string" ? err : "Failed to preview the patch set.");
        }
      });
    return () => {
      active = false;
    };
  }, [patchSet, dispatch]);

  const handleAccept = async () => {
    if (!patchSet) return;
    setApplying(true);
    setApplyError(null);
    try {
      await dispatch(applyPatchSet(patchSet)).unwrap();
      navigate("/");
    } catch (err) {
      setApplyError(typeof err === "string" ? err : "Failed to apply the patch set.");
      setApplying(false);
    }
  };

  const handleReject = () => navigate("/");

  if (loadError) {
    return (
      <EmptyState
        icon={faTableColumns}
        title="Couldn't build a patch set"
        description={loadError}
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    );
  }

  if (previewError) {
    return (
      <EmptyState
        icon={faTableColumns}
        title="Couldn't preview this patch set"
        description={previewError}
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    );
  }

  if (!patchSet || !preview) {
    return (
      <div
        className="patch-set-review__loading"
        aria-busy="true"
        aria-label="Loading patch set preview"
      />
    );
  }

  if (patchSet.edits.length === 0) {
    return (
      <EmptyState
        icon={faTableColumns}
        title="No patch set to review"
        description="Create a dashboard with at least one panel so a patch set can be built over it, then try again."
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    );
  }

  return (
    <PatchSetReview
      preview={preview}
      applying={applying}
      error={applyError}
      onAccept={handleAccept}
      onReject={handleReject}
    />
  );
}

/** Build a small, genuinely-applyable demo patch set: a single title-only
 *  `update` edit against the first dashboard's first panel (design.md D6).
 *  Returns an edit-less patch set when the workspace has no dashboard/panel
 *  yet — the page then shows guidance instead of an empty review modal. */
async function synthesizeDemoPatchSet(): Promise<PatchSet> {
  const dashboards = await fetchDashboards();
  const firstDashboard = dashboards[0];
  if (!firstDashboard) return { edits: [] };

  const panels = await fetchPanels(firstDashboard.id);
  const firstPanel = panels[0];
  if (!firstPanel) return { edits: [] };

  return {
    summary: `Rename "${firstPanel.title}"`,
    edits: [
      {
        target: { kind: "panel", id: firstPanel.id },
        op: "update",
        patch: { title: `${firstPanel.title} (previewed)` },
      },
    ],
  };
}
