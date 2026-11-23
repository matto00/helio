// HEL-1618 — the standard stacked-field layout of `FormPanelView`, presentational only.

import type { FormEvent, RefObject } from "react";

import { FormFieldControl } from "./FormFieldControl";
import type { useFormPanelValues } from "./useFormPanelValues";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormPanelConfig } from "../../types/panel";

interface MultiFieldFormBodyProps {
  title: string;
  config: FormPanelConfig;
  declaredByField: Map<string, DatasetFieldResponse>;
  issuesByField: Map<string, string>;
  values: ReturnType<typeof useFormPanelValues>;
  formRef: RefObject<HTMLFormElement | null>;
  submitButtonRef: RefObject<HTMLButtonElement | null>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  alertText: string;
  statusText: string;
  submitPending: boolean;
  submitLabel: string;
}

export function MultiFieldFormBody({
  title,
  config,
  declaredByField,
  issuesByField,
  values,
  formRef,
  submitButtonRef,
  onSubmit,
  alertText,
  statusText,
  submitPending,
  submitLabel,
}: MultiFieldFormBodyProps) {
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
        onSubmit={onSubmit}
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
          aria-disabled={submitPending ? "true" : undefined}
        >
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
