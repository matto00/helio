import { useEffect, useRef, useState } from "react";

import { fetchOutputMeta, getOutputMetaCached } from "../state/outputMetaCache";
import type { Output } from "../../pipelines/types/output";

export interface OutputMetaResult {
  output: Output | null;
  isLoading: boolean;
}

/** Fetches an Output's metadata (`kind`/`config`/`schema`, NOT rows — see
 *  `usePanelData` for rows) via `GET /api/outputs/:id`. An `OutputPanel`
 *  placement carries only `outputId`; rendering it kind-aware (chart vs.
 *  table vs. metric, etc.) requires this separate fetch — see design.md's
 *  "Cycle-1 executor finding". Pass `null` for a non-output panel.
 *
 *  HEL-1392 — results are shared through `outputMetaCache`: concurrent consumers of one Output
 *  issue a single request, and a card remounting while its Output is still retained starts with the
 *  held value (no request, no loading flash). */
export function useOutputMeta(outputId: string | null): OutputMetaResult {
  const [output, setOutput] = useState<Output | null>(
    () => (outputId ? getOutputMetaCached(outputId) : undefined) ?? null,
  );
  const [isLoading, setIsLoading] = useState(() =>
    outputId === null ? false : getOutputMetaCached(outputId) === undefined,
  );

  // HEL-1380 — mirrors the committed state so the effect below can skip queuing an update whose
  // value equals it (React bails out of committing such an update but still re-invokes the
  // component). Synced in an effect declared BEFORE the fetch effect, so the fetch effect reads
  // the state committed for the render that triggered it; never written during render.
  const committed = useRef({ output, isLoading });
  useEffect(() => {
    committed.current = { output, isLoading };
  });

  useEffect(() => {
    let cancelled = false;
    if (!outputId) {
      // Resolve asynchronously (not a synchronous setState call inside the
      // effect body) so switching a panel away from an Output still clears
      // a previously-fetched one.
      // Skipped entirely when state already is the cleared state (a null mount).
      if (committed.current.output !== null || committed.current.isLoading) {
        void Promise.resolve().then(() => {
          if (!cancelled) {
            setOutput(null);
            setIsLoading(false);
          }
        });
      }
      return () => {
        cancelled = true;
      };
    }
    // Only queued when not already loading (a cache-miss mount starts loading); a switch from a
    // loaded/absent Output to an uncached one still flips to loading.
    if (getOutputMetaCached(outputId) === undefined && !committed.current.isLoading) {
      void Promise.resolve().then(() => {
        if (!cancelled) setIsLoading(true);
      });
    }
    void fetchOutputMeta(outputId)
      .then((result) => {
        if (!cancelled) {
          setOutput(result);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOutput(null);
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [outputId]);

  return { output, isLoading };
}
