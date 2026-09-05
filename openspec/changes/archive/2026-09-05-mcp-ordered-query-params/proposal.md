## Why

HEL-844 made the REST source's `queryParams` an ordered, duplicate-preserving `QueryParams`
across parsing, persistence, `{{name}}` resolution and request composition — but only for the
UI and REST-API authoring paths. `helio-mcp` still types the same field as
`Record<string, string>`, a shape that **cannot express a repeated key at all**. So the
silent-corruption class HEL-844 was filed against is closed for humans and still fully open
for agents: an MCP-authored source cannot declare `?tag=a&tag=b`, and the object it does send
decodes through the backend's legacy branch in **key-sorted** order rather than authored order.
Same silent-wrong-answer shape — request succeeds, response parses, data is wrong — entering
through a different door. This change is what actually closes the class.

## What Changes

- Widen every `queryParams` type on the `helio-mcp` REST surface from `Record<string, string>`
  to a union that ALSO accepts the ordered `{name, value}[]` array encoding the backend now
  emits and accepts. Six sites, re-enumerated from the tree (the ticket named three):
  `types.ts` (`CreatePipelineRootRequest.restConfig`, introduced by HEL-914), `helioApi.ts`
  (input type + POST pass-through), `restDataSourceSchema.ts` (the zod input schema),
  `pipelinesHandlers.ts` (an explicit `as Record<string, string>` cast on the inline-root REST
  branch), and `write.ts` (tool pass-through).
- Update the `create_rest_data_source` tool's zod schema and description so an agent can author
  a repeated key **deliberately**, and knows the array form is what preserves order.
- Not **BREAKING**: the object encoding remains accepted on every widened site, and the backend's
  legacy branch still decodes it. Existing MCP callers are unaffected.
- No backend change. No Flyway migration (and none is needed — the encoding is already dual-read).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-data-source-tools`: the `create_rest_data_source` requirement gains the ordered,
  duplicate-preserving `queryParams` encoding — currently it names `queryParams` as an
  undifferentiated optional field, which is satisfied by the collapsing map shape.
- `mcp-pipeline-root-tools`: the inline `rest_api` root's `restConfig.queryParams` gains the
  same ordered encoding, so a repeated key is expressible when a source is created inline as a
  pipeline root rather than standalone.

## Impact

- **Code**: `helio-mcp/src/types.ts`, `helio-mcp/src/helioApi.ts`,
  `helio-mcp/src/tools/restDataSourceSchema.ts`, `helio-mcp/src/tools/pipelinesHandlers.ts`,
  `helio-mcp/src/tools/write.ts`, plus tests.
- **Wire contract**: none changed — this adopts an encoding the backend already accepts and
  already emits. `schemas/pipelines/create-pipeline-request.schema.json` already declares the
  dual-read `oneOf [object, array, null]`.
- **Agents**: an agent that previously had no way to express a repeated query key now does.
  Agents already emitting the object form keep working, with unchanged (key-sorted) semantics.
- **Not touched**: header representation (HEL-844 non-goal, inherited), the backend, the
  frontend, any migration.
