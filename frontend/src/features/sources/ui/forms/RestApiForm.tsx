// REST API source configuration fields, rendered inside AddSourceModal when
// the user picks the REST API source type.
//
// Extracted from AddSourceModal.tsx in CS3 cycle 2 (behavior-preserving).
// HEL-826: adds a method selector (previously hardcoded "GET") and a
// body/content-type editor, shown only for POST/PUT/PATCH.
// HEL-827: brings the form to parity with the agent/MCP authoring surface —
// Connector selection replaces the bare URL input, plus query params,
// headers, and template parameters. All field state now lives in
// `useRestSourceForm` (design.md Decision 5); this component is purely
// presentational over that hook's return value.

import { TextField } from "../../../../shared/ui/TextField";
import { Textarea } from "../../../../shared/ui/Textarea";
import { Select } from "../../../../shared/ui/Select";
import { TestConnectionAffordance } from "../TestConnectionAffordance";
import type { UseRestSourceFormReturn } from "../../hooks/useRestSourceForm";
import { HTTP_METHOD_OPTIONS } from "../../hooks/useRestSourceForm";
import { ConnectorSelectField } from "./ConnectorSelectField";
import { KeyValueListField } from "./KeyValueListField";
import { TemplateParametersField } from "./TemplateParametersField";

const METHOD_SELECT_OPTIONS = HTTP_METHOD_OPTIONS.map((m) => ({ value: m, label: m }));

interface RestApiFormProps {
  form: UseRestSourceFormReturn;
}

export function RestApiForm({ form }: RestApiFormProps) {
  const {
    connector,
    setConnector,
    endpoint,
    setEndpoint,
    method,
    setMethod,
    queryParams,
    setQueryParams,
    headers,
    setHeaders,
    rootSelector,
    setRootSelector,
    body,
    setBody,
    bodyContentType,
    setBodyContentType,
    parameterValues,
    setParameterValue,
    templateParameterNames,
    supportsBody,
    buildRestSourceConfig,
  } = form;

  return (
    <>
      <ConnectorSelectField connector={connector} onChange={setConnector} />

      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="source-endpoint">
          Endpoint path
        </label>
        <div className="add-source-modal__endpoint-row">
          {connector && (
            <span className="add-source-modal__endpoint-prefix">{connector.baseUrl}</span>
          )}
          <TextField
            id="source-endpoint"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="/v1/accounts"
            aria-label="Endpoint path"
            disabled={!connector}
          />
        </div>
      </div>

      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="source-method">
          Method
        </label>
        <Select
          value={method}
          options={METHOD_SELECT_OPTIONS}
          onChange={setMethod}
          ariaLabel="Method"
        />
      </div>

      <KeyValueListField label="Query params" entries={queryParams} onChange={setQueryParams} />
      <KeyValueListField label="Headers" entries={headers} onChange={setHeaders} />

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
              onChange={(e) => setBody(e.target.value)}
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
              onChange={(e) => setBodyContentType(e.target.value)}
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
          value={rootSelector}
          onChange={(e) => setRootSelector(e.target.value)}
          placeholder="e.g. data.items"
          aria-label="JSON path"
        />
      </div>

      <TemplateParametersField
        names={templateParameterNames}
        values={parameterValues}
        onChange={setParameterValue}
      />

      <TestConnectionAffordance
        type="rest_api"
        buildConfig={buildRestSourceConfig}
        disabled={!connector}
      />
    </>
  );
}
