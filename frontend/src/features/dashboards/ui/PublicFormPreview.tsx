// HEL-1587 design D5 -- a form panel on the public (share-link) viewer: a read-only, non-interactive PREVIEW of its bound
// fields. Each field is the app's own `FormFieldControl` with `disabled` set (the counter included), seeded from the
// form's `initialValue` only. There is deliberately no `<form>`, no submit button, no `useCompactCounterSubmit` and no
// import of any submit function: nothing on this surface can send a submit request.
//
// Declarations (`required`/`type`, which `FormFieldControl` needs to render correctly) come from the public form-schema
// route, never the authenticated `GET /api/panels/:id/form-schema`.

import { useEffect, useMemo, useState } from "react";

import "../../panels/ui/form/FormPanel.css";
import "../../panels/ui/form/CounterControl.css";
import { FormFieldControl } from "../../panels/ui/form/FormFieldControl";
import { useFormPanelValues } from "../../panels/ui/form/useFormPanelValues";
import { PanelBodySkeleton } from "../../panels/ui/PanelBodySkeleton";
import { computeFormIssues } from "../../panels/state/formConfigValidation";
import type { FormPanelConfig } from "../../panels/types/panel";
import type { DatasetFieldResponse } from "../../sources/types/dataSource";
import { fetchPublicFormSchema } from "../services/publicDashboardService";

interface PublicFormPreviewProps {
  dashboardId: string;
  panelId: string;
  token: string;
  config: FormPanelConfig;
}

const noop = () => undefined;

type SchemaState = "loading" | "unavailable" | DatasetFieldResponse[];

export function PublicFormPreview({ dashboardId, panelId, token, config }: PublicFormPreviewProps) {
  const [schema, setSchema] = useState<SchemaState>("loading");

  useEffect(() => {
    let cancelled = false;
    fetchPublicFormSchema(dashboardId, panelId, token)
      .then((response) => {
        // Explicit mapping to the declaration shape `FormFieldControl` takes (`default` is optional there and never sent).
        if (!cancelled)
          setSchema(
            response.fields.map((f) => ({ name: f.name, type: f.type, required: f.required })),
          );
      })
      .catch(() => {
        if (!cancelled) setSchema("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardId, panelId, token]);

  const declarations = useMemo(() => (Array.isArray(schema) ? schema : []), [schema]);
  const values = useFormPanelValues(config.fields, declarations, false);

  if (schema === "loading") {
    return (
      <div className="panel-content panel-content--state" aria-label="Loading form preview">
        <PanelBodySkeleton />
      </div>
    );
  }
  if (schema === "unavailable") {
    return (
      <div className="panel-content panel-content--state">
        <p className="public-dashboard-viewer__preview-note">Form preview unavailable</p>
      </div>
    );
  }

  // The same issue text the signed-in form shows for an orphaned/unfit field; such a field renders as the existing
  // disabled issue shape. The counter row-shape rule is skipped: the public declaration only lists the bound fields.
  const issuesByField = new Map(
    computeFormIssues(config, schema, { skipCounterRowShape: true }).map((i) => [
      i.field,
      i.message,
    ]),
  );
  const declaredByField = new Map(schema.map((f) => [f.name, f]));

  return (
    <div className="panel-content panel-content--form">
      <div className="form-panel-view__fields">
        {config.fields.map((field) => (
          <FormFieldControl
            key={field.sourceField}
            field={field}
            declared={declaredByField.get(field.sourceField)}
            issue={issuesByField.get(field.sourceField)}
            value={values.values[field.sourceField]}
            error={null}
            onChange={noop}
            onBlur={noop}
            disabled
          />
        ))}
        <p className="public-dashboard-viewer__preview-note">Read-only preview</p>
      </div>
    </div>
  );
}
