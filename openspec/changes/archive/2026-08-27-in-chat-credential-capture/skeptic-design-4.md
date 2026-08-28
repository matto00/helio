## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Re-read all six artifacts (ticket.md, proposal.md, design.md, tasks.md, both spec deltas) in full
and re-derived every cited path, line number and structural claim from the live worktree, from
scratch — not by diffing against round 3.

### What I verified (with evidence)

**Round-3 CR-1 — tasks.md `url` propagation. FIXED.**
tasks.md 1.2 now reads "exactly one of `connectorId`/`url`/`newConnector` — `url` is KEPT"; 1.4
tests all three plus the two-of/zero rejections AND the adapter for BOTH the `connectorId`-only and
legacy `url`-only branches. 1.2's adapter now explicitly says "either `connectorId` set, or the
unchanged `url` legacy branch — never `newConnector`" and names `url` in the mapped field list.
This matches design.md Decision 2, proposal.md "What Changes", and the contract delta. Ground truth
behind it re-verified: `SourceService.createRest` (SourceService.scala:83-87) really does have the
`(None, Some(url))` arm and rejects only `(Some,Some)`/`(None,None)`;
`AssistantProposalToolSchemas.scala:123-125` still advertises the bare-`url` shape as dual-supported.

**Round-3 CR-2 — `ConnectorSummary` formatter citation. FIXED and correct.**
`grep -n` on `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala`:
`final case class ConnectorSummary(` at **:38** (fields exactly `id, name, kind, host`),
`jsonFormat4(ConnectorSummary.apply)` at **:98**. `WorkspaceContextProtocol.scala` imports it at :4,
declares `connectors: Vector[ConnectorSummary]` at :221, and its own four `jsonFormat4`s at
:231/:233/:235/:248 are `WorkspaceContextCounts`/`DataSource`/`Column`/`PipelineStep` — unrelated,
exactly as design.md 4c now states. `WorkspaceContextService.scala:252` `buildConnectors` returns
`Vector[ConnectorSummary]` via `ConnectorSummary.fromDomain`, so the structural pin targets the real
connector→model surface.

**Round-3 CR-3 — review-ui spec delta wire terms. FIXED.**
The delta now says "inside that step's `config` object (`PipelineProposalSource.config`, a
`type === "rest_api"`-discriminated payload; the client-side type has no `restConfig` field —
`restConfig` is a backend-only, wire-serialized-as-`config` name)", and all scenarios use
`config`/`pipeline.source.config`. The new legacy-URL scenario ("A legacy bare-URL step needs no
inline setup section") is present and consistent with design.md Decision 3's exclusion rule and
tasks 2.2. Ground truth: `frontend/src/features/pipelines/types/pipelineProposal.ts:16-21` types
`PipelineProposalSource` as `{sourceId?, type?, name?, config?: Record<string, unknown>}` — no
`restConfig`; `PipelineProposalProtocol.scala:76-79` writes all four kinds to `fields("config")`,
and :90 reads `case Some("rest_api") => config.map(_.convertTo[RestApiConfigPayload])`.

**Independently re-verified, all pass:**
- `CreateSourceRequest.config: RestApiConfigPayload` at `DataSourceProtocol.scala:177`; the payload
  itself at :142-159 (11 fields, `jsonFormat11` at :405) — so the "no jsonFormat11→12, payload
  untouched" claim holds.
- `PipelineProposalService.scala`: `apply` re-runs `validateStructure` at **:84**;
  `resolveRestSource` at **:208** builds `CreateSourceRequest(inlineName(source),
  DataSourceKind.RestApi, cfg, fieldOverrides = None)`; `validateStructure` at :95 and
  `validateInlineSource`'s `case DataSourceKind.RestApi => requireConfig(source.restConfig)` at :134
  — a coherent home for the new `validateRestConfig`.
- `package.json:8` is `"lint": "eslint . --max-warnings=0"`; `.husky/pre-commit` runs
  `npm run check:scala-quality` as its own line before `npm test` — the sibling-line wiring the
  design specifies is exactly the existing precedent.
- `grep -rniIl "credential" helio-mcp/src/` returns exactly the seven files design.md 4c and task
  3.5 list. `grep -rniIl "credential"` over `backend/src/main/scala/com/helio/ai/` and
  `.../services/assistant/` exits 1 (zero files) — the asserted baseline is real.
- `schemas/pipelines/pipeline-proposal.schema.json:52-54`: `config` is an unconstrained
  `{"type":"object"}`, so Decision 5's "don't tighten the schema, enforce at the service layer" is
  a fact about the schema, not a convenience.
- Components/thunks cited all exist: `connectors/ui/ConnectorCredentialField.tsx` (`mode:
  "create" | "rotate"` at :41), `CreateConnectorModal.tsx`, `connectors/state/connectorsSlice.ts`
  (`createConnector` thunk at :53).

**Adversarial checks that found nothing blocking:** no `TODO`/`TBD`/deferred decision in any
artifact; every AC traces to a task (inline render → 2.1/2.3; retrieval instructions → 1.3/2.1;
transcript/context/tool-result absence → 3.1/3.4/3.5; mechanical + demonstrated red → 3.3/3.4;
no re-display → design D3 pt 6 + review-ui delta's final scenario; pipeline/dashboard/combined →
2.3 + the delta's three kind scenarios); no task exceeds the ticket's scope; contract changes are
covered by both spec deltas; the two deltas do not contradict each other or design.md.

### Verdict: CONFIRM

The artifacts are now internally consistent and consistent with the live tree. Every remaining
observation below is cosmetic or an already-adjudicated non-blocking note; none would mislead an
executor into building the wrong thing.

### Non-blocking notes

- **`auth` is silently dropped from the proposal type (new observation, deliberately not a CR).**
  `RestApiConfigPayload` has 11 fields; `ProposalRestApiConfig` mirrors 10, omitting
  `auth: Option[JsValue]`. Today a model-emitted `config.auth` decodes and is then rejected at apply
  with a 400 (`SourceService.createRest:80-81`, "auth is not accepted on a REST source"); after this
  change it is dropped by the new reader and apply succeeds without it. The outcome is strictly
  safer and matches the post-HEL-824 rule that auth lives on the Connector — but it is an unstated
  behavior change on an error path. One sentence in design.md Decision 2 ("`auth` is deliberately
  omitted; `createRest` rejects it anyway") would close the gap.
- design.md Decision 2 still says the adapter maps "**9** shared fields" and then lists **10**
  (round-3 note, unfixed). List is right, count is off by one.
- Decision 5 attributes the "resolving which branch wins when both are present is an apply-time
  concern" disclaimer to `config`'s own description; it is actually on the enclosing `source`
  object's description (schema line 35) and is about `sourceId`-vs-inline. The substantive claim
  (the schema does not enforce mutual exclusivity) is nonetheless true of `config`, which is a bare
  unconstrained object at :52-54.
- Gate-Chain checklist's last bullet still ends "…before wiring it into `lint`", contradicting the
  correct sibling-`.husky`-line decision three bullets above (round-3 note, unfixed).
- design.md D3 pt 5 / task 2.1 still write `connectorsSlice.ts` without the `state/` path segment
  (round-2/3 note, unfixed; harmless).
- The schema's `config` description advertises `rest_api -> {url, method?, auth?, headers?}` — stale
  in three ways now (no `connectorId`, no `newConnector`, still lists `auth`). Documentation only;
  round 2 already ruled a refresh optional.
