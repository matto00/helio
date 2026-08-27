// HEL-827 design.md Decision 5 / tasks 3.3: renders one value input per
// `{{name}}` placeholder detected across the endpoint, queryParams values,
// headers values, and body (HEL-823 template parameters). Detection lives in
// `useRestSourceForm` (`detectTemplateParameterNames`); this component is
// purely presentational over the detected name list + value map.

import { TextField } from "../../../../shared/ui/TextField";
import "./TemplateParametersField.css";

interface TemplateParametersFieldProps {
  names: string[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

export function TemplateParametersField({ names, values, onChange }: TemplateParametersFieldProps) {
  if (names.length === 0) return null;

  return (
    <div className="template-parameters-field">
      <span className="template-parameters-field__label">Template parameters</span>
      <p className="template-parameters-field__hint">
        Detected from <code>{"{{name}}"}</code> placeholders in the endpoint, query params, headers,
        or body.
      </p>
      {names.map((name) => (
        <div className="template-parameters-field__row" key={name}>
          <label
            className="template-parameters-field__param-label"
            htmlFor={`template-param-${name}`}
          >
            {name}
          </label>
          <TextField
            id={`template-param-${name}`}
            value={values[name] ?? ""}
            onChange={(e) => onChange(name, e.target.value)}
            aria-label={`Value for ${name}`}
          />
        </div>
      ))}
    </div>
  );
}
