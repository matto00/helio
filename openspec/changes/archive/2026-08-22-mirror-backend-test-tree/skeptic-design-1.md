## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All commands run in `backend/src` of the worktree.

**Baseline / scope claims — CONFIRMED**
- `find test/scala/com/helio -name '*.scala' | wc -l` → `218`. Matches design.md's re-counted
  baseline and tasks.md 1.1.
- `mapping/mapping.tsv` = 136 lines (135 entries + header); `mapping/unmatched.txt` = 83 lines.
  135 + 83 = 218. Arithmetic is internally consistent with the live count.
- `ls test/scala/com/helio/testutil/` → `JsonLogCapture.scala`, `PdfFixtures.scala` (two files).
  Design's correction of the ticket's single-file claim (D6) is grounded.
- `find main -name '*ShapeEngine*'` → empty; `ls main/scala/com/helio/domain/shapes/` contains
  `SingleRowShape.scala`, `TopNShape.scala`, `TimeSeriesShape.scala`, `PivotMatrixShape.scala`.
  D4's reasoning ("Engine" is a stale name fragment, no main subject) is grounded.
- Main tree is genuinely nested two levels under `api/routes/*`, `api/protocols/*`,
  `services/*`, `infrastructure/persistence/*` (`find main -type d`), so the proposal's
  correction of the ticket's "flat" framing is grounded.
- Sampled `mapping.tsv` rows verified against the tree: `services/layout/PanelPackerSpec.scala →
  services.panels` (`main/.../services/panels/PanelPacker.scala` exists);
  `api/AclDirectiveSpec.scala → api.http` (`main/.../api/http/AclDirective.scala` exists);
  `api/protocols/MetricProtocolSpec.scala → api.protocols.metrics` (exists). The D1 mechanical
  rule holds on the sample.
- D5's negative claims verified: `find main -name 'PanelMetricBindingRoutes.scala'` → empty;
  `find main -name 'Aggregator.scala'` → empty. Both "no main file exists" statements are true.
- `main/.../services/auth/UserTierConfig.scala`, `api/protocols/sources/ImageUploadProtocol.scala`
  exist as D5 asserts.

**Scope bleed (HEL-802/803/804/811) — CONFIRMED clean.** Non-goals name them explicitly; no task
touches `backend/src/main`, no task changes assertions, adds tests, or renames spec classes.

**Verification standard (D8) — CONFIRMED sufficient.** Bytecode constant-pool comparison +
`sbt Test/compile` per batch + file-count parity + test-count parity + `rg 'com\.helio\.testutil'`
empty is a stronger bar than green-tests-alone, and D8 states the epic's own lesson as the reason.
D9's exclusion of `-Wunused` (HEL-807 undercount) is a correct, well-reasoned carve-out.

**Grounding of D3/D5 — REFUTED on four specific points.** Details below; each grep re-run to
confirm stability (the `ResourceTag` grep was run twice, case-sensitive and case-insensitive,
both empty).

### Verdict: REFUTE

The methodology (D1/D2), the D4 shape decision, D6, D7, D8, D9, and the scope boundary are all
sound and well-grounded. But four of D5/D3's *specific* "confirmed by grep" placements are
contradicted by the live tree — the exact "confidently-false documentation" failure mode this
epic has repeatedly hit, and the one D2 explicitly promises to avoid ("the actual main-tree grep
confirms it"). An executor following these as written will file specs in wrong packages that
still compile, which D8's sample-based bytecode check will not necessarily catch.

### Change Requests

1. **D3 is factually wrong about `PipelineProposalRoutes`, and contradicts D5.**
   D3 states the three route classes are "all in `api/routes/proposals/`" and instructs moving
   the `PipelineApplyProposal*` specs and `PipelineApplyProposalSpecBase` there. Ground truth:
   `find main -name 'PipelineProposalRoutes.scala'` →
   `main/scala/com/helio/api/routes/pipelines/PipelineProposalRoutes.scala`.
   `ls main/scala/com/helio/api/routes/proposals/` → `CombinedProposalRoutes.scala`,
   `DashboardAuthoringRoutes.scala`, `DashboardProposalRoutes.scala`, `README.md` — no pipeline
   proposal routes file. D5's final bullet meanwhile says `PipelineApplyProposal*Spec →
   pipelines`. Two decisions give the executor opposite targets for
   `api/PipelineApplyProposalSpec.scala`, `api/PipelineApplyProposalRollbackSpec.scala`, and
   `api/PipelineApplyProposalSpecBase.scala`. Correct D3's factual claim and resolve the
   contradiction to a single stated target for these three files.

2. **`AggregatorRegressionSpec` → `domain/engine` is not supported by the file.**
   D5 asserts it "tests aggregation behavior in `ExpressionEvaluator.scala`" and instructs
   verifying against the spec's own imports before moving. I did that verification:
   `test/scala/com/helio/api/protocols/AggregatorRegressionSpec.scala` imports only
   `com.helio.api.protocols.*` response/payload types, `com.helio.api.JsonProtocols`,
   ScalaTest, and `spray.json._`. It has zero `domain.*` imports — it is a JSON wire-format
   regression spec, not an engine spec. Re-derive its target from its actual subject
   (`JsonProtocols` / the protocol types it round-trips), not from the "Aggregator" name.

3. **`ResourceTaggingSpec` → `services/workspace` rests on a grounding claim that is false.**
   D5 says "confirmed: tag logic lives in `WorkspaceTeardownService.scala`". Ground truth:
   `grep -ril 'resourcetag' main/scala/com/helio` returns nothing (re-run case-sensitively:
   also nothing). `WorkspaceTeardownService.scala` merely consumes `req.tag` for teardown
   filtering. The spec itself (`test/.../api/routes/ResourceTaggingSpec.scala`) is a Route-level
   integration spec: its header comment says "tag persistence through create -> read, `?tag=`
   list filtering (owner-scoped), and wire-format absent-vs-null parity", and it imports
   `DataTypeRoutes`, `PipelineRoutes`, `DataSourceRoutes`, and `WorkspaceRoutes`. Placing a
   four-route cross-domain spec under `services/workspace` violates both D1's own subject rule
   and the ticket's "spec lives in the package matching the file under test". Re-derive, and
   state explicitly where genuinely cross-domain route specs land (a rule the design currently
   lacks — see CR 5).

4. **tasks.md 2.1 repeats the ticket's stale enumeration.**
   It reads "Move `AggregateStepSpec` and the four step specs into `domain/steps`". Live tree:
   `ls test/scala/com/helio/domain/*.scala` shows `AggregateStepSpec.scala` is the *only* step
   spec at `domain/` root; the four specs the task means (`AssertStepSpec`,
   `ChunkByTokenCountStepSpec`, `ExtractHeadingsStepSpec`, `SplitTextStepSpec`) are **already**
   in `test/scala/com/helio/domain/steps/`. As written the task instructs moving files that
   need no move and understates nothing but overstates the work; more importantly it is the
   ticket's stale text copied into the plan, which tasks.md 1.1 explicitly warns against.
   Rewrite 2.1 against the live listing. While doing so, note `domain/` root also holds
   `PipelineStepSpec.scala` (main subject: `domain/model/PipelineStep.scala`) and
   `InProcessPipelineEngineSpec.scala` / `AlertEventStateMachineSpec.scala` (main subjects in
   `domain/engine/`) — confirm these are covered by mapping.tsv rather than falling through.

5. **Add a stated rule for cross-domain / multi-route integration specs.**
   D5 resolves such files ad hoc and, per CRs 2 and 3, gets at least two wrong. Given
   `unmatched.txt` holds 83 files and the executor must resolve all of them (task 1.2) using
   D2/D5, the design needs an explicit disposition for "spec exercises N domains" (e.g. stays
   at the `api/routes/` package root, or goes to the domain of the primary assertion, named).
   Without it, 83 placements are executor judgment calls the design claims to have already made.

### Non-blocking notes

- D1 references `mapping/build-mapping.py` as an execution artifact; the directory currently
  holds only `mapping.tsv` and `unmatched.txt`. Fine as stated ("not committed source"), but the
  executor will need to regenerate or hand-extend, so task 1.2's "extend mapping.tsv" is the real
  contract — that's already correct.
- `scripts/concertino/next-report-number.sh` and `persist-evidence.sh` do not exist in this
  worktree's `scripts/concertino/` (it predates them); I used the main checkout's copies. Not a
  ticket issue, but the executor/evaluator may hit the same gap.
- D8's bytecode check is sample-based. Since the diff is expected to be ~200 mechanical file
  moves, consider making the sample explicitly cover at least one file from each of D1, D2, D3,
  D5, and D6 rather than an unspecified "representative sample".
