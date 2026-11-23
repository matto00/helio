// HEL-1618 — the compact single-counter layout of `FormPanelView` (design.md Decision 1/2), presentational only.

import { COUNTER_TALLY_CAPTION } from "./counterTallyCaption";
import { FormFieldControl } from "./FormFieldControl";
import type { useFormPanelValues } from "./useFormPanelValues";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormPanelConfig } from "../../types/panel";

interface CompactCounterFormBodyProps {
  title: string;
  config: FormPanelConfig;
  declaredByField: Map<string, DatasetFieldResponse>;
  issuesByField: Map<string, string>;
  values: ReturnType<typeof useFormPanelValues>;
  isFormOwner: boolean;
  onStep: (direction: 1 | -1) => void;
  busy: boolean;
  alertId: string;
  alertText: string;
  statusText: string;
}

export function CompactCounterFormBody({
  title,
  config,
  declaredByField,
  issuesByField,
  values,
  isFormOwner,
  onStep,
  busy,
  alertId,
  alertText,
  statusText,
}: CompactCounterFormBodyProps) {
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
          onImmediateStep={onStep}
          busy={busy}
          tallyCaption={isFormOwner ? undefined : COUNTER_TALLY_CAPTION}
          errorDescriptionId={alertId}
        />
        <p id={alertId} role="alert" className="form-panel-view__alert">
          {alertText}
        </p>
        <p role="status" className="form-panel-view__status">
          {statusText}
        </p>
      </div>
    </div>
  );
}
