// HEL-1085 design.md D2/D8 — the configured-form body: fetches the bound dataset's declared
// schema (required is tighten-only, so config alone can never render correctly), shows the
// established loading/failure states while doing so, then renders one `FormFieldControl` per
// authored field inside a submit-prevented `<form>` (no submit button until HEL-1087).

import { useEffect, useState } from "react";

import "./FormPanel.css";
import { PanelBodySkeleton } from "../PanelBodySkeleton";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { fetchDatasetSchema } from "../../../sources/services/dataSourceService";
import { computeFormIssues } from "../../state/formConfigValidation";
import { FormFieldControl } from "./FormFieldControl";
import { useFormPanelValues } from "./useFormPanelValues";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormPanelConfig } from "../../types/panel";

interface FormPanelViewProps {
  title: string;
  config: FormPanelConfig;
}

export function FormPanelView({ title, config }: FormPanelViewProps) {
  const [schema, setSchema] = useState<DatasetFieldResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

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

  return (
    <div className="panel-content panel-content--form">
      <form
        className="form-panel-view__fields"
        aria-label={title}
        onSubmit={(e) => e.preventDefault()}
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
      </form>
    </div>
  );
}
