// HEL-1085/HEL-1087 design.md D2/D6/D7/D8 — the configured-form body: fetches the bound dataset's
// declared schema (required is tighten-only, so config alone can never render correctly), shows
// the established loading/failure states while doing so, then renders one `FormFieldControl` per
// authored field plus a submit button, submit-time validation, and success/error/network states.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import "./FormPanel.css";
import { PanelBodySkeleton } from "../PanelBodySkeleton";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { fetchDatasetSchema } from "../../../sources/services/dataSourceService";
import { extractErrorMessage } from "../../../../services/extractErrorMessage";
import { parseFieldErrors, submitFormPanel } from "../../services/panelService";
import { computeFormIssues } from "../../state/formConfigValidation";
import {
  buildSubmitValues,
  mapServerFieldErrors,
  validateForSubmit,
} from "../../state/formSubmission";
import { FormFieldControl } from "./FormFieldControl";
import { useFormPanelValues } from "./useFormPanelValues";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
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

  function requestFocus(intent: "invalid" | "button") {
    pendingFocusRef.current = intent;
    setFocusTrigger((t) => t + 1);
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
      await submitFormPanel(panelId, submitValues);
      setSubmitState("succeeded");
      setStatusText("The row was added.");
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
        <button
          ref={submitButtonRef}
          type="submit"
          className="form-panel-view__submit"
          disabled={submitState === "pending"}
        >
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
