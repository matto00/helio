import { useEffect, useMemo, useReducer, useRef } from "react";

import { decodeRow } from "../evaluator/wire";
import { createDraftPreviewScheduler } from "../services/draftPreviewScheduler";
import type { DraftPreviewScheduler } from "../services/draftPreviewScheduler";
import { postDraftPreview } from "../services/draftPreviewClient";
import type { BuiltDraftPreview } from "../state/draftPreviewRequest";
import { NO_TRANSPORT, type ServerStepResult, type TransportView } from "../state/draftStepView";
import type { DraftPreviewLine, DraftPreviewRequest } from "../types/draftPreview";

const FAILED_COPY = "Preview unavailable. It will retry on your next change.";

interface State {
  /** The request key the answers below belong to. */
  key: string | null;
  results: ReadonlyMap<string, ServerStepResult>;
  rows: TransportView["rows"];
  ended: boolean;
  failure: TransportView["failure"];
}

type Action =
  | { type: "sent"; key: string }
  | { type: "line"; key: string; line: DraftPreviewLine }
  | { type: "settled"; key: string }
  | { type: "failed"; key: string; failure: NonNullable<TransportView["failure"]> }
  | { type: "reset" };

const INITIAL: State = { key: null, results: new Map(), rows: null, ended: false, failure: null };

function reducer(state: State, action: Action): State {
  if (action.type === "reset") return INITIAL;
  if (action.type === "sent") {
    return { key: action.key, results: new Map(), rows: null, ended: false, failure: null };
  }
  if (action.type === "failed") {
    return action.key === state.key
      ? { ...state, ended: true, failure: action.failure }
      : { ...INITIAL, key: action.key, ended: true, failure: action.failure };
  }
  if (action.key !== state.key) return state;
  if (action.type === "settled") return { ...state, ended: true };
  const line = action.line;
  switch (line.type) {
    case "step":
      return withResult(state, line.step, { kind: "ok", count: line.count });
    case "error":
      return withResult(state, line.step, { kind: "error", message: line.message });
    case "unavailable":
      return withResult(state, line.step, { kind: "unavailable", reason: line.reason });
    case "rows":
      return line.step !== null && line.available
        ? { ...state, rows: { stepId: line.step, rows: line.rows.map(decodeRow) } }
        : state;
    case "failed":
      return { ...state, ended: true, failure: { kind: "failed", message: FAILED_COPY } };
  }
}

function withResult(state: State, stepId: string, result: ServerStepResult): State {
  const results = new Map(state.results);
  results.set(stepId, result);
  return { ...state, results };
}

/**
 * HEL-1631 (design.md D4): one `createDraftPreviewScheduler` per page, alive only while a draft exists. The scheduler paces the
 * requests (debounce, single-flight, the 600 ms floor, `429 Retry-After`); this hook just feeds it the latest request and turns
 * its callbacks into the view the status mapping reads. Nothing here ever calls a run endpoint, so the HEL-505 run guard is
 * never consumed, and with no draft nothing is sent.
 */
export function useDraftPreviewTransport({
  pipelineId,
  enabled,
  built,
}: {
  pipelineId: string;
  /** A draft exists. */
  enabled: boolean;
  /** `null` when every step is client-evaluable. */
  built: BuiltDraftPreview | null;
}): TransportView {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const schedulerRef = useRef<DraftPreviewScheduler | null>(null);
  const keyByRequest = useRef(new WeakMap<DraftPreviewRequest, string>());
  const latestKey = useRef<string | null>(null);
  const firedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || pipelineId === "") return undefined;
    const scheduler = createDraftPreviewScheduler({
      pipelineId,
      send: (pid, request, signal) => {
        const key = keyByRequest.current.get(request) ?? "";
        firedKey.current = key;
        dispatch({ type: "sent", key });
        return postDraftPreview(pid, request, signal);
      },
      onLine: (line) => {
        if (firedKey.current !== null) dispatch({ type: "line", key: firedKey.current, line });
      },
      onSettled: () => {
        if (firedKey.current !== null) dispatch({ type: "settled", key: firedKey.current });
      },
      onError: () => {
        if (firedKey.current !== null)
          dispatch({
            type: "failed",
            key: firedKey.current,
            failure: { kind: "failed", message: FAILED_COPY },
          });
      },
      onTooLarge: (cap) => {
        if (latestKey.current !== null)
          dispatch({
            type: "failed",
            key: latestKey.current,
            failure: {
              kind: "tooLarge",
              message: `Too large to preview before saving (${cap}). It runs on Save & run.`,
            },
          });
      },
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
      latestKey.current = null;
      firedKey.current = null;
      dispatch({ type: "reset" });
    };
  }, [enabled, pipelineId]);

  const builtKey = built?.key ?? null;
  useEffect(() => {
    if (!enabled || built === null) return;
    keyByRequest.current.set(built.request, built.key);
    latestKey.current = built.key;
    schedulerRef.current?.update(built.request);
    // `built` is rebuilt from the same inputs whenever its key changes; the key is the change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, builtKey]);

  return useMemo<TransportView>(() => {
    if (!enabled || builtKey === null) return NO_TRANSPORT;
    const answered = state.key === builtKey;
    return {
      pending: !(answered && state.ended),
      results: answered ? state.results : NO_TRANSPORT.results,
      rows: answered ? state.rows : null,
      failure: answered ? state.failure : null,
    };
  }, [enabled, builtKey, state]);
}
