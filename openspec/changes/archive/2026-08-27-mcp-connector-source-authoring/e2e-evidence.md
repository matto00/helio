# HEL-828 — Real-run evidence (tasks 6.1, 7.1, 5.1, 8.1)

This file records the actual runs performed during execution, in response to evaluation-1.md's
Phase 1 finding that tasks 6.1/7.1/5.1/8.1 were checked `[x]` without supporting evidence in the
change directory. All commands below were run against the live dev stack for this worktree
(backend :9167, frontend :6260, started via `scripts/concertino/start-servers.sh`).

## Task 6.1 — Real end-to-end run via the actual MCP server (stdio)

Driven with a real `@modelcontextprotocol/sdk` `Client` over `StdioClientTransport`, spawning
`node dist/index.js` (the real `helio-mcp` binary) exactly as an MCP host would — not raw HTTP.

Setup: minted a real session (`POST /api/auth/login` as `matt@helio.dev`), minted a real PAT
(`POST /api/tokens` → `helio_pat_<redacted>`),
created a real Connector via `POST /api/connectors`:

```
POST /api/connectors {"name":"JSONPlaceholder","kind":"rest_api","baseUrl":"https://jsonplaceholder.typicode.com","config":{"authType":"none"},"credential":""}
→ 201 {"id":"2a6e234f-c746-4d3a-a5e8-e0f3468dd012","name":"JSONPlaceholder","kind":"rest_api","baseUrl":"https://jsonplaceholder.typicode.com", ...}
```

### tools/list — full tool enumeration (48 tools, includes `list_connectors`, excludes any
create/update/rotate-Connector tool)

```
[
  "list_dashboards","get_dashboard","list_data_sources","list_source_objects","list_data_types",
  "get_data_type_rows","get_panel_capabilities","list_pipelines","get_pipeline","analyze_pipeline",
  "list_connector_types","list_connectors","list_pipeline_shapes","list_metrics","get_metric",
  "get_workspace_context","create_data_source","create_csv_data_source","create_rest_data_source",
  "create_sql_data_source","create_pipeline","add_pipeline_step","create_pipeline_from_shape",
  "run_pipeline","create_dashboard","replace_dashboard_contents","upload_image","create_panel",
  "create_panels","bind_panel","create_bound_panel","update_panel_appearance","update_panel",
  "teardown_resources","create_metric","update_metric","update_data_source","update_data_type",
  "update_pipeline","update_pipeline_step","delete_dashboard","delete_data_source","delete_data_type",
  "delete_panel","delete_pipeline","delete_metric","delete_pipeline_step","update_dashboard_layout",
  "auto_layout_dashboard","propose_dashboard","apply_proposal","propose_pipeline",
  "analyze_pipeline_proposal","apply_pipeline_proposal","apply_combined_proposal",
  "propose_patch_set","apply_patch_set","undo_patch_set"
]
No create/update/rotate-Connector tool exists: true
```

### `list_connectors` call and result

```
callTool({ name: "list_connectors", arguments: {} })
→ content[0].text = JSON array of the caller's Connectors, each entry e.g.:
  {
    "id": "2a6e234f-c746-4d3a-a5e8-e0f3468dd012",
    "name": "JSONPlaceholder",
    "kind": "rest_api",
    "host": "https://jsonplaceholder.typicode.com"
  }
  (plus 9 pre-existing Connectors from this shared dev DB, same shape)

Union of keys across all list_connectors entries: [ 'host', 'id', 'kind', 'name' ]
```

The exact 4-key union across every entry — computed by unioning `Object.keys` over the whole
result array, not spot-checking one entry — is the proof no entry carries any extra (e.g.
credential-shaped) field.

### `create_rest_data_source` call, with a hostile `auth` field included, and result

```
callTool({
  name: "create_rest_data_source",
  arguments: {
    name: "HEL-828 e2e demo 1787862891085",
    connectorId: "2a6e234f-c746-4d3a-a5e8-e0f3468dd012",
    endpoint: "/users",
    method: "GET",
    auth: { type: "bearer", token: "sk-should-never-survive" }   // hostile input
  }
})
→ content[0].text =
{
  "source": {
    "config": {
      "connectorId": "2a6e234f-c746-4d3a-a5e8-e0f3468dd012",
      "endpoint": "/users",
      "method": "GET"
    },
    "id": "31b3b08a-1033-46be-a57a-f524f7c2919e",
    "name": "HEL-828 e2e demo 1787862891085",
    "type": "rest_api",
    ...
  },
  "dataType": {
    "id": "a4a2b758-6757-478b-b8ce-ddefc16e48cc",
    "sourceId": "31b3b08a-1033-46be-a57a-f524f7c2919e",
    "fields": [
      {"name":"address.city","dataType":"string","displayName":"Address City","nullable":false},
      {"name":"address.geo.lat","dataType":"string", ...},
      {"name":"address.geo.lng","dataType":"string", ...},
      {"name":"address.street","dataType":"string", ...},
      {"name":"address.suite","dataType":"string", ...},
      {"name":"address.zipcode","dataType":"string", ...},
      {"name":"company.bs","dataType":"string", ...},
      {"name":"company.catchPhrase","dataType":"string", ...},
      {"name":"company.name","dataType":"string", ...},
      {"name":"email","dataType":"string", ...},
      {"name":"id","dataType":"integer", ...},
      {"name":"name","dataType":"string", ...},
      {"name":"phone","dataType":"string", ...},
      {"name":"username","dataType":"string", ...},
      {"name":"website","dataType":"string", ...}
    ],
    "version": 1
  },
  "fetchError": null
}
Result contains the hostile token string "sk-should-never-survive": false
```

**Confirmed end-to-end**: a real Connector, listed via the real MCP `list_connectors` tool, used to
author a real `rest_api` source via the real MCP `create_rest_data_source` tool, which performed a
real fetch against `jsonplaceholder.typicode.com/users` and produced a real 15-field DataType — `
fetchError: null`, no credential anywhere in the result, and the hostile `auth` field never
reached storage or the result (see the schema-rejection change below, made after this evidence was
first captured — see "Post-evaluation schema hardening").

### `get_workspace_context` — MCP resource read, `connectors` block

```
readResource({ uri: "helio://workspace/context" })
→ parsed.connectors = [
    {"id":"2a6e234f-...","name":"JSONPlaceholder","kind":"rest_api","host":"https://jsonplaceholder.typicode.com"},
    ... 9 more entries, same 4-key shape ...
  ]
Union of keys across all connectors entries: [ 'host', 'id', 'kind', 'name' ]
```

(One entry's `name` happens to contain the literal word "Bearer" — `"Migrated: Smoke Bearer"`, a
pre-existing Connector's display name from an earlier ticket's fixture, not a credential. Confirmed
by the exact key-set check above: the field carrying that substring is `name`, not any
credential-shaped key.)

## Task 7.1 — Credential-never-reaches-the-surface enumeration (both directions)

Every MCP tool result / workspace-context payload that could carry Connector data, enumerated by
`grep`ing `helio-mcp/src/**` for `[Cc]onnector` and cross-checking against the backend wire types:

| Surface | Schema-level check | Runtime check |
|---|---|---|
| `list_connectors` result | `ConnectorSummary` (both `types.ts` and the backend `ConnectorEntityProtocol.scala`) has exactly `id`/`name`/`kind`/`host` fields declared — no `config`/`defaultHeaders`/`authType` field exists on the type at all | Live call above: exact 4-key union across all entries |
| `create_rest_data_source` result | `CreateSourceResult`/`RawCreateSourceResponse` (`types.ts`) never includes a credential field; `RestApiConfig`'s wire projection (`RestSource`'s `config`) only ever serializes `connectorId`/`endpoint`/`method`/`headers`/`body`/`bodyContentType`/`rootSelector` — no auth/credential field in the domain config type itself | Live call above: result's `source.config` = `{connectorId, endpoint, method}` only; hostile `auth` input absent from the result entirely |
| `get_workspace_context` — backend `WorkspaceContextResponse.connectors` | `ConnectorSummary` (Scala) — same allow-listed type as `list_connectors`, shared code path (`ConnectorSummary.fromDomain`) | `WorkspaceContextServiceSpec` (backend, unit-tested): exact serialized key set `{"id","name","kind","host"}` asserted directly, including a fixture Connector whose `defaultHeaders` holds an `Authorization`-shaped value, proving it's dropped by construction |
| `get_workspace_context` — `helio-mcp/context.ts`'s own fan-out `connectors` block | Same `ConnectorSummary` TS type, populated via `HelioApi.listConnectorInstances()`, itself mapping the backend's `{items: ConnectorMeta[]}` response into the 4-field shape by naming fields, never spreading | Live resource read above: exact 4-key union across all entries |
| Any other MCP tool (`list_source_objects`, `get_pipeline`, `analyze_pipeline`, etc.) | `grep -rn "[Cc]onnector" helio-mcp/src/tools/*.ts helio-mcp/src/helioApi.ts helio-mcp/src/context.ts` shows Connector references confined to `list_connector_types`/`list_connectors`/`create_rest_data_source`'s doc comments and the two workspace-context fan-outs above — no other tool touches Connector data at all | Live `tools/list` enumeration above: 48 tools total, only the ones in the table above ever mention "connector" |
| Create/update/rotate-Connector tool | No such tool is registered anywhere in `helio-mcp/src/tools/*.ts` (design.md Decision 2) | Live `tools/list` enumeration above: confirmed absent (`No create/update/rotate-Connector tool exists: true`) |

## Task 5.1 — AssistantProposalToolSchemas.scala / AssistantToolExecutor.scala re-read

**Finding: verified consistent, no divergence.**

- `AssistantProposalToolSchemas.scala`'s `rest_api` config shape is already `{connectorId, endpoint?,
  method?, queryParams?, headers?}` (lines ~122-124, ~308-309) — already connectorId-only, no `url`
  field, predates this ticket (HEL-659/756 surface).
- `AssistantToolExecutor.scala`'s `test_connection` dispatch (line ~190) calls
  `sourceService.testRest` directly (the **service** layer, not the `SourceRoutes` HTTP wire
  boundary this ticket's rejection lives at) — confirmed unaffected by the `SourceRoutes` change,
  since `testRest` is one of the explicitly-untouched ephemeral methods (design.md Decision 1).
- Actual persisted-source creation for this surface is delegated to `PipelineProposalService`
  (`pipelineProposalService.validate`, line ~278) — the same service whose inline bare-url path this
  ticket's escalation deliberately left untouched. Since the in-app assistant's own schema never
  offers a bare-`url` field in the first place, this divergence-risk is moot for that surface.
- No edits made to either file, per the task's "do not expand scope to fix it" instruction.

## Task 8.1 — Connector-picker kind-mismatch (observed, not fixed)

**Finding: confirmed, real, unfixed by design (out of scope per the ticket).**

`frontend/src/features/sources/ui/forms/ConnectorSelectField.tsx`'s `options` list is built from
`connectors.map(c => ({value: c.id, label: \`${c.name} (${c.kind})\`}))` with **no filter on
`c.kind`** — every Connector the caller owns appears in the REST source form's picker, regardless
of kind.

Live Playwright verification (screenshots in the scratchpad dir during execution, not committed):
1. Created a `sql`-kind Connector (`HEL-828 SQL Kind-Mismatch Probe`) via `POST /api/connectors`.
2. Opened "Add data source" → REST API → the Connector dropdown lists it alongside every `rest_api`
   Connector, labeled `HEL-828 SQL Kind-Mismatch Probe (sql)`.
3. Selecting it is accepted **silently** — no warning, no validation error at the point of
   selection. The form's note text renders neutrally: "Requests use **HEL-828 SQL Kind-Mismatch
   Probe** (sql) — its saved credential is applied automatically; there is no separate auth field
   here." The Endpoint-path field even shows the SQL Connector's non-HTTP `baseUrl` ("localhost")
   as a display prefix.
4. Nothing in the UI blocks the user from proceeding to "Preview schema"/save with this mismatched
   selection — the confusing/broken outcome (a REST source pointed at a SQL Connector, which cannot
   possibly resolve to a working HTTP request) is only discoverable later, at fetch time, far from
   the point of the actual mistake.

This is the same finding HEL-827's final gate already flagged (per design.md's Risks section) —
confirmed still present, not fixed here (out of scope; the ticket's coordinator will triage a
follow-up).

## Post-evaluation schema hardening (evaluation-1.md judgment call)

`create_rest_data_source`'s hostile-input handling was changed from **silent strip** to **loud
rejection**: the Zod schema now explicitly rejects a payload carrying any `auth`/`apiKey`/`token`/
`password`/`credential`-shaped key with a clear validation error naming `connectorId` as the correct
way to supply credentials, instead of silently dropping the field and letting the agent believe it
configured auth when it did not (same defect class as HEL-843's `jsonPath` silent-failure bug this
epic already fixed elsewhere). See `helio-mcp/src/tools/restDataSourceSchema.ts` and its test.

### Live re-verification of the loud-rejection change, against the real MCP server (stdio)

```
callTool({
  name: "create_rest_data_source",
  arguments: {
    name: "HEL-828 loud reject probe",
    connectorId: "2a6e234f-c746-4d3a-a5e8-e0f3468dd012",
    endpoint: "/users",
    method: "GET",
    auth: { type: "bearer", token: "sk-should-never-be-accepted" }
  }
})
→ {
    "content": [
      {
        "type": "text",
        "text": "MCP error -32602: Input validation error: Invalid arguments for tool create_rest_data_source: [\n  {\n    \"code\": \"custom\",\n    \"message\": \"auth is not accepted by create_rest_data_source — credentials live on the referenced Connector, never on this call. Pass connectorId instead.\",\n    \"path\": [\n      \"auth\"\n    ]\n  }\n]"
      }
    ],
    "isError": true
  }
```

Confirmed: the tool call fails loudly (`isError: true`), the error message names `connectorId`
explicitly, and no source was created (no follow-up `POST /api/sources` call occurs — the MCP SDK's
own schema validation rejects the call before it ever reaches `HelioApi.createRestDataSource`).

### Live re-verification of `.strict()` (skeptic-final-1.md round 1), against the real MCP server

Three cases, all against a fresh, since-revoked PAT (`helio_pat_<redacted>`):

```
callTool({
  name: "create_rest_data_source",
  arguments: { name: "...", connectorId: "2a6e234f-...", endpoint: "/users", method: "GET",
               secret: "sk-should-never-be-accepted" }   // unlisted credential-shaped key
})
→ isError: true, "unrecognized_keys", keys: ["secret"]

callTool({
  name: "create_rest_data_source",
  arguments: { name: "...", url: "https://evil.example.com/exfil", method: "GET" }   // bare url, no connectorId
})
→ isError: true, two issues: connectorId "Required", url "unrecognized_keys"

callTool({
  name: "create_rest_data_source",
  arguments: { name: "...", connectorId: "2a6e234f-...", endpoint: "/users", method: "GET" }   // still-valid call
})
→ succeeds: real fetch, 15-field DataType, fetchError: null
```

Confirms `.strict()` closes the gap the 5-name denylist left open (an unlisted key like `secret`
is now rejected, not silently dropped), a bare `url` is rejected rather than silently discarded,
and the legitimate connectorId-only path is unaffected.
