## Skeptic Report — design gate (round 2, skeptic-design-3.md)

### Note on report numbering and a live-edit race observed mid-review

`next-report-number.sh` returned `skeptic-design-3.md` because this change directory already contains
**two** round-1 reports — `skeptic-design-1.md` (2 Change Requests) and `skeptic-design-2.md` (3 Change
Requests, the third being a `sourceId`-vs-inline-`type` precedence gap in D2 that `skeptic-design-1.md`
did not catch). The orchestrator's briefing for this round only described the two CRs from
`skeptic-design-1.md` and did not mention `skeptic-design-2.md`'s CR3 or its existence at all.

I also independently observed a live-edit race: my first full `Read` of `design.md`/`tasks.md` (early in
this session) did **not** contain any precedence-rule language for `sourceId` + inline `type` both being
present. A subsequent `grep` a few tool-calls later showed that language present. `stat`/`md5sum` showed
both files' mtimes were essentially "now" (within the same minute as my review) at that point, so I
re-read both files in full and then re-checked their hashes after an 8-second wait to confirm they had
stopped changing before treating that content as ground truth — per the evidence-discipline law's
"reproduce before you conclude" guidance for an anomalous read. The final, stable content **does**
include an explicit precedence decision (D2, new task 2.3 language, new test task 3.12) resolving exactly
the gap `skeptic-design-2.md`'s CR3 flagged, plus fixes for essentially every non-blocking note from both
round-1 reports (D5's misrouted-request status code, tasks.md 2.4's "needs factoring" mischaracterization,
tasks.md 3.1's stale-file fallback, the `checkQuery` test citation line number, and D4's `sourceName`
fallback when an inline source's `name` is absent). I verified this final content directly against the
codebase below, not from either round-1 report's narrative.

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-proposal-analyze-api/spec.md` in full (final, stable versions — confirmed via
  `md5sum` unchanged across an 8s re-check).
- `openspec validate dry-analyze-pipeline-proposal --strict` → `Change 'dry-analyze-pipeline-proposal' is valid` (run twice, same result).
- Re-verified the round-1 Change Requests against the actual codebase myself, not by trusting either
  prior skeptic report's prose:
  - **CR1 (schema step shape).** Read `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala:226-256` (`analyzeStepResponseFormat.write`) directly: each step serializes via a per-subtype `jsonFormat6` (e.g. `RenameAnalyzeStepResponse(id, position, config: RenameConfig, inputSchema, outputSchema, validationError)`), producing a nested **object** `config`, then adds `"type" -> JsString(s.\`type\`)` at the top level — confirmed no `op` field is ever emitted. Compared against `schemas/pipeline-analyze-response.schema.json`'s `$defs.AnalyzeStep` directly (`python3 -c 'json.load(...)'`): requires `op` (string) + `config` (string), `additionalProperties: false`, no `type` property — confirms the stale schema really would reject a real response on three grounds. design.md's new **D6** defines the new schema's step shape as `{id, position, type, config: object, inputSchema, outputSchema, validationError?}` against this actual wire format, not the stale `$defs` — matches ground truth. tasks.md 1.1 mirrors D6. tasks.md 3.11 adds the missing verification: read `backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala` in full and its one existing consumer (`WorkspaceContextServiceSpec.scala:141,150` — `JsonSchemaValidation.compile(...)` + `.validationErrors(schema, format.write(body).compactPrint)`) — the plan in 3.11 is a direct, feasible reuse of that exact pattern against the new schema. **CR1 is genuinely resolved**, not just asserted.
  - **CR2 (D2 config-absent branch).** Read `PipelineProposalProtocol.scala`'s `pipelineProposalSourceFormat.read` in full: `kind match { case Some("sql") => (None, None, config.map(_.convertTo[SqlSourceConfigPayload]), None); ... }` — confirmed `type: "sql"` with no `"config"` key present decodes cleanly to `sqlConfig = None` (no exception). Confirmed `SqlSourceConfigPayload(dialect, host, port, database, user, password, query)` is the real shape `sqlConfig.query` in D2 would dereference. design.md's D2 now has an explicit branch ("Recognized inline `type` but its matching config `Option` is `None`" → `ServiceError.BadRequest`), tasks.md 2.3 states the guard must run before touching the config value, and tasks.md 3.10 adds the test. **CR2 is genuinely resolved.**
  - **CR3 (sourceId/inline-type precedence, from `skeptic-design-2.md`, not mentioned in my briefing).** Confirmed via `python3 -c 'json.load(...)'` on `schemas/pipeline-proposal.schema.json`'s `$defs.PipelineProposalSource`: its own `description` states "Both forms are representable at once — this schema does not enforce mutual exclusivity; resolving which branch wins when both are present is an apply-time (HEL-342) concern" — confirming this is a real, schema-documented ambiguity, not invented. design.md now has an explicit new D2 sub-bullet: "`sourceId`, when present (`Some`), always wins" with a stated rationale (existing `sourceId` is the more specific, already-validated reference). tasks.md 2.3 restates the precedence and cites it explicitly; tasks.md 3.12 adds a test asserting the existing-source branch wins when both are supplied. **CR3 is genuinely resolved** (even though not surfaced in this round's briefing to me).
- Independently re-verified several other design claims directly against source, not taken on either report's word:
  - `backend/src/main/scala/com/helio/api/routes/PipelineRoutes.scala:21-45` — confirmed `pathPrefix("pipelines") { concat( ... path(PipelineIdSegment / "analyze") ...; path(PipelineIdSegment) ... ) }` — D5's routing claim and the required "place the new route first" instruction (task 2.5) are correct against the real file.
  - `backend/src/main/scala/com/helio/services/PipelineService.scala:181-190` — confirmed the existing `analyze()`'s `PipelineStepInput(id = s.id.value, position = s.position, op = s.kind, config = PipelineStepConfigCodec.encode(s))` construction, confirming D3's synthetic-id/compactPrint plan for `analyzeProposal` is a straightforward analog (op ← `req.type`, the only string discriminator available on `CreatePipelineStepRequest(type: String, config: JsObject)` — confirmed that case class's shape directly in `PipelineStepProtocol.scala:138`).
  - `backend/src/main/scala/com/helio/services/DataSourceService.scala:139-154,785-799` and `DataSourceProtocol.scala:115` (`CsvSourceConfigPayload(path: String)`) — independently confirmed the csv-non-analyzability claim: `createCsv` receives raw bytes from the route layer (not from the config payload) and only writes a file at creation time; `previewCsv` reads back from that file. An inline proposal's csv config genuinely cannot be dry-analyzed. Confirms D2's csv branch is a real constraint, not an invented one.
  - `find backend/src/test/scala/com/helio -iname "*PipelineAnalyze*"` → `PipelineAnalyzeRoutesSpec.scala` exists (route-level, `EmbeddedPostgres`-backed, confirmed by reading its header) and no standalone `PipelineServiceSpec`/`PipelineAnalyzeProposalSpec` exists — confirms tasks.md 3.1's corrected framing (new `PipelineAnalyzeProposalRoutesSpec.scala`, matching the sibling route-level convention) is accurate, unlike round 1's stale `PipelineServiceAnalyzeProposalSpec.scala` framing.
  - `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala:893-903` — confirmed the `checkQuery` short-circuit test ("return 400 and never invoke the connector when the SQL query contains DDL/DML") is right around the line tasks.md 3.5 now cites (894), not the round-1-cited 898.
  - `schemas/pipeline-analyze-response.schema.json`'s `$defs.SchemaField` (`{name, type}`, `additionalProperties: false`) vs. `DataTypeProtocol.scala:36` `SchemaFieldResponse(name: String, type: String)` — confirms D4's "reuse `SchemaField`/`SchemaFieldResponse` verbatim" claim is accurate.
- Confirmed the round-1 environmental note (missing `scripts/concertino/{next-report-number.sh,persist-evidence.sh,emit-event.sh}`) is resolved: `ls scripts/concertino/` now lists all three (plus other newer scripts), and `next-report-number.sh` ran successfully against this worktree, correctly returning `3` (collision-safe past both existing round-1 reports).
- Checked for residual placeholders/hand-waving: `grep -rn -i "TODO\|TBD\|figure out later\|to be decided\|placeholder"` across `design.md`/`tasks.md`/`proposal.md`/`spec.md` → no hits outside the two skeptic reports themselves (which legitimately quote each other's prior findings).

### Verdict: CONFIRM

All three Change Requests that were actually required to close this design's gaps — the two from
`skeptic-design-1.md` (stale schema step shape, missing config-absent D2 branch) and the one from
`skeptic-design-2.md` that this round's briefing didn't mention (sourceId/inline-type precedence) — are
genuinely resolved in the current `design.md`/`tasks.md`, each traced to real ground truth above rather
than taken on prose. Every non-blocking note from both round-1 reports was also folded in. I found no new
blocking gaps: the plan's building blocks (reused `PipelineAnalyzeService`, reused inline-source
inference/guard calls, owner-scoped RLS resolution, route ordering, the new D6 schema shape, the D2
precedence rule) all check out against the real files with the exact signatures/behavior design.md claims.
`openspec validate --strict` passes.

### Non-blocking notes

- `specs/pipeline-proposal-analyze-api/spec.md` doesn't add a Scenario for the new
  `sourceId`-and-inline-`type`-both-present precedence case (design.md D2 / tasks.md 3.12 cover it, just
  not the OpenSpec capability scenarios file). Optional for completeness; not required since the
  behavior and its test are already specified elsewhere.
- design.md D3 doesn't spell out `op = req.\`type\`` explicitly for the synthetic `PipelineStepInput`
  conversion (only discusses `id` and `config`). It's the only string discriminator available on
  `CreatePipelineStepRequest`, so there's no real ambiguity here, but a one-clause addition would make D3
  fully explicit.
