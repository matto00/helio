## Why

`SourceService.createRest`'s bare-`url` branch builds its `RestApiConfig` by hand and omits `parameters`, so a
caller's HEL-823 template values are discarded at create time. The persisted source keeps its `{{name}}`
placeholders but has an empty parameter map, so every later fetch fails HEL-823's unresolved-variable guard with
an error naming a template variable rather than the real cause. The source is dead on arrival, and the only
remaining bare-`url` caller is the internal one (agent-authored pipeline proposals resolving an inline source),
which is exactly the path an agent cannot work around by creating a Connector first.

## What Changes

- Carry `request.config.parameters` through the bare-`url` branch's `RestApiConfig` construction, alongside the
  fields it already carries (endpoint, method, queryParams, headers, body, bodyContentType, rootSelector).
- Add a red-first regression spec proving the drop before the fix and the resolution after it, end to end against
  a real bound local HTTP server: create through `SourceService`, fetch through the same persisted
  Connector/config via `RestApiConnectorDriver`, and assert on the query string and headers the server received.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `rest-api-connector`: the `{{name}}` templating requirement gains the create-time half of the contract — a
  bare-`url` create persists the `parameters` map it was given, so the resulting source's placeholders resolve on
  its subsequent connectorId-resolving fetches instead of failing the unresolved-variable guard.

## Impact

- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — one constructor argument in the
  bare-`url` branch.
- New backend test spec alongside `SourceServiceBareUrlQueryParamsSpec` (the sibling HEL-844 guard at this same
  call site), using the same embedded-Postgres + bound-HTTP-server harness.
- No schema change, no Flyway migration, no frontend change, no wire-contract change.

## Non-goals

- Changing the ephemeral bare-`url` infer/test-connection paths, which have no `parameters` store and correctly
  leave `{{...}}` literal.
- Re-opening the retired bare-`url` shape on `POST /api/sources` itself, which stays a 400.
- Any change to templating resolution, escaping, or the unresolved-variable guard.
