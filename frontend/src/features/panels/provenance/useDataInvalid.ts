import { useEffect, useState } from "react";

import { getAssertionStatusShared, subscribeProvenanceInvalidation } from "./provenanceCache";

/** HEL-1207 A4 — whether the "Invalid data" badge shows for an output.
 *
 *  Always driven by the (per-output deduped) assertion-status read, never derived from the
 *  provenance cache: a cache entry can be older than the read, and the badge must not follow it.
 *  When a run event evicts the provenance cache the status is re-read, so the badge also tracks
 *  a run that happened while the page was open. */
export function useDataInvalid(outputId: string | null): boolean {
  const [fromStatus, setFromStatus] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => subscribeProvenanceInvalidation(() => setNonce((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    if (!outputId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setFromStatus(false);
      });
    } else {
      getAssertionStatusShared(outputId).then(
        (status) => {
          if (!cancelled) setFromStatus(status.invalid);
        },
        () => {
          if (!cancelled) setFromStatus(false);
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [outputId, nonce]);

  return fromStatus;
}
