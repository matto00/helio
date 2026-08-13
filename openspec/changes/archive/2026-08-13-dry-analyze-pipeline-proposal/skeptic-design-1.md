## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-proposal-analyze-api/spec.md` in full.
- `openspec validate dry-analyze-pipeline-proposal --strict` → `Change 'dry-analyze-pipeline-proposal' is valid`.
- Read the referenced ground-truth files directly (not taken on the design doc's word):
  - `backend/src/main/scala/com/helio/services/PipelineService.scala` (full file) — confirmed
    `analyze()`'s existing shape (source resolution → `PipelineAnalyzeService.PipelineStepInput` →
    `PipelineAnalyzeService.analyze` → `toAnalyzeStepResponse`), no `SqlConnector`/`RestApiConnector`
    currently injected.
  - `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` (full file) — confirmed it
    is a pure function (`Vector[PipelineStepInput] => Vector[AnalyzedStep]`, no DB/IO), so "reuse
    verbatim" is accurate, and confirmed the "Unknown op" fallback (`case unknown => (inputSchema,
    Some(s"Unknown op: '$unknown'"))`) already degrades gracefully rather than throwing — relevant to
    an unrecognized proposal step `type`.
  - `backend/src/main/scala/com/helio/services/SourceService.scala` — confirmed `inferSql`/`inferRest`
    call exactly `SqlConnector.checkQuery` → `SqlConnector.inferSchema` / `RestApiConnector.inferSchema`
    as design.md D2 claims, and that `RestApiConfigPayload.toDomain` returns `Either[String, RestApiConfig]`
    (can fail) while `SqlSourceConfigPayload.toDomain` returns a bare `SqlSourceConfig` (cannot fail).
  - `SqlConnector.scala` (`checkQuery`/`inferSchema` are on the `object`, no instance needed) and
    `RestApiConnector.scala` (`inferSchema` is an instance method) — confirmed `PipelineService` needs
    no new DI for SQL, and that `connector: RestApiConnector` is already a constructor param threaded
    into `ApiRoutes.scala` (`sourceService = new SourceService(dataSourceRepo, dataTypeRepo, connector)`
    at line 153) and trivially reachable for `pipelineService` at line 158.
  - `backend/src/main/scala/com/helio/api/routes/PipelineRoutes.scala` +
    `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — confirmed `PipelineIdSegment` is
    an unconstrained `Segment` matcher, validating design.md D5's route-ordering concern is real
    (though see Change Request 3 below on the precise failure mode claimed).
  - `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` /
    `DataTypeRepository.scala` — confirmed `findByIdOwned` is owner-scoped (`ctx.withUserContext` +
    `r.ownerId === ownerUuid`), returns `None` on a non-owned row (no existence leak), and that
    `DataSourceRepository` has no `findByIdShared` (data sources genuinely have no ACL grants) — D2's
    RLS-resolution plan is accurate.
  - `backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala` +
    `schemas/pipeline-proposal.schema.json` (HEL-379, merged) — confirmed the actual
    `PipelineProposalSource`/`PipelineProposal` shapes the new endpoint will consume.
  - `backend/src/test/scala/com/helio/api/protocols/PipelineProposalProtocolSpec.scala` — confirmed
    (test "tolerate every source-level optional field being absent") that an empty `source: {}` decodes
    to `PipelineProposalSource(None,None,None,None,None,None,None)`, and confirmed (test "omit the
    config key entirely when no per-kind config is populated") that `config` being entirely absent is a
    proven, already-exercised wire state for the writer side — establishing that "`type` set, `config`
    absent" is a real, reachable Scala/wire state, not a theoretical one.
  - `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — confirmed `PipelineProposalProtocol`
    is already mixed in, so `entity(as[PipelineProposal])` needs no new plumbing.
  - `schemas/pipeline-analyze-response.schema.json` vs.
    `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — read both in full
    and compared the schema's `$defs.AnalyzeStep` against the actual JSON the
    `analyzeStepResponseFormat.write` producer emits (see Change Request 1).
  - `git log --oneline -- schemas/pipeline-analyze-response.schema.json` (last touched HEL-233,
    2026-05-09) vs. `git log --all --oneline | grep CS2c-3a` (HEL-236, the commit series that
    introduced the discriminated-union `type` + typed nested `config` shape) — confirms the schema file
    predates and was never updated for that shape change.
  - `backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala` +
    `grep -rln JsonSchemaValidation backend/src/test/scala` — confirmed this harness exists and is used
    exactly once elsewhere (`WorkspaceContextServiceSpec`), and that no test currently exercises
    `pipeline-analyze-response.schema.json` against the live `/analyze` endpoint.
  - `DataSourceProtocol.scala` — confirmed `CsvSourceConfigPayload(path: String)` (design's csv claim),
    `StaticColumnPayload`/`StaticDataPayload(columns, rows)` (design's static claim).
  - `backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala` — confirmed the
    `deserializationError`-on-required-field → `400 BadRequest` pattern this ticket's AC #3 relies on is
    a proven, already-tested pattern at the route level (no custom `RejectionHandler` exists; Pekko's
    default handles `MalformedRequestContentRejection` as 400).

### Verdict: REFUTE

The overall shape of the plan is sound (reuse `PipelineAnalyzeService` verbatim, reuse the existing
inline-source inference/guard calls, owner-scoped RLS resolution, route-ordering care) and every
building block it names actually exists with the signature claimed. But two concrete gaps would either
produce wrong/untestable behavior or leave a stated acceptance criterion unverifiable as written:

### Change Requests

1. **AC #6 ("`sbt test` green; response validates against its schema") has no task that verifies it,
   and the design's stated plan for the new schema would fail that verification if attempted.**
   `tasks.md` §1.1 says the new `pipeline-analyze-proposal-response.schema.json`'s `steps` field reuses
   "the existing `$defs` shape from `pipeline-analyze-response.schema.json`". I compared that `$defs`
   (`schemas/pipeline-analyze-response.schema.json:54-73`) against what the real endpoint actually
   emits (`PipelineAnalyzeProtocol.scala:226-253`, `analyzeStepResponseFormat.write`):
   - Old schema's `AnalyzeStep`: requires `op` (string), `config` (**string**), forbids extra
     properties (`additionalProperties: false`), no `type` property declared.
   - Actual wire shape (confirmed via the formatter code, and via the file's own comment "After
     CS2c-3a the analyze response carries ... `type` discriminator + typed `config` object"): each step
     has a `type` discriminator, and `config` is a **nested typed object** (e.g. `RenameConfig`'s
     fields), not a string; there is no `op` field at all.

   `git log` confirms `schemas/pipeline-analyze-response.schema.json` was last touched at HEL-233
   (2026-05-09) and was never updated when HEL-236 (CS2c-3a) introduced the discriminated-union shape —
   this is pre-existing drift on the *existing* endpoint's schema, not something this ticket
   introduces. But this ticket's plan explicitly proposes copying that stale `$defs.AnalyzeStep` into
   the *new* schema, and none of `tasks.md`'s test tasks (§3.1–3.10) actually validate the new
   endpoint's JSON response against the new schema (e.g. via `JsonSchemaValidation`, the harness already
   used in `WorkspaceContextServiceSpec`). So AC #6 is asserted but untraceable to any planned test —
   and if a conscientious implementer *did* add that missing conformance check, it would fail against a
   correctly-implemented response (real: `type` + object `config`; schema: `op` + string `config`, no
   `type` allowed).

   **Required revision:** (a) define `pipeline-analyze-proposal-response.schema.json`'s step shape
   against the *actual* discriminated-union wire format (a `type` discriminator + object `config`,
   likely `oneOf` per step kind or a permissive object with `additionalProperties: true` if a full
   per-kind `oneOf` is out of scope), not a blind copy of the stale existing `$defs`; (b) add an
   explicit task in the Tests section that validates a real response against the new schema using the
   existing `JsonSchemaValidation` harness, so AC #6 has an actual verification signal.

2. **design.md D2 doesn't specify behavior when a proposal's `source.type` is a recognized inline kind
   (`sql`/`rest_api`/`static`) but the matching config field is absent** — a state proven reachable by
   the existing `PipelineProposalProtocolSpec` (its "omit the config key entirely" test exercises
   exactly this on the write side, and the hand-written reader's `kind match` on `Some("sql")` with no
   `"config"` key present yields `sqlConfig = None`, not a parse error). D2's per-branch prose reads as
   if `sqlConfig`/`restConfig`/`staticConfig` are always populated once `type` matches (e.g. "Inline
   `sql` → `SqlConnector.checkQuery(sqlConfig.query)`"), with no `None` case addressed. An implementer
   following that literally risks calling `.get`/pattern-matching into `None` and throwing — producing
   an unhandled 500 for a structurally-valid-per-schema proposal, directly contradicting D2's own stated
   principle for the sibling csv case ("this is a structurally valid proposal per the HEL-379 schema...
   it must fail through the normal `ServiceError` channel, not an unhandled exception").

   **Required revision:** add an explicit D2 branch: when `type` names a recognized inline kind but its
   matching config `Option` is `None`, return `ServiceError.BadRequest(s"inline '$type' source requires
   a 'config' object")` (mirroring the csv branch's already-correct treatment), and add a task-3.x test
   for at least one of these (e.g. `type: "sql"`, no `config`) asserting `400`, not `500`.

### Non-blocking notes

- design.md D5's stated failure mode ("an unordered placement would have the literal segment swallowed
  as a bogus pipeline id, returning a 404") is imprecise: `path(PipelineIdSegment)` only exposes
  `get`/`patch`/`delete`, so a misplaced `POST /pipelines/analyze-proposal` would actually surface a
  Pekko `MethodRejection` (→ 405) from that branch, not a 404, before Pekko's route engine would try
  the next `concat` alternative (an out-of-order new route would likely still be reached, given
  standard rejection-then-fallthrough `concat` semantics). This doesn't change the routing recommendation
  itself (placing the new route first is still correct and the safer/clearer pattern) — just the stated
  rationale is off by one status code. Not blocking.
- tasks.md §2.4's framing ("factoring the existing `PipelineService.toAnalyzeStepResponse` to accept a
  step-list pair rather than reading off a persisted `Pipeline`") mischaracterizes the current code:
  `toAnalyzeStepResponse(s: PipelineAnalyzeService.AnalyzedStep): AnalyzeStepResponse`
  (`PipelineService.scala:211`) already takes only an `AnalyzedStep`, not a persisted `Pipeline` — it
  needs zero factoring to be called again from a new `analyzeProposal` method on the same class. Not
  blocking (an implementer who reads the file, as required, will find it already fits), but worth
  tightening so the task doesn't send someone hunting for a refactor that isn't needed.
- design.md D4 doesn't say what `sourceName` should be when an inline source's `name` field is absent
  (also `Option[String]` per the HEL-379 schema, not required at the `PipelineProposalSource` level).
  Likely low-stakes (falls out naturally once Change Request 2's config-absent handling is decided,
  since an inline source realistically needs both `type`+`config`+`name` to be analyzable) but worth
  a one-line decision alongside the CR-2 fix rather than leaving it implicit.

### Environmental note (reporting infrastructure, not a design finding)

This worktree's HEAD (`93d317bd`) predates upstream commit `b81222cc` on `main`, which introduced
`scripts/concertino/{next-report-number.sh,persist-evidence.sh,emit-event.sh}` (among others) — none of
which exist in this worktree's `scripts/concertino/`. I used the canonical (read-only, no side effects)
copy of `next-report-number.sh` from the up-to-date `main` checkout at
`/home/matt/Development/helio/scripts/concertino/next-report-number.sh`, invoked against this worktree's
actual change directory, to get a collision-safe report number rather than guessing a fallback filename.
`persist-evidence.sh` and `emit-event.sh` are similarly missing from this worktree; the orchestrator
will need to use its own (main-checkout) copies for the persist/emit steps that follow this report, or
resync this worktree's `scripts/concertino/` from `main`.
