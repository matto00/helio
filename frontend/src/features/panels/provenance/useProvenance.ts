import { useCallback, useEffect, useState } from "react";

import { getCachedProvenance, loadProvenance } from "./provenanceCache";
import type { Provenance } from "./provenanceService";

export type ProvenanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; data: Provenance };

interface Settled {
  key: string;
  nonce: number;
  failed: boolean;
}

/** HEL-1207 — lazy provenance read. Nothing is requested until `enabled` (popover open); a value
 *  already in the shared cache is returned synchronously with no request at all. */
export function useProvenance(
  key: string,
  fetcher: () => Promise<Provenance>,
  enabled: boolean,
): ProvenanceState {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const cached = getCachedProvenance(key);

  useEffect(() => {
    if (!enabled || cached) return;
    let cancelled = false;
    loadProvenance(key, fetcher).then(
      () => {
        if (!cancelled) setSettled({ key, nonce, failed: false });
      },
      () => {
        if (!cancelled) setSettled({ key, nonce, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
    // `fetcher` is a fresh closure every render; the cache key identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, nonce, cached]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  if (!enabled) return { status: "idle" };
  if (cached) return { status: "ready", data: cached };
  if (settled && settled.key === key && settled.nonce === nonce && settled.failed) {
    return { status: "error", retry };
  }
  return { status: "loading" };
}
