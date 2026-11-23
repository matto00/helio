// HEL-1095/HEL-1169/HEL-1819 — the compact single-counter form's immediate-step machinery, split out of
// `FormPanelView` (HEL-1618) with no behaviour change: the per-click pending-delta map, the burst/quiesce
// reconciliation and the rejection/indeterminate settle handling.

import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { fetchFieldAggregate } from "../../../sources/services/dataSourceService";
import { extractErrorMessage } from "../../../../services/extractErrorMessage";
import { parseFieldErrors, submitFormPanel } from "../../services/panelService";
import { isDefiniteRejection } from "../../state/classifySubmitFailure";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormPanelConfig, FormSubmitResponse } from "../../types/panel";
import type { useFormPanelValues } from "./useFormPanelValues";

interface UseCompactCounterSubmitArgs {
  schema: DatasetFieldResponse[] | null;
  config: FormPanelConfig;
  panelId: string;
  isFormOwner: boolean;
  values: ReturnType<typeof useFormPanelValues>;
  setAlertText: (text: string) => void;
  setStatusText: (text: string) => void;
  pushDenialToastIfAny: (response: FormSubmitResponse) => void;
}

export function useCompactCounterSubmit({
  schema,
  config,
  panelId,
  isFormOwner,
  values,
  setAlertText,
  setStatusText,
  pushDenialToastIfAny,
}: UseCompactCounterSubmitArgs) {
  // HEL-1095 design.md D9 — the compact counter's per-click pending-delta map, replacing
  // HEL-1087's single-value `submitState === "pending"` reentrancy guard (that guard silently
  // dropped every click after the first in a burst — design-gate round 1). Held in a ref (not
  // state): every read of "is the map still empty right now" must see the value as of the exact
  // moment it's checked, never a value captured by an earlier render's closure — an async
  // settle callback from an EARLIER click otherwise reads a stale snapshot from before a LATER
  // click's own mutation. `pendingCount` mirrors the ref's size purely to trigger a re-render for
  // `aria-busy` (D8) — it is never itself read for a correctness decision.
  const pendingDeltasRef = useRef<Map<object, number>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  // Bumped on EVERY settle (success or failure), never just a success that empties the map
  // (design-gate round 4) — this is what lets a fetch already in flight be invalidated by a
  // sibling click's outcome even when that outcome alone wouldn't have dispatched a new fetch.
  const reconcileGenerationRef = useRef(0);
  // HEL-1819: whether a definite rejection has settled in the CURRENT burst (reset when a click starts with nothing in flight).
  const burstRejectedRef = useRef(false);

  // design.md Decision 1/2/3, HEL-1095 design.md D9 — the compact single-counter-field layout's
  // `+`/`-` handler. Reuses the existing submit path (`submitFormPanel`) directly rather than
  // going through `handleSubmit` above: there is no whole-form validation to run (the counter is
  // the only field, always required, always numeric) and the payload is the DELTA (`±step`), not
  // the field's stored value — unlike `buildSubmitValues`, which sends the field's current value
  // verbatim. Every activation fires its own request immediately (no reentrancy guard — a burst
  // of clicks is genuinely concurrent, tracked via `pendingDeltasRef`), advances the displayed
  // value by `delta` on top of whatever is already shown, and reconciles against the dataset's
  // own server-computed aggregate once the whole burst quiesces (HEL-1095 C1: decoupled from any
  // downstream pipeline run entirely — see design.md D1's owner ruling).
  async function step(direction: 1 | -1) {
    if (!schema) return;

    const field = config.fields[0];
    const step = field.step ?? 1;
    const delta = step * direction;
    const token = {};

    // HEL-1819: a new burst (nothing in flight) starts with no rejection settled in it.
    if (pendingDeltasRef.current.size === 0) burstRejectedRef.current = false;

    flushSync(() => {
      setAlertText("");
      setStatusText("");
    });
    values.adjustNumericValue(field.sourceField, delta);

    pendingDeltasRef.current.set(token, delta);
    setPendingCount(pendingDeltasRef.current.size);

    // HEL-1169 design.md D2 — extracted so it can be called unconditionally from all THREE
    // settle outcomes below (success, definite rejection, indeterminate failure alike), fixing a
    // real correctness gap: scoping this to only two of the three branches means a burst that
    // happens to quiesce on a definite-rejection settle would never reconcile, even when an
    // earlier sibling in the same burst was indeterminate and genuinely needs correcting.
    // `onReconcileFailed` is invoked only when THIS settle emptied the pending map AND the
    // aggregate fetch itself failed — the caller decides whether that's worth surfacing
    // (design.md D4); this helper never does. Applies a fetched aggregate via `reconcileValue`,
    // NEVER `setValue` — `setValue`'s unconditional `externalErrors` clear would otherwise erase
    // a definite rejection's just-set `aria-invalid` state on this SAME settle (design.md D3a).
    async function reconciliationTail(
      onReconcileFailed?: () => void,
      onReconciled?: () => void,
      onQuiescedWithoutReconcile?: () => void,
    ) {
      // Unconditional on every settle, success or failure alike (design-gate round 4) — this is
      // what lets a fetch already dispatched below be invalidated by a LATER sibling click's own
      // outcome, even when that outcome alone doesn't empty the map and so doesn't dispatch a new
      // fetch of its own.
      pendingDeltasRef.current.delete(token);
      reconcileGenerationRef.current += 1;
      setPendingCount(pendingDeltasRef.current.size);

      // Quiesce-gated: fetch the authoritative aggregate ONLY when THIS settle is the one that
      // empties the map (design-gate round 2 — fetching on every success let a still-in-flight
      // sibling's already-committed write get double-corrected by a second, later fetch, a
      // visible backward snap). A response is only ever sent after its write commits, so once the
      // LAST outstanding request in a burst is processed here, every request in that burst has
      // already committed — the aggregate this fetch reads back is guaranteed to include all of
      // them.
      if (pendingDeltasRef.current.size === 0 && !isFormOwner) {
        // HEL-1784: a user who is not the form's owner may not read the dataset's aggregate, so there is nothing to
        // reconcile against. The tally stays their own clicks; an indeterminate click says it could not be confirmed.
        onReconcileFailed?.();
        // HEL-1618: a non-owner never reconciles, so "this burst quiesced" is the only signal it has; the caller
        // decides whether that clears an earlier burst's stale field error (owner reconcile semantics unchanged).
        onQuiescedWithoutReconcile?.();
      } else if (pendingDeltasRef.current.size === 0) {
        const myGen = reconcileGenerationRef.current;
        try {
          const aggregate = await fetchFieldAggregate(config.dataSourceId, field.sourceField);
          // Applied only if NOTHING has settled since this fetch was dispatched (the generation
          // check — design-gate round 4) AND the map is still empty right now (design-gate round
          // 3, a brand-new click racing this fetch's own round trip). Either condition failing
          // means the fetch's triggering condition no longer holds by the time it resolves, so
          // its result is stale and must be discarded rather than overwrite a newer optimistic
          // value — the click(s) that invalidated it will themselves drive a fresh reconciliation
          // once they settle.
          if (myGen === reconcileGenerationRef.current && pendingDeltasRef.current.size === 0) {
            values.reconcileValue(field.sourceField, String(aggregate.value));
            onReconciled?.();
          }
        } catch {
          onReconcileFailed?.();
        }
      }
    }

    try {
      const response = await submitFormPanel(panelId, { [field.sourceField]: delta }, {});
      setStatusText("The row was added.");
      pushDenialToastIfAny(response);
      // HEL-1169 design.md D3 (round-1 design-gate CR3) — clears any stale rejection error
      // UNCONDITIONALLY, independent of whether this settle's own trailing reconciliation fetch
      // below succeeds: relying on `reconcileValue`'s incidental non-clearing would leave a stale
      // `aria-invalid` across a later successful click whose own fetch happens to fail.
      values.setExternalErrors({});
      // No `onReconcileFailed` here — a failed trailing fetch after a KNOWN-successful write
      // stays silent, exactly as before this ticket (nothing was ever in doubt).
      await reconciliationTail();
    } catch (err) {
      if (isDefiniteRejection(err)) {
        // Definite rejection: the server (or an intermediate proxy) answered, so the write is
        // known NOT to have committed. Relative rollback — subtract only THIS click's own delta
        // from the CURRENT displayed value, never revert to an absolute snapshot (HEL-1087's
        // original approach, wrong once a sibling click can be concurrently in flight: an earlier
        // snapshot may no longer reflect a sibling's contribution that has since landed —
        // design.md D9).
        values.adjustNumericValue(field.sourceField, -delta);
        const serverFieldErrors = parseFieldErrors(err);
        const message =
          serverFieldErrors.length > 0
            ? serverFieldErrors.map((e) => e.reason).join(" ")
            : extractErrorMessage(err, "The submit could not be completed. Please try again.");
        setAlertText(message);
        // HEL-1169 design.md D3 — associates the rejection with the control itself
        // (`aria-invalid`/`aria-describedby`), matching what `handleSubmit` already does via
        // `setExternalErrors` on its own rejection path (today the compact counter never did).
        values.setExternalErrors({ [field.sourceField]: message });
        burstRejectedRef.current = true;
        // No `onReconcileFailed` here (design.md D4) — a failed trailing fetch must never
        // overwrite this rejection's own already-announced error text.
        await reconciliationTail();
      } else {
        // Indeterminate: no HTTP exchange completed at all, so whether the write actually
        // committed is genuinely unknown — rolling back here could revert an already-persisted
        // write (the lost-ack case HEL-1169 exists to fix). Never adjust the optimistic value
        // directly; once the burst quiesces, `reconciliationTail` fetches the dataset's own
        // authoritative aggregate and replaces the (possibly-wrong) optimistic tally with it. If
        // that reconciliation fetch ALSO fails, the optimistic value is left as-is (never
        // silently discarded) and the assertive region announces that it could not be confirmed —
        // distinct wording from a definite rejection's own error.
        // HEL-1819 (owner ruling, owner reconcile) and HEL-1618 (non-owner, whose burst never reconciles: no
        // editor-readable aggregate): a rejection from an EARLIER burst left a field error that nothing clears once
        // this burst settles. A rejection settled in THIS burst keeps its error (HEL-1169 D3a). The two callbacks stay
        // separate arguments (`onReconciled` means "a fetched total was applied" and is owner-only); they share the clear.
        const clearStaleRejectionError = () => {
          if (!burstRejectedRef.current) values.setExternalErrors({});
        };
        await reconciliationTail(
          () => {
            setAlertText("Couldn't confirm the current value. It may not be up to date.");
          },
          clearStaleRejectionError,
          clearStaleRejectionError,
        );
      }
    }
  }

  return { step, busy: pendingCount > 0 };
}
