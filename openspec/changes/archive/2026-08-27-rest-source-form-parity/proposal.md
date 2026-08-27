## Why

The human REST-source form still can't select a Connector, set query params/headers, or fill in
template parameters — all of which the backend/data model already support (HEL-822/823/824). The
dual-support bare-`url` create path (HEL-822) is the only way to create a source from the UI, which
blocks retiring it. Users feel this now that Connectors are a real, credentialed concept.

## What Changes

- Add a Connector picker to the REST source form (select existing, or launch `CreateConnectorModal`
  inline — extended with a small `onCreated` callback — and return with the new Connector selected)
  — reuses HEL-824's Connectors feature, no new credential UI.
- Replace the "URL" input with an "Endpoint path" input once a Connector is selected (the backend's
  `connectorId` path reads the path from `endpoint`, not `url` — mutually exclusive with `url`
  server-side); extend the client `RestApiConfigBody` wire type with `endpoint`/`queryParams`/
  `parameters`, which it does not yet declare.
- Add `queryParams` (key/value list) and `headers` (key/value list) fields to `RestApiForm.tsx`.
- Introduce one shared REST-config composer used by all three existing config-building call sites
  (test, schema-preview, create) so every save path emits the same, current shape.
- Add a template-parameters editor (HEL-823 `{{name}}` substitution) with per-parameter value inputs,
  populated from placeholders detected in endpoint/queryParams/headers/body.
- Make Connector selection legible: show the selected Connector's name/kind and a note that its
  credential is applied — explains the absence of an auth field.
- Extend `TestConnectionAffordance`'s `buildConfig()` to compose Connector + endpoint + params +
  headers + body, unchanged contract otherwise.
- Retire the dual-support bare-`url` create path from the **UI** only (stop emitting a create request
  with no `connectorId`) — **BREAKING for UI authoring flow only**; backend bare-`url` acceptance is
  left in place unless design.md's investigation finds a specific reason to remove it (HEL-828/MCP may
  still depend on it — flagged for escalation if ambiguous).
- Split `RestApiForm.tsx`/`AddSourceModal.tsx` as needed to stay under the `CONTRIBUTING.md` file-size
  budget as the form grows.

## Capabilities

### New Capabilities

- `sources/rest-source-authoring`: the human-authoring contract for REST sources — Connector
  selection, query params, headers, template parameters, composed test-before-save, parity with the
  MCP/agent authoring surface.

### Modified Capabilities

(none — REST source creation/config behavior at the API layer is unchanged; only the UI surface
gains fields it previously omitted. No existing spec's requirements change.)

## Impact

- `frontend/src/features/sources/ui/forms/RestApiForm.tsx`, `AddSourceModal.tsx`, `dataSourceService.ts`,
  new `frontend/src/features/sources/hooks/useRestSourceForm.ts`
- `frontend/src/features/connectors/ui/CreateConnectorModal.tsx` (small, backwards-compatible
  `onCreated` prop addition — the only modification to the connectors feature; everything else there
  is reused unmodified)
- No backend changes expected (fields already exist server-side); confirmed during design.md — the
  client wire type (`RestApiConfigBody`) is extended, the server contract is not
- Out of scope: MCP-side changes (HEL-828)
