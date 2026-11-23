// HEL-1085/HEL-1087 design.md D2/D6/D7/D8 — the configured-form body: fetches the bound dataset's
// declared schema (required is tighten-only, so config alone can never render correctly), shows
// the established loading/failure states while doing so, then renders one `FormFieldControl` per
// authored field plus a submit button, submit-time validation, and success/error/network states.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import "./FormPanel.css";
import "./CounterControl.css";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { PanelBodySkeleton } from "../PanelBodySkeleton";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { fetchDatasetSchema } from "../../../sources/services/dataSourceService";
import { extractErrorMessage } from "../../../../services/extractErrorMessage";
import { buildDeniedPipelinesToast } from "../../../pipelines/services/deniedPipelinesToast";
import { useRunToUpdate } from "../../../pipelines/hooks/useRunToUpdate";
import { useToast } from "../../../toasts/hooks/useToast";
import { fetchFormSchema, parseFieldErrors, submitFormPanel } from "../../services/panelService";
import { computeFormIssues } from "../../state/formConfigValidation";
import {
  buildSubmitFiles,
  buildSubmitValues,
  mapServerFieldErrors,
  validateForSubmit,
} from "../../state/formSubmission";
import { isCompactCounterConfig } from "./compactCounter";
import { CompactCounterFormBody } from "./CompactCounterFormBody";
import { MultiFieldFormBody } from "./MultiFieldFormBody";
import { useCompactCounterSubmit } from "./useCompactCounterSubmit";
import { useFormPanelValues } from "./useFormPanelValues";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormPanelConfig, FormSubmitResponse } from "../../types/panel";

interface FormPanelViewProps {
  title: string;
  panelId: string;
  config: FormPanelConfig;
  /** HEL-1784: the form panel's `ownerId`. Only the form's owner may read the bound dataset's own schema and aggregate;
   *  anyone else loads the bound fields from the panel's own route and shows a counter's tally of their own clicks.
   *  The panel list emits `ownerId` only to the dashboard's owner and the panel's creator, so an absent one fails
   *  closed to "not the owner". */
  formOwnerId?: string;
}

type SubmitState = "idle" | "pending" | "succeeded" | "failed";

export function FormPanelView({ title, panelId, config, formOwnerId }: FormPanelViewProps) {
  const currentUserId = useAppSelector((state) => state.auth.currentUser?.id ?? null);
  const isFormOwner = formOwnerId != null && formOwnerId === currentUserId;
  // The schema a non-owner reads omits `occurred_at`/`value`, which a counter submit fills in server-side, so the
  // counter row-shape rule cannot be judged from it; the server enforces it under the source's lock.
  const issueOptions = useMemo(() => ({ skipCounterRowShape: !isFormOwner }), [isFormOwner]);
  const [schema, setSchema] = useState<DatasetFieldResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // HEL-1096 design.md D3/D7 — pushes the denial toast (if any) from a successful write's
  // `deniedPipelines`, and the "Run to update" action's own click behavior.
  const { push: pushToast } = useToast();
  const runToUpdateAction = useRunToUpdate();

  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [alertText, setAlertText] = useState("");
  // HEL-1818 — the compact counter's rejection text lives only in the alert region; the control is described by it.
  const alertId = useId();
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

  function requestFocus(intent: "invalid" | "button") {
    pendingFocusRef.current = intent;
    setFocusTrigger((t) => t + 1);
  }

  // HEL-1096 design.md D3: exactly one toast per write, built from `response.deniedPipelines` —
  // a no-op when nothing was denied (or every denial was invisible to the writer, design.md D1).
  function pushDenialToastIfAny(response: FormSubmitResponse) {
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
    const schemaRequest = isFormOwner
      ? fetchDatasetSchema(config.dataSourceId)
      : fetchFormSchema(panelId);
    void schemaRequest
      .then((response) => {
        if (!cancelled) setSchema(response.fields);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the dataset's declared schema.");
      });
    return () => {
      cancelled = true;
    };
  }, [config.dataSourceId, panelId, isFormOwner, retryToken]);

  const issues = schema ? computeFormIssues(config, schema, issueOptions) : [];
  const issuesByField = new Map(issues.map((i) => [i.field, i.message]));
  const declaredByField = new Map((schema ?? []).map((f) => [f.name, f]));

  // design.md Decision 1/2: the compact layout applies ONLY when the config has exactly one field
  // and it is a counter — zero fields, one non-counter field, and 2+ fields (including one
  // counter) all keep the standard stacked-field layout below, with any counter field rendered
  // `immediate={false}` (local-value-only, participates in the shared Submit button).
  const isCompactCounter = isCompactCounterConfig(config);

  // HEL-1788 D3a: a non-owner's compact counter is a tally of their own clicks, so it starts at 0.
  const values = useFormPanelValues(config.fields, schema ?? [], isCompactCounter && !isFormOwner);

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

  // design.md Decision 1/2, HEL-1095 design.md D9 — the compact counter's `+`/`-` handler and its burst state.
  const compactCounter = useCompactCounterSubmit({
    schema,
    config,
    panelId,
    isFormOwner,
    values,
    setAlertText,
    setStatusText,
    pushDenialToastIfAny,
  });

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

    const { fieldErrors, blocks } = validateForSubmit(config, schema, values.values, issueOptions);
    if (Object.keys(fieldErrors).length > 0 || blocks.length > 0) {
      values.setExternalErrors(fieldErrors);
      const summary = [...Object.values(fieldErrors), ...blocks.map((b) => b.message)].join(" ");
      setAlertText(summary);
      requestFocus(Object.keys(fieldErrors).length > 0 ? "invalid" : "button");
      return;
    }

    setSubmitState("pending");
    try {
      const submitValues = buildSubmitValues(config, schema, values.values, issueOptions);
      const submitFiles = buildSubmitFiles(config, schema, values.values, issueOptions);
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
          issueOptions,
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

  if (isCompactCounter) {
    return (
      <CompactCounterFormBody
        title={title}
        config={config}
        declaredByField={declaredByField}
        issuesByField={issuesByField}
        values={values}
        isFormOwner={isFormOwner}
        onStep={(direction) => void compactCounter.step(direction)}
        busy={compactCounter.busy}
        alertId={alertId}
        alertText={alertText}
        statusText={statusText}
      />
    );
  }

  const submitLabel = submitState === "pending" ? "Submitting…" : (config.submit.label ?? "Submit");

  return (
    <MultiFieldFormBody
      title={title}
      config={config}
      declaredByField={declaredByField}
      issuesByField={issuesByField}
      values={values}
      formRef={formRef}
      submitButtonRef={submitButtonRef}
      onSubmit={(e) => void handleSubmit(e)}
      alertText={alertText}
      statusText={statusText}
      submitPending={submitState === "pending"}
      submitLabel={submitLabel}
    />
  );
}
