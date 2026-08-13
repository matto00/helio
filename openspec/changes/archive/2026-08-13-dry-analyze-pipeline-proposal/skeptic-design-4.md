## Skeptic Report — design gate (round 2, skeptic-design-4.md)

### Note on report numbering

`next-report-number.sh` returned `skeptic-design-4.md` because this change directory already contains
`skeptic-design-1.md`, `skeptic-design-2.md` (both round 1, both REFUTE) and `skeptic-design-3.md` (a
prior round-2 pass, verdict CONFIRM, timestamped just before this run started). I read
`skeptic-design-3.md` after discovering it and treated it strictly as a claim to verify, not a fact — the
analysis below is my own, independently re-derived from the current on-disk artifacts and the actual
codebase, per my standing instructions to review "exactly as you would for a first-time review." Before
relying on `design.md`/`tasks.md`, I `md5sum`'d them, waited 8s, and `md5sum`'d again — identical hashes
both times, confirming the content I read is final/stable, not mid-edit (this mirrors the same
stability check `skeptic-design-3.md` describes performing for the same reason).

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-proposal-analyze-api/spec.md` in full (current, stability-confirmed versions).
- `openspec validate dry-analyze-pipeline-proposal --strict` → `Change 'dry-analyze-pipeline-proposal' is valid`.
- Independently re-verified each of the three required revisions against ground truth:
  1. **Schema step shape matches the real discriminated-union wire format (design.md D6).** Read
     `PipelineAnalyzeProtocol.scala:226-284` in full: `analyzeStepResponseFormat.write` dispatches to one
     of 21 per-subtype `jsonFormat6` formatters (e.g. `RenameAnalyzeStepResponse(id, position, config:
     RenameConfig, inputSchema, outputSchema, validationError)`), each producing a nested **object**
     `config`, then merges in `"type" -> JsString(s.\`type\`)` — no `op` field anywhere. Read
     `schemas/pipeline-analyze-response.schema.json` in full: its `$defs.AnalyzeStep` requires `op`
     (string) + `config` (**string**), `additionalProperties: false`, no `type` property — a real
     response would fail validation against it on three independent grounds. `design.md` D6 now defines
     the *new* schema's step shape as `{id, position, type, config: object, inputSchema, outputSchema,
     validationError?}` against the actual wire format, explicitly *not* a copy of the stale `$defs` —
     `tasks.md` §1.1 mirrors this. `tasks.md` §3.11 adds the missing verification signal for AC #6:
     validate a real `analyzeProposal` response against the new schema via the existing
     `JsonSchemaValidation` harness (confirmed this harness exists and is used exactly once elsewhere,
     `WorkspaceContextServiceSpec`). **Genuinely resolved**, traced to code, not asserted.
  2. **D2's config-absent branch (design.md D2, tasks.md §2.3/§3.10).** Read
     `PipelineProposalProtocol.scala`'s `pipelineProposalSourceFormat.read` in full: `kind match { case
     Some("sql") => (None, None, config.map(_.convertTo[SqlSourceConfigPayload]), None); ... }` —
     confirmed `{"type": "sql"}` with no `"config"` key decodes cleanly to `sqlConfig = None`, no
     exception. Read `schemas/pipeline-proposal.schema.json`'s `$defs.PipelineProposalSource` — no
     `required` array, so this is structurally valid per the shipped HEL-379 schema, not hypothetical.
     Confirmed `grep -rln "ExceptionHandler" backend/src/main/scala/` has no results, so an unguarded
     `.get`/match into this `None` would surface as an unhandled Pekko-default `500`. `design.md` D2 now
     has an explicit branch: "Recognized inline `type` but its matching config `Option` is `None`" →
     `ServiceError.BadRequest(...)`, explicitly naming all three connector-backed branches
     (`sql`/`rest_api`/`static`) and requiring the guard run "before touching the config value... never a
     `.get`/unguarded pattern match." `tasks.md` §2.3 restates this ordering; §3.10 adds the test.
     **Genuinely resolved.**
  3. **Precedence rule for `sourceId` + inline `type` both present (design.md D2, tasks.md §2.3/§3.12).**
     Read `schemas/pipeline-proposal.schema.json`'s `$defs.PipelineProposalSource.description` directly:
     "Both forms are representable at once — this schema does not enforce mutual exclusivity; resolving
     which branch wins when both are present is an apply-time (HEL-342) concern" — confirms this is a
     real, schema-documented ambiguity HEL-381 must resolve for itself (no apply path exists yet to defer
     to). `design.md` D2 now states explicitly: "`sourceId`, when present (`Some`), always wins... the
     inline `type`/config fields are ignored entirely," with a stated rationale. `tasks.md` §2.3 restates
     the precedence and cites checking `sourceId` "first, before any inline branch"; §3.12 adds a test
     asserting the existing-source branch wins when both are supplied. `spec.md` adds a matching
     "Requirement: An existing sourceId takes precedence over an inline source" section with a scenario.
     **Genuinely resolved.**
- Cross-checked the supporting technical claims design.md relies on directly against source (not taken on
  the design doc's or either prior skeptic report's word):
  - `PipelineService.scala` (full file): `analyze()`'s real shape (source resolution →
    `PipelineAnalyzeService.PipelineStepInput` → `PipelineAnalyzeService.analyze` →
    `toAnalyzeStepResponse`); confirmed `toAnalyzeStepResponse(s: PipelineAnalyzeService.AnalyzedStep):
    AnalyzeStepResponse` (line 211) takes only an `AnalyzedStep`, not a persisted `Pipeline` — needs no
    factoring to be reused, matching D4/tasks.md §2.4's (corrected) framing.
  - `PipelineAnalyzeService.scala` (full file): confirmed pure function, no DB/IO — "reuse verbatim" is
    accurate; confirmed the unknown-op case degrades to `(inputSchema, Some("Unknown op..."))` rather than
    throwing.
  - `SourceService.scala` (full file): confirmed `inferSql`/`inferRest` call exactly `SqlConnector.
    checkQuery` → `SqlConnector.inferSchema` / `RestApiConnector.inferSchema` as D2 claims, and that
    `connector: RestApiConnector` is already a `SourceService` constructor param.
  - `ApiRoutes.scala`: confirmed `connector` is available at the construction site (`sourceService = new
    SourceService(dataSourceRepo, dataTypeRepo, connector)` at line 153) and reachable to thread into
    `pipelineService` (line 158) — D1's DI claim holds.
  - `PipelineRoutes.scala` (full route block) + `IdParsing.scala`: confirmed `PipelineIdSegment` is an
    unconstrained `Segment` matcher and the existing `concat` block's ordering (`analyze` then bare id) —
    D5's routing plan (place `analyze-proposal` first) is correct and necessary.
  - `DataSourceProtocol.scala`: confirmed `CsvSourceConfigPayload(path: String)` (no inline-bytes field)
    and `StaticColumnPayload`/`StaticDataPayload(columns, rows)`, matching D2's csv/static claims.
  - `PipelineStepProtocol.scala:138`: confirmed `CreatePipelineStepRequest(\`type\`: String, config:
    JsObject)` — D3's `req.config.compactPrint` claim is accurate.
  - `PipelineProposalProtocolSpec.scala`: confirmed the "omit the config key entirely" and "tolerate every
    source-level optional field being absent" tests exist, independently corroborating that the
    config-absent state is proven-reachable on the write side, not theoretical.
  - `workflow-state.md`: `SKEPTIC_DESIGN_ROUNDS: 3`, so this is within the configured round budget.
- Checked for residual placeholders/hand-waving/contradictions: `grep -rn -i "TODO\|TBD\|FIXME\|figure out
  later"` across `design.md`/`tasks.md`/`proposal.md`/`spec.md` → no hits. Traced all 7 acceptance
  criteria in `ticket.md` to specific tasks: AC1→3.2, AC2→2.4, AC3→3.7/3.8, AC4→3.5, AC5→3.9, AC6→3.11+3.13,
  AC7→additive-only design (no task needed, nothing modifies the existing `/analyze` route). No AC is left
  uncovered.

### Verdict: CONFIRM

All three required revisions from round 1 (schema step shape per the real discriminated-union wire
format, the config-absent 400 branch, and the sourceId-vs-inline-type precedence rule) are genuinely
present in the current `design.md`/`tasks.md`/`spec.md` and independently verify against the actual
codebase — not merely asserted. I found no new blocking gaps in this pass: every building block the
design names (reused `PipelineAnalyzeService`, reused inline-source inference/guard calls, owner-scoped
RLS resolution via `findByIdOwned`, the route-ordering fix, the new D6 schema shape, the D2 precedence
rule and config-absent guard) checks out against the real files with the exact signatures/behavior
claimed. `openspec validate --strict` passes.

### Non-blocking notes

- `specs/pipeline-proposal-analyze-api/spec.md`'s CSV scenario and precedence scenario are both present
  and match `design.md`/`tasks.md`; no drift found between the spec delta and the implementation plan.
- design.md D3 still doesn't spell out `op = req.\`type\`` explicitly for the synthetic
  `PipelineStepInput` conversion (only discusses `id` and `config`) — it's the only string discriminator
  available on `CreatePipelineStepRequest`, so there's no real ambiguity, but a one-clause addition would
  leave nothing implicit for the executor.
