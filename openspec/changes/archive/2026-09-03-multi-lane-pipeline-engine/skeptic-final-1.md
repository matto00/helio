## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Gates, re-run by me in this worktree**
- `sbt test` → `Total number of tests run: 3659`, `Tests: succeeded 3659, failed 0`, EXIT=0. `FlywayNonSuperuserMigrationSpec` appears in the run output (line 440 of my log), so the migration gate actually executed rather than being silently absent.
- `npm run lint` 0, `npm run typecheck` 0, `npm test` → 252 suites / 2590 tests passed, `npm run check:schemas` 0, `npm run check:openspec` 0, `npm run check:scala-quality` → clean (147 soft warnings, pre-existing pattern).
- `tools/check-delta-headers.py` → 0 mismatches; `tools/check-legacy-field-coverage.py` → 0 uncovered; `openspec validate multi-lane-pipeline-engine --strict` → valid.

**CR1 (rows semantics) — restore is real and structurally anchored.** `InProcessPipelineEngine.scala:390` computes `trunkTerminalId` from `stepRepo.trunkOf(steps).lastOption`; `PipelineRunService.scala:929` computes the binary-refs write key from the identical call. Mutation probe: replacing line 390 with a `structuralRank`-last derivation makes exactly the two new parity tests fail ("result.rows is the trunk terminal's frame even when the trunk terminal itself has a tail", and the no-trunk fallback). Reverted.

**CR4/CR5 mutation spot-checks (2 requested, both done, individually).**
- Disabling the legacy-field branch in `SecondaryInput.decodeStrict` → 4 codec tests fail (all three op names + the CR4d ordering test). Reverted.
- Disabling the ancestor arm in `PipelineService.validateLaneReference` → `PipelineStepRoutesSpec` "POST rejects a lane stepId naming the new step's own ancestor, 400 naming the cycle" fails. Reverted.
Both probes confirm the tests bind the mechanism, not an incidental outcome.

**Silent-drop sweep, re-derived independently.** I grepped the whole backend `main` tree for child-set collapse (`childrenOf`, `parent_step_id` queries, `.find(_.position`, `.headOption`, `.head`) rather than for the named sites. Every child-set-collapsing site lives in `PipelineStepRepository` (`trunkOf`, `tailsOf`, `executionOrder`, `deleteInternal`), `InProcessPipelineEngine` (`structuralRank`, now `.flatMap`), `PipelineService` (two `trunkOf(...).lastOption` anchors) and `PipelineRunService` (one). I found **no ninth site**; the 8-site enumeration matches what I can see. `tailsOf`'s `expand` is genuinely `flatMap` now; `executionOrder` walks `trunkChildren.flatMap` with no `.find`. `deleteInternal`'s method body is byte-identical to base (`git diff` shows only added comment lines above it), and its selection rule is position-agnostic — the "pre-existing policy" claim holds by measurement, not by its own comment.

**V97 / migration.** Statements are bracketed `NO FORCE` / `FORCE ROW LEVEL SECURITY`, scoped by `op = '<op>' AND config::jsonb ? '<legacy field>'` so non-matching rows are excluded from the row set entirely (byte-identity is structural, not asserted). Real dump counts I verified myself in `hel904-real-dump.sql`: 2 `otherDataSourceId`, 4 `referenceDataSourceId`, **0** `rightDataSourceId`; lines 10163/10230 are the two real empty-id `lookup` drafts and the spec asserts both decode to `{"kind":"source","dataSourceId":""}` post-migration. Before-counts > 0 and after-counts == 0 for all three names, idempotence (re-running the three UPDATEs affects 0 rows), and a byte-identical control row (`bf7d6301-…`, a real `compute` row) are all asserted inside the non-superuser gate.
*Judgment on the synthetic join row:* it does not weaken the real-data evidence. The two shapes that actually exist in production (`union`, `lookup`, including both empty-id drafts) are proven on real rows; `join` has no real row to prove anything against, the seed is attached to a real dump pipeline id, and the substitution is recorded in design.md rather than passed off as real data. That is the honest handling.

**Three-way distinction (1a/1b).** `SecondaryInput.decodeStrict`: legacy field present → `StepConfigTypeMismatch` naming the field, checked *before* `secondaryInput` is even read (so legacy + valid new shape still errors); `None | JsNull` → `Default = Source("")`; malformed present value → named error. All three hold simultaneously and are each covered by a test I confirmed failable.

**Analyze delta vs code, literal wording.** The narrowed requirement now says source-kind "SHALL NOT be resolved at the analyze layer" and falls back to the documented passthrough. The code matches exactly: `inferUnion`/`inferJoin`/`inferLookup` derive only when `secondarySchema.isDefined`, and `secondarySchema` is populated only from `laneDependencyOf` → `results`, which can never hold a `DataSource`. I found no remaining SHALL in the delta the code fails to satisfy for this capability.

**Engine contract vs shipped code.** Items 1–5, 7–12 check out against the code I read (fence deleted at all three sites; `InvalidGraph` retained as a type but nothing raises it; `structuralRank` never special-cases position 0 beyond ordering; `nodeOutcomes` retains every node; disabled nodes transparent; lane path format is documented). **Item 6a does not hold on one of the three write paths** — see Change Request 1.

**UI.** No visual change: `UnionConfig.tsx` / `LookupConfig.tsx` render identically; the change is a narrow→wire widening at `useStepCardState` with two new tests asserting the persisted payload. I did not start the servers, because there is no changed view to judge visually and the wire-shape seam is covered by the jest suite I re-ran.

### Verdict: REFUTE

### Change Requests

1. **The single-call transactional create path validates a lane `stepId` as a request `clientId`, then persists that clientId verbatim — producing a pipeline that is accepted at write time and permanently unrunnable.** This is Engine contract item 6a's own failure mode ("a `stepId` naming a step that does not exist … is rejected at write time"), inverted: the request is *accepted* and the stored config names a step that does not exist.
   - Evidence (my probe, reproduced): a temporary test in `PipelineCreateTransactionalSpec` creating `laneA` / `laneB` / `rejoin(secondaryInput = {kind:"lane", stepId:"laneB"})` returns `Right`, and the persisted row is
     `{"mode":"byPosition","secondaryInput":{"kind":"lane","stepId":"laneB"}}`
     while the real step ids are `c65b77de-…, 520abbe2-…, 3f2ae520-…`. Probe reverted; worktree is clean.
   - Cause: `PipelineService.validateStepCrossOwnerRefs` (cycle 2, `PipelineService.scala:200-263`) checks the lane id against `byClientId`, but `buildStepsAction` (`PipelineService.scala:303-306`) inserts `typedConfig` unmodified — there is no clientId→real-id rewrite for `secondaryInput`, unlike `parentStepId` and `nodeStepClientId`, which are both resolved through `clientIdMap`/`stepIdMap`.
   - Consequence: every run of such a pipeline fails with `LaneReferenceError("… references lane step 'laneB', which does not exist in this pipeline")` → 422, and the editor cannot repair it (lane authoring is P2.2). The existing test "accept a union step whose lane secondaryInput names a valid sibling clientId" asserts only `Right` and therefore certifies the broken state as correct.
   - This is not cosmetic for HEL-914: the MCP/proposal surface is planned from this contract and the single-call create is its write path.
   - Required: either (a) rewrite the lane `stepId` through `clientIdMap` inside `buildStepsAction` when persisting (mirroring `parentStepId`), or (b) reject a `lane`-kind `secondaryInput` on the transactional path with a named error until it is supported — and state which in design.md's Engine contract, since three tickets read it. Either way add a test that asserts the **persisted** `secondaryInput.stepId` is a real step id (and, for (a), that the created pipeline actually runs), not merely that `create` returned `Right`.

### Non-blocking notes

- `FlywayNonSuperuserMigrationSpec.scala:164` cites `V97Hel911MigrationCoverageSpec` "for the exhaustive list" — no such spec exists anywhere in the tree. Dangling reference to a nonexistent artifact; drop it or point at the fixture lines.
- `PipelineService.scala:872` still says "listByPipelineInternal can now fail with InvalidGraph (executionOrder rejecting a malformed step graph)" — `executionOrder` no longer raises it. The `recover` itself is still useful; the comment is now false.
- `PipelineAnalyzeService.scala:177` scaladoc still describes `InProcessPipelineEngine`'s `InvalidGraph` structural validation ("single trunk child at position 0, no tail branching past a tail root") as an existing engine behaviour it deliberately doesn't replicate. That validation is gone.
- `openspec/specs/pipeline-execution/spec.md:156` still carries the `InvalidGraph` requirement; the delta correctly `## REMOVED`s it, so this resolves at archive — flagged only so nobody reads the live file as current after merge.
