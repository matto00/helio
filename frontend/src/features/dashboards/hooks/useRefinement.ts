import { useEffect, useState } from "react";

import { postRefinement, RefinementRequestError } from "../services/refinementService";
import type { AuthoringErrorKind } from "../types/authoring";
import type { RefinementResult, RefinementTarget } from "../types/refinement";

// -- Types ---------------------------------------------------------------

export interface UseRefinementOptions {
  target: RefinementTarget;
  message: string;
  active: boolean;
  /** design.md D3 — omitted for a fresh turn 1 (behaves exactly as before this field existed); set
   *  to a prior turn's returned `RefinementResult.conversationId` to continue refining the same
   *  target. The server owns history/the working patch set entirely — this hook never re-sends
   *  either. */
  conversationId?: string;
}

export interface RefinementState {
  /** True for the duration of the buffered `POST /api/refinements` call. */
  loading: boolean;
  /** Set once a successful response lands. */
  result: RefinementResult | null;
  /** Set once a failed response (or a connection failure) lands. */
  error: string | null;
  /** Mirrors `useDashboardAuthoringStream`'s `errorKind` (HEL-401 design.md D1) — `null` for a
   *  failure outside the four defined categories, or a connection-level failure that never reached
   *  the server. */
  errorKind: AuthoringErrorKind | null;
}

const INITIAL_STATE: RefinementState = {
  loading: false,
  result: null,
  error: null,
  errorKind: null,
};

// -- Hook -----------------------------------------------------------------

/** Buffered (no SSE) request/response state for `POST /api/refinements` (HEL-411) — mirrors
 *  `useDashboardAuthoringStream`'s shape (options in, terminal state out, one attempt per
 *  `active`/`target`/`message`/`conversationId` change) minus the SSE connection/parsing machinery
 *  (design.md Non-Goals — the new endpoint is buffered only): fires `postRefinement` once when
 *  `active` flips true, and resolves straight to a terminal `result`/`error` — no intermediate
 *  progress/status state to track. */
export function useRefinement({
  target,
  message,
  active,
  conversationId,
}: UseRefinementOptions): RefinementState {
  const [state, setState] = useState<RefinementState>(INITIAL_STATE);

  useEffect(() => {
    if (!active) {
      return;
    }

    let unmounted = false;
    setState({ ...INITIAL_STATE, loading: true });

    postRefinement({ target, message, conversationId })
      .then((result) => {
        if (!unmounted) setState({ loading: false, result, error: null, errorKind: null });
      })
      .catch((err) => {
        if (unmounted) return;
        if (err instanceof RefinementRequestError) {
          setState({ loading: false, result: null, error: err.message, errorKind: err.kind });
        } else {
          setState({ loading: false, result: null, error: "Connection failed", errorKind: null });
        }
      });

    return () => {
      unmounted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, target.kind, target.id, message, conversationId]);

  return state;
}
