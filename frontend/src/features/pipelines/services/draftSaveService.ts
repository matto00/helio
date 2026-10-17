import { isAxiosError } from "axios";

import { httpClient } from "../../../services/httpClient";
import type { DraftSaveConflict, DraftSaveRequest, DraftSaveResponse } from "../types/draftSave";
import type { PipelineSummary } from "../types/pipelineStep";

// HEL-1629: the atomic draft save (docs/live-draft-preview.md section 8). Service functions only: no component calls them
// yet (the draft editor is HEL-1631), and there is deliberately no force/overwrite variant -- a stale base is answered by
// reloading the saved pipeline (`getPipelineWithDefinition`) and re-applying the draft as a diff.

/** The pipeline with its `fingerprint` and, from the SAME snapshot, the steps and Outputs the fingerprint was computed from:
 *  the read a draft is based on. */
export async function getPipelineWithDefinition(pipelineId: string): Promise<PipelineSummary> {
  const response = await httpClient.get<PipelineSummary>(`/api/pipelines/${pipelineId}`, {
    params: { definition: true },
  });
  return response.data;
}

/** Saves the whole draft in ONE call. Rejects with the original axios error on any non-2xx; use
 *  `extractDraftSaveConflict` to tell a stale base or an unconfirmed cascade from a validation failure. */
export async function saveDraft(
  pipelineId: string,
  request: DraftSaveRequest,
): Promise<DraftSaveResponse> {
  const response = await httpClient.post<DraftSaveResponse>(
    `/api/pipelines/${pipelineId}/draft/save`,
    request,
  );
  return response.data;
}

/** Narrows a failed save to the two conflicts a client acts on: 409 `PATCH_SET_STALE` (reload the saved pipeline) and 422
 *  `CASCADE_CONFIRMATION_REQUIRED` (confirm the listed removals). Null for every other failure. */
export function extractDraftSaveConflict(err: unknown): DraftSaveConflict | null {
  if (!isAxiosError(err)) return null;
  const data = err.response?.data as Record<string, unknown> | undefined;
  if (data?.code === "PATCH_SET_STALE" && Array.isArray(data.staleTargets)) {
    return {
      kind: "stale",
      currentFingerprint:
        typeof data.currentFingerprint === "string" ? data.currentFingerprint : null,
      staleTargets: data.staleTargets as { index: number; kind: string; id: string }[],
    };
  }
  const impact = data?.impact as Record<string, unknown> | undefined;
  if (data?.code === "CASCADE_CONFIRMATION_REQUIRED" && impact) {
    const list = (key: string): string[] =>
      Array.isArray(impact[key]) ? (impact[key] as string[]) : [];
    return {
      kind: "cascadeRequired",
      impact: {
        stepIds: list("stepIds"),
        outputIds: list("outputIds"),
        panelIds: list("panelIds"),
        alertRuleIds: list("alertRuleIds"),
        hints: list("hints"),
      },
    };
  }
  return null;
}
