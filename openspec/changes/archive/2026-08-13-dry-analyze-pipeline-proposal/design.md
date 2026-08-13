## Context

`PipelineService.analyze` (`backend/src/main/scala/com/helio/services/PipelineService.scala:165`)
resolves an existing pipeline's source schema via `dataTypeRepo.findBySourceId`, converts persisted
steps to `PipelineAnalyzeService.PipelineStepInput`, and calls the pure schema-math engine
`PipelineAnalyzeService.analyze` (`backend/.../domain/PipelineAnalyzeService.scala`) — no DB writes,
no execution. This ticket needs the identical fold, but the source may not exist yet (an inline
`PipelineProposalSource`) and the steps have no persisted `PipelineStepId`.

Traced the three relevant inline-source resolution paths already in the codebase:
- SQL: `SourceService.inferSql` (`SourceService.scala:90`) calls `SqlConnector.checkQuery` (the
  DDL/DML keyword guard, `SqlConnector.scala:39`, already reused by `createSql`/`inferSql`/`testSql`)
  then `SqlConnector.inferSchema(config)` — a real query execution (`maxRows = 100`), no persistence.
- REST: `SourceService.inferRest` calls the injected `RestApiConnector.inferSchema`.
- Static: `DataSourceProtocol.StaticColumnPayload(name, type)` already declares the full schema
  inline — `DataSourceService.previewStatic` reads it straight off the stored payload with no
  sampling. A proposal's inline static source carries the same `columns` directly.
- CSV: `CsvSourceConfigPayload(path: String)` is *only* a path (`DataSourceProtocol.scala:115`). A
  real CSV source's bytes are written by `DataSourceService.createCsv` at creation time
  (`fileSystem.write(filePath, bytes)`) — for an unsaved proposal there is no file at any path yet.

## Goals / Non-Goals

**Goals:**
- Dry-analyze a `PipelineProposal`'s source + steps, reusing `PipelineAnalyzeService` verbatim.
- Reuse the exact existing inline-source guard/inference calls (`SqlConnector.checkQuery`,
  `SqlConnector.inferSchema`, `RestApiConnector.inferSchema`) rather than re-implementing them.
- RLS-correct existing-source resolution: an inaccessible `sourceId` returns 404 (no existence leak,
  matching every other owner-scoped lookup in this codebase), never another user's schema.

**Non-Goals:**
- Persisting anything, or actually creating the source/pipeline/steps (atomic-apply ticket).
- Inline `csv` source analysis — no bytes exist yet for an unsaved proposal (see Decision 3).
- MCP tool exposure (separate ticket).

## Decisions

**D1 — New method on `PipelineService`, not a new service class.** The ticket's own touch-list
names `PipelineService.scala`, and `analyzeProposal` needs the same `dataSourceRepo`/`dataTypeRepo`
`PipelineService` already has constructor access to, plus `PipelineAnalyzeService` — no new
collaborator besides `SqlConnector`/`RestApiConnector`, which the route layer's DI already threads to
`SourceService` and can equally be threaded to `PipelineService`. Alternative considered: a new
`PipelineProposalAnalyzeService` — rejected as premature indirection for one method that shares all
its dependencies with the existing `analyze`.

**D2 — Source-schema resolution branches on the proposal's source shape, one small pattern match:**
- `sourceId` present → `dataSourceRepo.findByIdOwned(sourceId, user)` (owner-only, matching
  `DataSourceService.refresh`'s existing pattern — data sources have no sharing/ACL grants unlike
  pipelines) → `None` maps to `ServiceError.NotFound` (404, no existence leak, the same convention
  `PipelineService`/`DataSourceService` already use everywhere). On `Some`, `dataTypeRepo.findBySourceId`
  exactly as today's `analyze` does.
- Inline `sql` → `SqlConnector.checkQuery(sqlConfig.query)` first (this **is** the "mirror
  `SourceService` read-only enforcement" the ticket calls for — it's the same call `inferSql` already
  makes, not a new parallel implementation), then `SqlConnector.inferSchema(sqlConfig)`.
- Inline `rest_api` → `RestApiConnector.inferSchema(restConfig)`, same as `inferRest`.
- Inline `static` → schema built directly from `columns: Vector[StaticColumnPayload]` — no call, no
  sampling, matching `previewStatic`'s zero-inference read of the same shape.
- Inline `csv` → `ServiceError.BadRequest("inline csv sources cannot be dry-analyzed — upload the
  file first (create the source) or reference its sourceId")`. Not a 500: this is a structurally
  valid proposal per the HEL-379 schema (schema allows `type: "csv"` inline), so it must fail through
  the normal `ServiceError` channel, not an unhandled exception.
- **Recognized inline `type` but its matching config `Option` is `None`** →
  `ServiceError.BadRequest(s"inline '$type' source requires a 'config' object")`. This is a real,
  proven-reachable wire state, not theoretical: `PipelineProposalProtocol`'s hand-written reader
  (`PipelineProposalProtocol.scala:72-76`) matches on `type` alone and independently `.map`s an
  absent `config` key to `None` per branch (e.g. `case Some("sql") => (None, None,
  config.map(_.convertTo[SqlSourceConfigPayload]), None)`) — `type: "sql"` with no `"config"` key at
  all decodes cleanly to `sqlConfig = None`, exactly as `PipelineProposalProtocolSpec`'s "omit the
  config key entirely" test already exercises on the write side. Every one of the three
  connector-backed branches above (`sql`/`rest_api`/`static`) must check for this `None` *before*
  touching the config value, and fail through `ServiceError` exactly like the `csv` branch — never a
  `.get`/unguarded pattern match that would throw and surface as an unhandled 500 for a
  structurally-valid-per-schema proposal.
- Neither `sourceId` nor a recognized inline `type` → `ServiceError.BadRequest("source must reference
  an existing sourceId or declare an inline type")`.
- **Precedence when both `sourceId` and an inline `type` are present on the same
  `PipelineProposalSource`.** `schemas/pipeline-proposal.schema.json`'s own `$defs.PipelineProposalSource`
  description flags this as unresolved at the schema level ("resolving which branch wins when both are
  present is an apply-time (HEL-342) concern") — but HEL-381 is the first consumer that must actually
  produce a schema for dry-analyze purposes, so it cannot defer to a not-yet-built apply path. Decision:
  **`sourceId`, when present (`Some`), always wins** — the existing-source branch resolves and the
  inline `type`/config fields are ignored entirely, matching the order the branches are already checked
  in (`sourceId` first) rather than leaving the precedence to fall out of bullet-list ordering implicitly
  (skeptic design-gate CR3). Rationale: an existing `sourceId` is the more specific, already-validated
  reference; a proposal that supplies both is far more likely to be stale/redundant inline data left over
  from an editing flow than an intentional override request.

**D3 — Steps convert to `PipelineAnalyzeService.PipelineStepInput` with synthetic ids.** A proposal's
steps (`Vector[CreatePipelineStepRequest]`) have no persisted `PipelineStepId`. `id` is only used by
`PipelineAnalyzeService.analyze` to label the returned `AnalyzedStep`, not to look anything up — a
positional synthetic id (`s"step-$i"`) is sufficient and mirrors how the response is already
positionally ordered. `config` is `req.config.compactPrint` (the `JsObject` case class already on
`CreatePipelineStepRequest`), matching the `String`-config shape `PipelineStepConfigCodec.decode`
(used by the existing `toAnalyzeStepResponse`) already expects.

**D4 — New response type, not a literal reuse of `PipelineAnalyzeResponse`.** `PipelineAnalyzeResponse`
requires `id`/`outputDataTypeId` — a proposal has neither (nothing is persisted). New
`PipelineAnalyzeProposalResponse(sourceName: String, outputDataTypeName: String, sourceSchema:
Vector[SchemaFieldResponse], steps: Vector[AnalyzeStepResponse])` reuses `SchemaFieldResponse`
verbatim and the existing per-subtype `AnalyzeStepResponse` union/`analyzeStepResponseFormat` Scala
types and formatter as-is (`PipelineService.toAnalyzeStepResponse(s: AnalyzedStep):
AnalyzeStepResponse` already takes only an `AnalyzedStep`, no persisted `Pipeline` — it needs no
factoring to be called again from `analyzeProposal`, see tasks.md 2.4). `sourceName` is the resolved
existing source's stored `name`, or the inline proposal's own declared `name` — when the inline
source's `name` is itself absent (`PipelineProposalSource.name: Option[String]`, not required at that
level per the HEL-379 schema), fall back to the proposal's own `pipelineName` field (always present,
required) rather than leaving `sourceName` empty or throwing. `outputDataTypeName` comes straight from
the proposal (already required on `PipelineProposal` per HEL-379's schema) — no derivation needed.

**Note — the *wire* shape of `steps` is a new schema, not a reuse of the existing
`pipeline-analyze-response.schema.json` `$defs.AnalyzeStep`.** That `$defs` entry (`op: string`,
`config: string`, no `type` property, last touched HEL-233) predates HEL-236/CS2c-3a's
discriminated-union rework and was never updated for it — the real `analyzeStepResponseFormat.write`
(`PipelineAnalyzeProtocol.scala:226-253`) has emitted a `type` discriminator plus a **nested typed
`config` object** (no `op` at all) since CS2c-3a shipped. Copying the stale `$defs` into the new
schema would make AC #6's "response validates against its schema" impossible to satisfy for a
correctly-implemented response. See D6.

**D6 — `pipeline-analyze-proposal-response.schema.json`'s step shape matches the actual wire format,
not the stale existing `$defs`.** Each `steps[]` entry is `{id, position, type, config, inputSchema,
outputSchema, validationError?}` — `type` a required string discriminator (one of
`PipelineStepKind`'s values), `config` a required **object** (`additionalProperties: true`, not typed
per-kind — a full per-kind `oneOf` union mirroring all 21 `AnalyzeStepResponse` subtypes is more
precision than this ticket's scope needs; a permissive object still catches the `op`/string-`config`
regression this gate exists to prevent), `inputSchema`/`outputSchema` arrays of the existing
`SchemaField` shape (reused verbatim, unchanged), `validationError` optional string. This is a
deliberate, documented divergence from `pipeline-analyze-response.schema.json`'s existing (stale)
`$defs.AnalyzeStep` — not a copy of it. Fixing the *existing* schema's drift is out of scope for this
ticket (pre-existing, unrelated to this endpoint); a follow-up may be filed for it (see Planner Notes).

**D5 — Route ordering.** `PipelineIdSegment` is an unconstrained `Segment` matcher
(`IdParsing.scala:19`), so `path("pipelines" / "analyze-proposal")` must be placed **before**
`path(PipelineIdSegment / "analyze")` and `path(PipelineIdSegment)` inside `PipelineRoutes`'s
`pathPrefix("pipelines")` `concat` block — Pekko route matching is first-match-wins within `concat`.
An unordered placement would have the literal `analyze-proposal` segment swallowed by
`path(PipelineIdSegment)` as a bogus pipeline id; since that branch only exposes `get`/`patch`/`delete`,
a misrouted `POST` would surface a Pekko `MethodRejection` (405), not a 404 — but placing the new route
first avoids depending on rejection/fallthrough ordering at all, which is the safer and clearer
pattern regardless of the exact misrouted status code.

## Risks / Trade-offs

- [Inline `csv` proposals can't be dry-analyzed] → Explicit, documented 400 with a clear message
  (D2) rather than a silent wrong answer or a 500 — an agent authoring a proposal learns immediately
  that it needs to create the CSV source first.
- [SQL inline inference executes a real query against a live external database] → Same trade-off
  `SourceService.inferSql` already accepts today (a real `SELECT`, capped `maxRows = 100`,
  30s statement timeout, `checkQuery` DDL/DML guard first) — this ticket adds no new exposure beyond
  what `inferSql` already ships.

## Planner Notes

- Self-approved: reusing `AnalyzeStepResponse`'s existing per-subtype union (rather than a flattened
  proposal-specific step response) to keep the wire shape identical to `GET /:id/analyze`'s steps —
  a consumer that already renders one can render the other with no branching.
- Self-approved: `PipelineAnalyzeProposalResponse` as a new schema/protocol rather than making every
  field on `PipelineAnalyzeResponse` optional — `id`/`outputDataTypeId` being unconditionally absent
  (never "sometimes present") is a cleaner contract than an always-optional field on the existing,
  already-shipped response type.
- Self-approved: defining the new schema's step shape against the actual wire format (D6) rather than
  copying `pipeline-analyze-response.schema.json`'s stale `$defs.AnalyzeStep` — fixing that existing
  schema's own drift (it still declares `op`/string `config`, unchanged since HEL-233, never updated
  for HEL-236/CS2c-3a's discriminated-union rework) is unrelated pre-existing debt, out of scope for
  this ticket; worth a separate follow-up ticket if the human wants it filed.
