import { useEffect, useState } from "react";

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

  useEffect(() => {
    let cancelled = false;
    if (!outputId) {
      // Resolve asynchronously (not a synchronous setState call inside the
      // effect body) so switching a panel away from an Output still clears
      // a previously-fetched one.
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setOutput(null);
          setIsLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    if (getOutputMetaCached(outputId) === undefined) {
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
