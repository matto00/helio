import { httpClient } from "../../../services/httpClient";
import type { PatchSet, PatchSetApplyResponse, PatchSetPreviewResponse } from "../types/patchSet";

/** Compute a patch set's before/after diff + impact hints WITHOUT writing
 *  anything (HEL-408). Mirrors `proposalService.applyDashboardProposal`'s
 *  exact `httpClient.post` shape. */
export async function previewPatchSet(patchSet: PatchSet): Promise<PatchSetPreviewResponse> {
  const response = await httpClient.post<PatchSetPreviewResponse>(
    "/api/patch-sets/preview",
    patchSet,
  );
  return response.data;
}

/** Apply an accepted patch set (HEL-406's existing endpoint — no backend
 *  change made by this ticket). Atomic: a mid-set failure rolls back every
 *  already-applied edit. */
export async function applyPatchSet(patchSet: PatchSet): Promise<PatchSetApplyResponse> {
  const response = await httpClient.post<PatchSetApplyResponse>("/api/patch-sets/apply", patchSet);
  return response.data;
}
