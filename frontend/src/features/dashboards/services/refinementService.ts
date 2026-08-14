import { isAxiosError } from "axios";

import { httpClient } from "../../../services/httpClient";
import type { AuthoringErrorKind } from "../types/authoring";
import type { RefinementRequest, RefinementResult } from "../types/refinement";

/** `POST /api/refinements` (HEL-411) — a target dashboard/pipeline's live state, grounded and
 *  turned into a validated `PatchSet`. Buffered only (design.md Non-Goals — no SSE variant, unlike
 *  `authoringService.ts`'s `AUTHORING_DASHBOARD_ENDPOINT`), so the fetch itself lives here
 *  (mirrors `patchSetService.ts`'s plain `httpClient.post` shape) rather than being pushed into the
 *  hook. This module holds only the endpoint path, the fetch, and the wire types — no UI state. */
export const REFINEMENTS_ENDPOINT = "/api/refinements";

/** Normalized failure `postRefinement` throws — mirrors the shape `useDashboardAuthoringStream`
 *  extracts from an SSE `authoring-error` event's `{message, kind?}` body, but sourced from a
 *  buffered HTTP error response's JSON body instead (`AuthoringErrorResponse`/`ErrorResponse` on the
 *  backend — `RefinementRoutes` reuses `AuthoringErrorKind`, design.md D5). `kind` is `null` for a
 *  failure outside the four defined categories (e.g. a missing/foreign conversationId) or a
 *  connection-level failure that never reached the server. */
export class RefinementRequestError extends Error {
  readonly kind: AuthoringErrorKind | null;

  constructor(message: string, kind: AuthoringErrorKind | null) {
    super(message);
    this.name = "RefinementRequestError";
    this.kind = kind;
  }
}

export async function postRefinement(request: RefinementRequest): Promise<RefinementResult> {
  try {
    const response = await httpClient.post<RefinementResult>(REFINEMENTS_ENDPOINT, request);
    return response.data;
  } catch (err) {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { message?: string; kind?: AuthoringErrorKind }
        | undefined;
      if (typeof data?.message === "string") {
        throw new RefinementRequestError(data.message, data.kind ?? null);
      }
    }
    throw new RefinementRequestError("Connection failed", null);
  }
}

export type { RefinementRequest, RefinementResult, RefinementTarget } from "../types/refinement";
