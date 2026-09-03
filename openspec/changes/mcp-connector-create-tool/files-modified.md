## Files modified

- `helio-mcp/src/tools/credentialDenylist.ts` — new: extracted `rejectCredentialField`, parameterized on tool name + alternative (Decision 3), shared by `restDataSourceSchema.ts` and `connectorSchema.ts`.
- `helio-mcp/src/tools/connectorSchema.ts` — new: `.strict()` Zod schema for `create_connector` (name/baseUrl/optional kind+authType, 5-field credential denylist, no `defaultHeaders`).
- `helio-mcp/src/tools/connectorHandlers.ts` — new: `createConnectorHandler` (Decision 2 refusal before any HTTP call + Decision 4b(i) constant `note`) and `augmentFetchErrorWithConnectorsHint` (Decision 4b(ii)), split out for cheap unit-test compile (mirrors `assertSchemas.ts`).
- `helio-mcp/src/tools/write.ts` — registers `create_connector` (delegates to `createConnectorHandler`); `create_rest_data_source` now augments `fetchError` via `augmentFetchErrorWithConnectorsHint` and its description names `create_connector`.
- `helio-mcp/src/tools/read.ts` — `list_connectors` now returns a second text block naming `create_connector` when empty, via the new exported `buildListConnectorsResult` (Decision 5).
- `helio-mcp/src/tools/restDataSourceSchema.ts` — `rejectCredentialField` now imported from `credentialDenylist.ts` (byte-identical denylist message, verified unmodified by existing tests); `connectorId`'s required/min-length message now names `list_connectors`/`create_connector` (task 2.6).
- `helio-mcp/src/helioApi.ts` — new `createConnector` method: `POST /api/connectors` with `config: {authType: "none"}` and a hardcoded literal `credential: ""` (Decision 1), mapped by field into `CreateConnectorResult`.
- `helio-mcp/src/types.ts` — new `CreateConnectorResult` interface (id/name/kind/host only).
- `helio-mcp/src/server.test.ts` — `create_connector` added to `EXPECTED_TOOL_NAMES` (task 4.6).
- `helio-mcp/README.md` — tool inventory row added for `create_connector`; `create_rest_data_source` row note updated.
- `helio-mcp/e2e/connector-authoring.ts` — new: 3-phase (setup/measured/teardown) live e2e proving AC1/AC5 against a throwaway user + `https://api.sleeper.app` (Decision 8), with an egress + `CONNECTOR_MASTER_KEY` preflight and hard AC5 pass criteria (task 4.7/4.7b/4.7c).

## Tests added/modified

- `helio-mcp/src/tools/connectorSchema.test.ts` — new: `.strict()`, denylist, authType handling.
- `helio-mcp/src/tools/connectorHandlers.test.ts` — new: refusal-before-HTTP-call proof, constant note, backend-error passthrough, `augmentFetchErrorWithConnectorsHint` cases.
- `helio-mcp/src/helioApi.createConnector.test.ts` — new: request-shape assertion (literal `credential: ""`, no other credential key) + response mapping.
- `helio-mcp/src/tools/read.buildListConnectorsResult.test.ts` — new: empty-list hint block vs. non-empty single-block.
- `helio-mcp/src/tools/restDataSourceSchema.test.ts` — extended: existing denylist assertions untouched; new case for the missing-`connectorId` message naming both tools.

## Design correction (found during live e2e run, task 4.8)

- `openspec/changes/mcp-connector-create-tool/design.md` Decision 8 — corrected the "the Connector is deleted" teardown claim: a real run showed the delete predictably 409s (`ConnectorHasDependents`) because the created data source is deliberately never reclaimed. The isolation claim ("nothing leaks across runs") is unaffected; the script already treats this as a non-fatal warning.

## Not done (out of my authority per task assignment)

- Task 5.1 (filing the deferred pending-connector-handoff follow-up ticket) — left unchecked per explicit instruction; Decision 7's placeholder left empty.

## Cycle 2 (evaluation-1.md CR1 + CR2)

- `helio-mcp/src/tools/connectorSchema.ts` — CR1: `authType` widened from `z.enum(["none","bearer","api_key"])` to `z.string().min(1).optional()` so every non-`none` value (predicted or not) reaches `createConnectorHandler`'s actionable `/connectors` refusal instead of dying at a bare Zod enum error. No handler change needed (`connectorHandlers.ts:31` already typed `authType?: string` and already refused anything `!== "none"`).
- `helio-mcp/src/tools/connectorSchema.test.ts` — CR1: replaced the "rejects an unrecognized authType value" case (which is no longer true post-widening) with "accepts an authType value outside the predicted enum (validation deferred to the handler)" asserting `success === true`; added a case for `authType: ""` (still rejected, `.min(1)`).
- `helio-mcp/src/tools/connectorHandlers.test.ts` — CR1: added a case for an arbitrary unpredicted `authType: "oauth"` asserting the refusal message contains `/connectors` AND `calls` has length 0 (the no-half-created-state proof), proving the general case rather than just the two enum values.
- `openspec/changes/mcp-connector-create-tool/design.md`, `tasks.md` — CR2 (orchestrator-owned, already committed by the other agent before this pass): Decision 7's follow-up ticket id recorded as HEL-955, tasks.md 5.1 checked.

Verified at runtime (not just by test): `createConnectorSchema.safeParse({authType: "oauth", ...})` now returns `success: true`, and `createConnectorHandler` given that same input returns the actionable `/connectors`-naming refusal with zero calls to `api.createConnector` — confirming AC3 / the spec delta's "or any value other than `none`" scenario is now literally true for the general case, not just `bearer`/`api_key`.

## Cycle 3 (skeptic-final-1.md CR1)

- `helio-mcp/src/tools/connectorSchema.ts` — replaced `.strict()` (whose `message` param is a
  fixed string, unable to name the actual offending key) with `.passthrough()` + a
  `.superRefine` that walks the parsed value's own keys and raises one custom issue per
  unrecognized key, naming BOTH the offending key and the `/connectors` out-of-band path — no
  diagnostic detail lost relative to `.strict()`'s default message. `createRestDataSourceSchema`
  (`restDataSourceSchema.ts`) is left untouched, per explicit instruction — its own spec text
  makes no equivalent promise.
- `helio-mcp/src/tools/connectorSchema.test.ts` — strengthened the `defaultHeaders`
  unrecognized-key case (previously asserted only `success === false`) to assert the message
  names both `defaultHeaders` and `/connectors`; added two new cases reproducing the skeptic's
  exact live findings — an arbitrary unpredicted key (`secret`) and a `config: {authType:
  "bearer"}` envelope — each asserting the message names both the offending key and
  `/connectors`.

Verified at runtime, not just via jest: built `dist/`, called `createConnectorSchema.safeParse`
with the skeptic's exact repro inputs (`{secret: "sk-LEAK"}`, `{config: {authType: "bearer"}}`)
and confirmed the message now names both the key and `/connectors`; also drove the SAME inputs
through the real MCP SDK (`Client.callTool` over an `InMemoryTransport`-linked `createServer()`,
mirroring `server.test.ts`'s harness) to confirm the SDK's own tool-call error path (not just a
raw `.safeParse()` call) surfaces the improved message to a real caller — the SDK wraps it as
`MCP error -32602: Input validation error: ... "secret is not accepted by create_connector —
... /connectors ..."`.

Correction re: a prior verbal claim in my own return summaries (not committed to any file in
this repo) that `check:no-credential-leak` was gate coverage for this change — the skeptic is
right that it scans zero files of this diff (frontend assistant surface + backend test
resources only). Noting this here per instruction; it was never written into `files-modified.md`
or any other committed artifact, so there is nothing in-repo to correct.

## Cycle 4 (skeptic-final-2.md CR1-3 — reverting Cycle 3's regression)

Cycle 3's `.passthrough()` + `.superRefine` fix (aimed at naming the offending key in the
message) regressed the boundary in three ways it never had under plain `.strict()`, all
reproduced live by the skeptic against a running MCP server and independently re-confirmed here:

1. `__proto__` bypass — `.passthrough()` assigns unknown keys onto the output object; assigning
   `"__proto__"` sets the prototype rather than an own key, so the `superRefine`'s
   `Object.keys(value)` walk never saw it. A `__proto__` payload was silently ACCEPTED and the
   tool went on to issue the backend HTTP call.
2. Empty advertised JSON Schema — `write.ts` registers this schema directly as a tool's
   `inputSchema`; the MCP SDK's `normalizeObjectSchema` only unwraps a `ZodObject` (via
   `.shape`), not the `ZodEffects` a `.superRefine` chain produces, so `create_connector`
   advertised `{"type":"object","properties":{}}` to every `listTools()` caller — losing the
   required-field and denylist-field advertisement entirely (runtime `callTool` enforcement
   still held; this was a discoverability/contract defect, not a security hole).
3. Masked message on the abort path — Zod skips a `ZodEffects` refinement once the inner object
   parse already produced a hard issue (e.g. missing `baseUrl`), so a partially-malformed call
   carrying an unrecognized key reported ONLY the other field's error, silently dropping the
   unrecognized-key message.

**Fix**: `helio-mcp/src/tools/connectorSchema.ts` — reverted to a plain
`z.object(createConnectorInputSchema).strict(UNRECOGNIZED_KEY_MESSAGE)`, a fixed message string
naming the `/connectors` out-of-band path. `createRestDataSourceSchema` untouched (out of
scope, confirmed by `git diff --stat` showing zero changes to `restDataSourceSchema.ts`).

**Spec concession** (already made by the coordinator/skeptic before this cycle, committed here):
`openspec/changes/mcp-connector-create-tool/specs/mcp-data-source-tools/spec.md` narrows "naming
BOTH the offending key and the out-of-band path" (in the message) to "identifying the offending
key (in the message or the issue payload) and naming the out-of-band path" — `.strict()`'s
`message` param is a fixed string that structurally cannot interpolate the key; Zod still
carries it on `issue.keys`, which is where the narrowed spec text now permits it to live.

**Tests**:
- `connectorSchema.test.ts` — added the mandatory `__proto__` regression test (with its own
  comment on why it is the single most valuable test on this surface); added an abort-path test
  proving the unrecognized-key issue (`secret`) fires alongside another field's failure
  (`baseUrl` missing) rather than being masked by it; updated the four existing
  key-in-message assertions to assert the key via `issue.keys` (where `.strict()` puts it)
  instead of the message string, and kept the `/connectors`-in-message assertion.
- `server.test.ts` — new `listTools()`-based test (`callTool` never reads the advertised
  schema, so no `callTool`-only test could have caught the empty-schema regression) asserting
  `create_connector`'s advertised JSON Schema is non-empty, has `required: [name, baseUrl]`,
  `additionalProperties: false`, and lists all five denylist keys.

Verified at runtime against the built `dist/` (not just jest): direct `safeParse` on the
skeptic's exact three repro inputs (`__proto__`, `secret` alone, `{name, secret}` with `baseUrl`
missing) plus a live `Client.listTools()` call over `InMemoryTransport` confirming the full
JSON Schema (14 properties, `required: [name, baseUrl]`, `additionalProperties: false`) is
advertised again, matching `create_rest_data_source`'s sibling behavior.

216/216 helio-mcp tests, 2588/2588 frontend tests, full pre-commit gate suite green.
