## Skeptic Report — design gate (round 2, skeptic-design-2.md)

All commands run in the worktree; test-tree paths relative to `backend/src`.

### What I verified (with evidence)

**CR1 — D3 factual error + D3/D5 contradiction: RESOLVED.**
`find main -name 'PipelineProposalRoutes.scala'` → `main/scala/com/helio/api/routes/pipelines/PipelineProposalRoutes.scala`;
`ls main/scala/com/helio/api/routes/proposals/` → `CombinedProposalRoutes.scala`, `DashboardAuthoringRoutes.scala`,
`DashboardProposalRoutes.scala`, `README.md`. D3 now states exactly this and names `api/routes/pipelines/` as the
single target for `PipelineApplyProposalSpec` / `...RollbackSpec` / `...SpecBase`. D5's final bullet explicitly
removes the old duplicate. Grep of design.md confirms no second, conflicting target for those three files.
mapping.tsv rows 26–28 agree (`api.routes.pipelines`); rows 8–24 put the Dashboard/Combined family in
`api.routes.proposals`, matching D3's other half.

**CR2 — AggregatorRegressionSpec: RESOLVED and grounded in the file.**
`head -30 test/scala/com/helio/api/protocols/AggregatorRegressionSpec.scala`: imports are exclusively
`api.protocols.{auth,dashboards,panels,pipelines,sources}` plus `com.helio.api.JsonProtocols`; zero `domain.*`
imports; docstring reads "Locks in the byte-for-byte JSON wire shape of every top-level response / request type
after the per-domain protocol split." The revised D5 quotes this accurately, and the no-op (stay at
`api/protocols/` root) is a real main package — `ls main/scala/com/helio/api/protocols/*.scala` returns
`IdParsing.scala`, `PaginationProtocol.scala`, `ResourceProtocol.scala`. mapping.tsv row 32 records it as
`api.protocols (NO-OP, D5b)`.

**CR3 — ResourceTaggingSpec: RESOLVED and grounded; D5b now states the general rule.**
`head -25 test/scala/com/helio/api/routes/ResourceTaggingSpec.scala` confirms the four-domain import set
(`api.routes.pipelines.{DataTypeRoutes, PipelineRoutes}`, `api.routes.sources.DataSourceRoutes`,
`api.routes.workspace.WorkspaceRoutes`). The false "tag logic lives in WorkspaceTeardownService" claim is gone
and is now explicitly retracted in the text. `api/routes/` root exists in main (`ServiceResponse.scala`), so the
no-op lands in a real mirrored package. mapping.tsv row 62 records the no-op.

**CR4 — tasks.md 2.1: RESOLVED and accurate.**
`ls test/scala/com/helio/domain/*.scala` shows `AggregateStepSpec.scala` is the only step spec at `domain/` root;
`ls test/scala/com/helio/domain/steps/` shows `AssertStepSpec`, `ChunkByTokenCountStepSpec`,
`ExtractHeadingsStepSpec`, `SplitTextStepSpec` already in place. 2.1 now says exactly that and warns off the
ticket's stale framing. 2.2 additionally pins the three fall-through files; mapping.tsv rows 64/65/71/76 target
`domain.steps` / `domain.engine` / `domain.engine` / `domain.model`, and all four main subjects exist
(`domain/steps/AggregateStep.scala`, `domain/engine/AlertEventStateMachine.scala`,
`domain/engine/InProcessPipelineEngine.scala`, `domain/model/PipelineStep.scala`).

**CR5 — D5b adequacy: sufficient, not vague.** The rule is operational ("root of the smallest package that
already contains all of them"), gives two worked examples, and task 1.2/1.3 require each such case to be flagged
and recorded as an explicit no-op rather than silently dropped. Reviewing all 59 `unmatched.txt` entries: 44 are
named individually in D5 or fall under an unambiguous D2 domain prefix (`WorkspaceContextService*` → 7,
`PanelService*` → 6, `*Migration`/`Rls*` → 9, etc.); the residual judgment calls
(`ApiRoutesCorsErrorHandlingSpec`, `ApiTokenAuthSpec`, `ClaudeStreamAssemblySpec`,
`DashboardSnapshotValidationSpec`, `SchemaInferenceRegressionSpec`) each have a single obvious main subject
reachable by D1. That is ordinary executor work under a stated rule, not an unresolved design gap.

**Arithmetic / completeness — verified stronger than asked.**
`find test/scala/com/helio -name '*.scala' | wc -l` → 218. mapping.tsv = 160 lines (159 entries + header),
unmatched.txt = 59. 159 + 59 = 218. I also checked the two sets are **disjoint** (`comm -12` → 0 overlap) and
that their union is **exactly** the live listing (`comm -23` and `comm -13` against `find` output → both empty).
No file is double-counted, missing, or invented.

### Verdict: CONFIRM

All five round-1 change requests are addressed with corrections that hold against the live tree, and the two
reversals (CR2/CR3) are grounded in the specs' actual imports and docstrings rather than in name heuristics.
The mapping artifacts are now provably a complete, non-overlapping partition of the 218 files, which makes
task 1.2 a bounded, checkable job. D7/D8/D9 were already sound in round 1 and are unchanged apart from D8's
sample now being pinned to one file per decision category.

### Non-blocking notes

- **D5 vs. tasks.md 3.4, minor contradiction.** D5 sends `StructuredJsonLoggingSpec` to `infrastructure/` root,
  but main has no Scala file at that level (`ls main/scala/com/helio/infrastructure/` → `concurrency`, `crypto`,
  `persistence`, `storage`, `README.md`). Task 3.4 asserts every test package corresponds to a main package with
  only `testsupport` excepted, so this one file will trip that spot-check. D5's reasoning ("config, not code —
  don't force a false match") is sound; just add `infrastructure` root to 3.4's exception list so the executor
  doesn't churn on it.
- **D3's parenthetical counts are off by one in two places.** `DashboardApplyProposal*Spec` is described as (5);
  mapping.tsv rows 16–21 list 6. `CombinedApplyProposal*Spec` is described as (3); rows 10–13 list 4
  (DanglingRef, Regression, Rollback, Spec) plus the base class. mapping.tsv is the operative checklist and is
  complete, so no placement is at risk — but the prose counts are wrong.
- **Self-referential sentence in D5's Aggregator bullet**: "...same cross-cutting shape as
  `AggregatorRegressionSpec`'s own current placement, which is therefore already correct" — the comparison
  target was presumably `ResourceTaggingSpec`. Tautological as written; harmless but worth a one-word fix.
- Typo: "domain-prefix guesswrange" in D5's lead-in.
