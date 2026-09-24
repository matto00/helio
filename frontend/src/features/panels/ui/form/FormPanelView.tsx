// HEL-1085/HEL-1087 design.md D2/D6/D7/D8 — the configured-form body: fetches the bound dataset's
// declared schema (required is tighten-only, so config alone can never render correctly), shows
// the established loading/failure states while doing so, then renders one `FormFieldControl` per
// authored field plus a submit button, submit-time validation, and success/error/network states.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import "./FormPanel.css";
import "./CounterControl.css";
import { PanelBodySkeleton } from "../PanelBodySkeleton";
import { InlineError } from "../../../../shared/chrome/InlineError";
import {
  fetchDatasetSchema,
  fetchFieldAggregate,
} from "../../../sources/services/dataSourceService";
import { extractErrorMessage } from "../../../../services/extractErrorMessage";
import { buildDeniedPipelinesToast } from "../../../pipelines/services/deniedPipelinesToast";
import { useRunToUpdate } from "../../../pipelines/hooks/useRunToUpdate";
import { useToast } from "../../../toasts/hooks/useToast";
import { parseFieldErrors, submitFormPanel } from "../../services/panelService";
import { isDefiniteRejection } from "../../state/classifySubmitFailure";
import { computeFormIssues } from "../../state/formConfigValidation";
import {
  buildSubmitFiles,
  buildSubmitValues,
  mapServerFieldErrors,
  validateForSubmit,
} from "../../state/formSubmission";
import { FormFieldControl } from "./FormFieldControl";
import { useFormPanelValues } from "./useFormPanelValues";
import type { DatasetFieldResponse, RowWriteResponse } from "../../../sources/types/dataSource";
import type { FormPanelConfig } from "../../types/panel";

interface FormPanelViewProps {
  title: string;
  panelId: string;
  config: FormPanelConfig;
}

type SubmitState = "idle" | "pending" | "succeeded" | "failed";

export function FormPanelView({ title, panelId, config }: FormPanelViewProps) {
  const [schema, setSchema] = useState<DatasetFieldResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // HEL-1096 design.md D3/D7 — pushes the denial toast (if any) from a successful write's
  // `deniedPipelines`, and the "Run to update" action's own click behavior.
  const { push: pushToast } = useToast();
  const runToUpdateAction = useRunToUpdate();

  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [alertText, setAlertText] = useState("");
  const [statusText, setStatusText] = useState("");
  // A pending focus move, consumed (and cleared) by the effect below once the triggering
  // render — with `aria-invalid="true"` freshly painted onto the right control — has committed.
  // Held in a ref (not state) so consuming it is a plain mutation, never a second `setState`
  // inside the effect body; `focusTrigger` is the state that actually re-runs the effect, bumped
  // on every request even when the intent value repeats.
  const pendingFocusRef = useRef<"invalid" | "button" | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);

  const formRef = useRef<HTMLFormElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

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

  function requestFocus(intent: "invalid" | "button") {
    pendingFocusRef.current = intent;
    setFocusTrigger((t) => t + 1);
  }

  // HEL-1096 design.md D3: exactly one toast per write, built from `response.deniedPipelines` —
  // a no-op when nothing was denied (or every denial was invisible to the writer, design.md D1).
  function pushDenialToastIfAny(response: RowWriteResponse) {
    const denied = response.deniedPipelines;
    if (denied.length === 0) return;
    const toastId = pushToast(
      buildDeniedPipelinesToast(denied, () => runToUpdateAction(denied[0].pipelineId, toastId)),
    );
  }

  // Re-fetch on mount, on dataset switch, and on retry — mirrors `FormEditor.tsx`'s cancelled-flag
  // effect (design.md D2).
  useEffect(() => {
    let cancelled = false;
    // Deferred via a resolved microtask (mirrors `FormEditor.tsx`'s pattern) so the reset itself
    // is never a synchronous setState call inside the effect body.
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setSchema(null);
        setError(null);
      }
    });
    void fetchDatasetSchema(config.dataSourceId)
      .then((response) => {
        if (!cancelled) setSchema(response.fields);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the dataset's declared schema.");
      });
    return () => {
      cancelled = true;
    };
  }, [config.dataSourceId, retryToken]);

  const issues = schema ? computeFormIssues(config, schema) : [];
  const issuesByField = new Map(issues.map((i) => [i.field, i.message]));
  const declaredByField = new Map((schema ?? []).map((f) => [f.name, f]));

  const values = useFormPanelValues(config.fields, schema ?? []);

  // HEL-1087 design.md D8: perform the deferred focus move once the errors set above has had a
  // chance to paint `aria-invalid="true"` onto the right control.
  useEffect(() => {
    const intent = pendingFocusRef.current;
    if (!intent) return;
    pendingFocusRef.current = null;
    if (intent === "invalid" && formRef.current) {
      const invalidEl = formRef.current.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (invalidEl) {
        invalidEl.focus();
        return;
      }
    }
    submitButtonRef.current?.focus();
  }, [focusTrigger, values.errors]);

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
  async function handleImmediateStep(direction: 1 | -1) {
    if (!schema) return;

    const field = config.fields[0];
    const step = field.step ?? 1;
    const delta = step * direction;
    const token = {};

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
    async function reconciliationTail(onReconcileFailed?: () => void) {
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
      if (pendingDeltasRef.current.size === 0) {
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
        await reconciliationTail(() => {
          setAlertText("Couldn't confirm the current value. It may not be up to date.");
        });
      }
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!schema || submitState === "pending") return;

    // evaluation-1.md CR1: `flushSync` forces the clear to commit to the DOM on its own, BEFORE
    // any new text is set below — without it, React batches this clear with the synchronous
    // client-blocked path's `setAlertText(summary)` into ONE commit, so a SECOND identical
    // failure never mutates the DOM text and a screen reader announces nothing (the spec's
    // "Regions SHALL be emptied when the next attempt starts" requires a real, observable clear,
    // not just an in-memory one that gets immediately overwritten in the same commit).
    flushSync(() => {
      setAlertText("");
      setStatusText("");
    });
    values.markAllTouched();

    const { fieldErrors, blocks } = validateForSubmit(config, schema, values.values);
    if (Object.keys(fieldErrors).length > 0 || blocks.length > 0) {
      values.setExternalErrors(fieldErrors);
      const summary = [...Object.values(fieldErrors), ...blocks.map((b) => b.message)].join(" ");
      setAlertText(summary);
      requestFocus(Object.keys(fieldErrors).length > 0 ? "invalid" : "button");
      return;
    }

    setSubmitState("pending");
    try {
      const submitValues = buildSubmitValues(config, schema, values.values);
      const submitFiles = buildSubmitFiles(config, schema, values.values);
      const response = await submitFormPanel(panelId, submitValues, submitFiles);
      setSubmitState("succeeded");
      setStatusText("The row was added.");
      pushDenialToastIfAny(response);
      // evaluator's non-blocking note: clears any lingering server-reported error explicitly,
      // rather than relying on `values.reset()` alone — a field the user never re-edited after a
      // prior server rejection must not carry a stale error onto a freshly reset form.
      values.setExternalErrors({});
      if (config.submit.resetOnSuccess !== false) values.reset();
      requestFocus("button");
    } catch (err) {
      setSubmitState("failed");
      const serverFieldErrors = parseFieldErrors(err);
      if (serverFieldErrors.length > 0) {
        const { fieldMessages, summaryLines } = mapServerFieldErrors(
          config,
          schema,
          serverFieldErrors,
        );
        values.setExternalErrors(fieldMessages);
        setAlertText([...Object.values(fieldMessages), ...summaryLines].join(" "));
        requestFocus(Object.keys(fieldMessages).length > 0 ? "invalid" : "button");
      } else {
        setAlertText(
          extractErrorMessage(err, "The submit could not be completed. Please try again."),
        );
        requestFocus("button");
      }
    }
  }

  if (error) {
    return (
      <div className="panel-content panel-content--form panel-content--form-state">
        <InlineError error={error} variant="banner" onRetry={() => setRetryToken((t) => t + 1)} />
      </div>
    );
  }

  if (!schema) {
    return (
      <div
        className="panel-content panel-content--form panel-content--form-state"
        aria-label="Loading form fields"
      >
        <PanelBodySkeleton />
      </div>
    );
  }

  // design.md Decision 1/2: the compact layout applies ONLY when the config has exactly one field
  // and it is a counter — zero fields, one non-counter field, and 2+ fields (including one
  // counter) all keep the standard stacked-field layout below, with any counter field rendered
  // `immediate={false}` (local-value-only, participates in the shared Submit button).
  const isCompactCounter = config.fields.length === 1 && config.fields[0].control === "counter";

  if (isCompactCounter) {
    const field = config.fields[0];
    return (
      <div className="panel-content panel-content--form">
        <div className="form-panel-view__compact-counter" aria-label={title}>
          {/* `FormFieldControl` already renders the field's own label via `FormField` — no
             separate label span here, which would otherwise duplicate it visually. */}
          <FormFieldControl
            field={field}
            declared={declaredByField.get(field.sourceField)}
            issue={issuesByField.get(field.sourceField)}
            value={values.values[field.sourceField]}
            error={values.errors[field.sourceField]}
            onChange={() => {
              /* compact layout never edits local value directly — every activation submits */
            }}
            onBlur={() => {
              /* no blur-driven validation in the compact layout — there is nothing else to
                 mark touched */
            }}
            immediate
            onImmediateStep={(direction) => void handleImmediateStep(direction)}
            busy={pendingCount > 0}
          />
          <p role="alert" className="form-panel-view__alert">
            {alertText}
          </p>
          <p role="status" className="form-panel-view__status">
            {statusText}
          </p>
        </div>
      </div>
    );
  }

  const submitLabel = submitState === "pending" ? "Submitting…" : (config.submit.label ?? "Submit");

  return (
    <div className="panel-content panel-content--form">
      {/* Enter inside a single-line `<input>` already submits the form natively (there is now a
         real `type="submit"` button); a `<textarea>` already refuses to auto-submit on Enter —
         neither needs bespoke key handling here. */}
      <form
        ref={formRef}
        className="form-panel-view__fields"
        aria-label={title}
        noValidate
        onSubmit={(e) => void handleSubmit(e)}
      >
        {config.fields.map((field) => (
          <FormFieldControl
            key={field.sourceField}
            field={field}
            declared={declaredByField.get(field.sourceField)}
            issue={issuesByField.get(field.sourceField)}
            value={values.values[field.sourceField]}
            error={values.errors[field.sourceField]}
            onChange={(v) => values.setValue(field.sourceField, v)}
            onBlur={() => values.touch(field.sourceField)}
            immediate={false}
          />
        ))}
        {/* HEL-1087 design.md D8: always-mounted live regions, emptied at the start of every
           attempt — a region that exists before the async outcome is what makes a later text
           change announced. */}
        <p role="alert" className="form-panel-view__alert">
          {alertText}
        </p>
        <p role="status" className="form-panel-view__status">
          {statusText}
        </p>
        {/* HEL-1090: `aria-disabled`, NOT the native `disabled` attribute, while pending — the
           browser silently blurs a focused element the instant it becomes natively `disabled`
           (moving focus to <body>, confirmed via a bare-HTML Playwright probe with no app code
           involved), which violates the spec's "focus SHALL remain on or return to the submit
           control ... never lost to the document body" requirement for the in-flight state.
           `aria-disabled` communicates the same state to assistive tech without triggering that
           browser behavior; `handleSubmit`'s own `submitState === "pending"` early-return (and
           `handleImmediateStep`'s matching guard) is what actually blocks a re-entrant submit,
           so no native `disabled` is needed for that purpose either. */}
        <button
          ref={submitButtonRef}
          type="submit"
          className="form-panel-view__submit"
          aria-disabled={submitState === "pending" ? "true" : undefined}
        >
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
