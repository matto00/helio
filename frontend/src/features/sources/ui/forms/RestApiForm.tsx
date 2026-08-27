// REST API source configuration fields (URL + method + optional body + root
// selector) rendered inside AddSourceModal when the user picks the REST API
// source type.
//
// Extracted from AddSourceModal.tsx in CS3 cycle 2 (behavior-preserving).
// HEL-826: adds a method selector (previously hardcoded "GET") and a
// body/content-type editor, shown only for POST/PUT/PATCH — matching the
// server's rejection of a body on GET/HEAD (design.md Decision 3/6).

import { TextField } from "../../../../shared/ui/TextField";
import { Textarea } from "../../../../shared/ui/Textarea";
import { Select } from "../../../../shared/ui/Select";
import { TestConnectionAffordance } from "../TestConnectionAffordance";
import type { RestApiConfigBody } from "../../services/dataSourceService";

const HTTP_METHOD_OPTIONS = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
];

const BODIED_METHODS = new Set(["POST", "PUT", "PATCH"]);

interface RestApiFormProps {
  url: string;
  method: string;
  jsonPath: string;
  body: string;
  bodyContentType: string;
  onUrlChange: (value: string) => void;
  onMethodChange: (value: string) => void;
  onJsonPathChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onBodyContentTypeChange: (value: string) => void;
}

export function RestApiForm({
  url,
  method,
  jsonPath,
  body,
  bodyContentType,
  onUrlChange,
  onMethodChange,
  onJsonPathChange,
  onBodyChange,
  onBodyContentTypeChange,
}: RestApiFormProps) {
  const supportsBody = BODIED_METHODS.has(method);

  // Mirrors AddSourceModal.handlePreview's REST config-building exactly, so a
  // successful connection test reflects the same shape "Preview schema" uses.
  function buildConfig(): RestApiConfigBody {
    return {
      url: url.trim(),
      method,
      ...(jsonPath.trim() ? { rootSelector: jsonPath.trim() } : {}),
      ...(supportsBody && body.trim() ? { body: body.trim() } : {}),
      ...(supportsBody && body.trim() && bodyContentType.trim()
        ? { bodyContentType: bodyContentType.trim() }
        : {}),
    };
  }

  return (
    <>
      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="source-url">
          URL
        </label>
        <TextField
          id="source-url"
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://api.example.com/data"
          aria-label="URL"
        />
      </div>
      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="source-method">
          Method
        </label>
        <Select
          value={method}
          options={HTTP_METHOD_OPTIONS}
          onChange={onMethodChange}
          ariaLabel="Method"
        />
      </div>
      {supportsBody && (
        <>
          <div className="add-source-modal__field">
            <label className="add-source-modal__label" htmlFor="source-body">
              Body <span className="add-source-modal__optional">(optional)</span>
            </label>
            <Textarea
              id="source-body"
              mono
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder='{"key": "{{value}}"}'
              aria-label="Body"
              rows={4}
            />
          </div>
          <div className="add-source-modal__field">
            <label className="add-source-modal__label" htmlFor="source-body-content-type">
              Content type <span className="add-source-modal__optional">(optional)</span>
            </label>
            <TextField
              id="source-body-content-type"
              value={bodyContentType}
              onChange={(e) => onBodyContentTypeChange(e.target.value)}
              placeholder="application/json"
              aria-label="Content type"
            />
          </div>
        </>
      )}
      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="source-json-path">
          JSON path <span className="add-source-modal__optional">(optional)</span>
        </label>
        <TextField
          id="source-json-path"
          value={jsonPath}
          onChange={(e) => onJsonPathChange(e.target.value)}
          placeholder="e.g. data.items"
          aria-label="JSON path"
        />
      </div>
      <TestConnectionAffordance type="rest_api" buildConfig={buildConfig} />
    </>
  );
}
