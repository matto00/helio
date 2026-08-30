import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { faTableColumns } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { IS_DEV } from "../../../config/env";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { fetchDashboards } from "../../dashboards/services/dashboardService";
import { fetchPanels } from "../../panels/services/panelService";
import { dismissToast } from "../../toasts/state/toastsSlice";
import { useToast } from "../../toasts/hooks/useToast";
import { applyPatchSet, previewPatchSet, undoPatchSet } from "../state/patchSetsSlice";
import { PatchSetReview } from "./PatchSetReview";
import type { PatchSet, PatchSetPreviewResponse } from "../types/patchSet";

/** Route container for the Patch Set Review UI (HEL-408), mirroring
 *  `ProposalReviewPage.tsx`'s ACTUAL structure (verified against its own git
 *  history, not a "component shipped unwired" precedent — design.md D6).
 *
 *  The patch set comes from either (a) router `location.state.patchSet`
 *  (the future NL-authored-refinement caller this ticket's own Non-Goal
 *  leaves out of scope) or (b) — DEV builds only (F-002) — a small,
 *  genuinely-applyable demo patch set synthesized from the first dashboard's
 *  first panel, the fixture path used for local development and Playwright,
 *  mirroring `ProposalReviewPage`'s own `synthesizeDemoProposal`
 *  bootstrapping precedent for the identical "no real producer yet" problem.
 *  This route sits inside `ProtectedRoute` with no other gate, so — like
 *  `ProposalReviewPage` — a signed-in production user landing here with no
 *  `location.state` used to get a live, applyable patch set synthesized from
 *  their own real data instead of a "nothing to review" message (F-002). */
export function PatchSetReviewPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { push: pushToast } = useToast();
  const location = useLocation();
  const routeState = location.state as { patchSet?: PatchSet } | null;
  const statePatchSet = routeState?.patchSet;
  const useDemoFixture = IS_DEV && !statePatchSet;

  const [demoPatchSet, setDemoPatchSet] = useState<PatchSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PatchSetPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const patchSet = statePatchSet ?? demoPatchSet;

  useEffect(() => {
    if (!useDemoFixture) return;
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
  }, [useDemoFixture]);

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
      const response = await dispatch(applyPatchSet(patchSet)).unwrap();
      // design.md D6: `applicationId` is present exactly when this apply was
      // successfully journaled — only then is there anything for the "Undo"
      // action to restore. `duration: 0` is REQUIRED here (not the shared
      // `Toast` component's 4000ms default) — the default would auto-dismiss
      // roughly 4 seconds after the user is already mid-navigation away from
      // this page, defeating the whole point of offering Undo.
      if (response.applicationId) {
        const applicationId = response.applicationId;
        // design.md D6: "dismissed only by an explicit close/Undo click, or the next successful
        // apply's toast replacing it" — `toastId` (returned synchronously by `pushToast`'s
        // `prepare` callback, skeptic-final-1.md CR2) lets the Undo action dismiss THIS exact
        // toast itself, rather than leaving a stale, still-clickable "Undo" affordance around
        // (duration: 0 means it would otherwise never auto-dismiss).
        const toastId = pushToast({
          variant: "success",
          message: "Applied.",
          duration: 0,
          action: {
            label: "Undo",
            onClick: () => {
              dispatch(dismissToast(toastId));
              dispatch(undoPatchSet({ applicationId, patchSet }))
                .unwrap()
                .then(() => {
                  pushToast({ variant: "success", message: "Undone." });
                })
                .catch((err) => {
                  pushToast({
                    variant: "error",
                    message: typeof err === "string" ? err : "Failed to undo the patch set.",
                  });
                });
            },
          },
        });
      }
      navigate("/");
    } catch (err) {
      setApplyError(typeof err === "string" ? err : "Failed to apply the patch set.");
      setApplying(false);
    }
  };

  const handleReject = () => navigate("/");

  // F-002: no patch set handed off via navigation state, and not a DEV build
  // — there is nothing to review and, unlike the DEV fixture path, no
  // reasonable patch set to synthesize.
  if (!statePatchSet && !useDemoFixture) {
    return (
      <PageShell>
        <EmptyState
          icon={faTableColumns}
          title="Nothing to review"
          description="This page reviews a patch set handed off from another flow. Start from the dashboards list instead."
          cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
        />
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell>
        <PageStatus
          status="failed"
          title="Couldn't build a patch set"
          message={loadError}
          secondaryCta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
        />
      </PageShell>
    );
  }

  if (previewError) {
    return (
      <PageShell>
        <PageStatus
          status="failed"
          title="Couldn't preview this patch set"
          message={previewError}
          secondaryCta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
        />
      </PageShell>
    );
  }

  if (!patchSet || !preview) {
    return (
      <PageShell>
        <PageStatus status="loading" loadingLabel="Loading patch set preview" />
      </PageShell>
    );
  }

  if (patchSet.edits.length === 0) {
    return (
      <PageShell>
        <EmptyState
          icon={faTableColumns}
          title="No patch set to review"
          description="Create a dashboard with at least one panel so a patch set can be built over it, then try again."
          cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PatchSetReview
        preview={preview}
        applying={applying}
        error={applyError}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    </PageShell>
  );
}

// F-002: strips a prior "(previewed)" suffix before re-appending it, so
// repeated dev/test triggers against the same panel stay idempotent instead
// of stacking " (previewed) (previewed) (previewed)…" — mirrors the same
// baseTitle/copyTitleRegex pattern `PanelMutationRepository` already uses on
// the backend for the real panel-duplicate action, for the identical reason.
const PREVIEWED_SUFFIX_RE = / \(previewed\)$/;

// Exported for a focused regression test (F-002) — the demo-fixture path
// itself only runs in DEV builds, unreachable under Jest (`config/env`'s
// `IS_DEV` is mocked `false`; see `PatchSetReviewPage.test.tsx`).
export function baseTitle(title: string): string {
  return title.replace(PREVIEWED_SUFFIX_RE, "");
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

  const title = baseTitle(firstPanel.title);

  return {
    summary: `Rename "${title}"`,
    edits: [
      {
        target: { kind: "panel", id: firstPanel.id },
        op: "update",
        patch: { title: `${title} (previewed)` },
      },
    ],
  };
}
