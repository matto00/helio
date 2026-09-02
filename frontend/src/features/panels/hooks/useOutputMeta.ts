import { useEffect, useState } from "react";

import { getOutputById } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";

export interface OutputMetaResult {
  output: Output | null;
  isLoading: boolean;
}

/** Fetches an Output's metadata (`kind`/`config`/`schema`, NOT rows — see
 *  `usePanelData` for rows) via `GET /api/outputs/:id`. An `OutputPanel`
 *  placement carries only `outputId`; rendering it kind-aware (chart vs.
 *  table vs. metric, etc.) requires this separate fetch — see design.md's
 *  "Cycle-1 executor finding". Pass `null` for a non-output panel. */
export function useOutputMeta(outputId: string | null): OutputMetaResult {
  const [output, setOutput] = useState<Output | null>(null);
  const [isLoading, setIsLoading] = useState(outputId !== null);

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
    void Promise.resolve().then(() => {
      if (!cancelled) setIsLoading(true);
    });
    void getOutputById(outputId)
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
