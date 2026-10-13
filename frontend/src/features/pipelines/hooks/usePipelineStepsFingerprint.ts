import { useLayoutEffect } from "react";
import type { MutableRefObject } from "react";

import type { Step } from "../types/step";

/**
 * The steps-shape fingerprint (and the ref mirroring it) extracted from `usePipelineDetailPage`
 * (HEL-1501). Moved verbatim.
 */
export function usePipelineStepsFingerprint({
  steps,
  pendingDraftIds,
  stepsFingerprintRef,
}: {
  steps: Step[];
  pendingDraftIds: ReadonlySet<string>;
  stepsFingerprintRef: MutableRefObject<string>;
}) {
  // Re-run /analyze whenever the steps change (add / remove / config edit) so
  // each StepCard's inputSchema (and the available-fields hints inside the op
  // editors) stays in sync without a manual refresh. Debounced so a stream of
  // keystrokes in a TextField doesn't fire a request per character.
  // We key on the SHAPE of steps (id, op, config) — not the array reference —
  // so transient setState calls that don't change content don't trigger
  // re-analyze.
  // Serialize the typed config for the fingerprint — JSON.stringify here
  // is purely a comparison-shape helper, not a wire-format serialization.
  // HEL-412 (design.md Decision 8): `enabled` is folded in too — a toggle
  // changes the analyze endpoint's step list (a disabled step drops out
  // entirely), so it must re-trigger analyze exactly like a config edit does.
  // HEL-1109 (design.md Risks) — a not-yet-created AI draft (still a local
  // temp id, per `pendingDraftIds`) is excluded entirely: it has no
  // server-side representation yet for /analyze to reflect, so folding it in
  // would either 404 the analyze call or dispatch one for a step the backend
  // has never seen.
  const stepsFingerprint = steps
    .filter((s) => !pendingDraftIds.has(s.id))
    .map((s) => `${s.id}:${s.opType.id}:${s.enabled}:${JSON.stringify(s.config)}`)
    .join("|");
  useLayoutEffect(() => {
    stepsFingerprintRef.current = stepsFingerprint;
  });

  return stepsFingerprint;
}
