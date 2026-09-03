# Evaluation Report — Cycle 2 (evaluation-2.md)

Re-check of `evaluation-1.md`'s six change requests plus the post-review `buildStepsAction` defect.
Reviewed at `62762857` (archive commit) on top of `b498a420`, base `a9d1bdcd`.

**Note on filename:** the change was archived in `62762857`, so `openspec/changes/multi-lane-pipeline-engine/` no longer holds the artifacts and `next-report-number.sh` against it reported `number=1` (it cannot see cycle 1's report, which moved to the archive). Numbered against the **archive** directory instead, where `evaluation-1.md` actually lives, so this does not overwrite it.

## Gates — re-run independently

| Gate | Result |
| --- | --- |
| `cd backend && sbt test` | **3660 succeeded, 0 failed** ✅ — matches the claimed 3660/3660 exactly (was 3631 at cycle 1; +29) |
| `npm run lint` | clean ✅ |
| `npm run format:check` | clean ✅ |
| `npm test` | 252 suites / **2590** tests passed ✅ (+2, the CR6 widening tests) |
| `npm --prefix frontend run build` | ✅ |
| `npm run check:scala-quality` | clean (147 soft warnings) ✅ |
| `npm run check:schemas` | in sync ✅ |
| `npm run check:openspec` | **clean at HEAD** ✅ — see non-blocking note 1 |

`check:openspec` reports a failure *in this worktree only* (`change "multi-lane-pipeline-engine" has no tasks`). Cause is a stray **untracked** file, `openspec/changes/multi-lane-pipeline-engine/auditor-report.md`, left by the agent-merge auditor — `git ls-files` on that directory is empty, so it is absent from the commit and from CI. Verified by checking out `HEAD` into a throwaway detached worktree and running `node scripts/check-openspec-hygiene.mjs` there: `openspec/ is clean`, exit 0. The throwaway worktree was removed (`git worktree remove --force`) and `git worktree list` confirms no straggler.

---

## Change requests — disposition

**CR1 — `TreeWalkResult.rows` parity break: RESOLVED.**
`lastFrame` is deleted; `executeTree` now returns `stepRepo.trunkOf(steps).lastOption` → that node's `nodeOutcomes` frame, falling back to the untouched root frame when there is no `position == 0` root child (`InProcessPipelineEngine.scala:334-394`). This is the *same expression* `PipelineRunService.scala:929` uses for the binary-refs write key, so the two cannot structurally diverge again — the right fix, not merely a patch. Both divergent shapes I named are now tested (`InProcessPipelineEngineTreeWalkSpec.scala:118-142`), and both are discriminating: each asserts `result.rows` **and** the referenced tail's own `nodeOutcomes` frame, which differ in row count, so a regression to "last frame evaluated" fails.

> **Concession — my secondary claim was wrong, and I withdraw it.** I wrote that CR1 "made stale" the comment at `PipelineRunService.scala:418` and offered that as evidence the divergence went unconsidered. The executor pushed back with evidence and is correct: I verified the comment is **byte-identical at `a9d1bdcd`, `b59d453e` and `HEAD`** (`git show <rev>:… | grep -A4`), it lives in `previewStep`, and CR1's fix makes its statement true again. No edit was needed, and the "evidence it wasn't considered" inference was an overreach on my part. CR1's *primary* claim — the parity break itself — was real and is the finding that stands.

**CR2 — silent-drop property sweep: RESOLVED, and the executor found a site I missed.**
- `tailsOf`'s `expand` converted from `childrenOf(...).headOption` to `root +: childrenOf(...).flatMap(expand)` (`PipelineStepRepository.scala:762-767`). Tested by a tail node with two further children asserting no id is missing from the union of entries (`PipelineStepRepositoryTreeOrderingSpec.scala:128-141`) — red pre-fix.
- `trunkOf`'s `.find(_.position == 0)` deliberately kept, with all five callers enumerated and the "one deterministic scalar anchor" rationale documented at the method, plus a direct determinism test with two genuine `position == 0` lanes (`:73-80`). I accept this: CR1's fix now *binds* `executeTree`'s `rows` to this same function, so the convention is load-bearing and shared rather than five independent guesses.
- **Third site, found by the executor's re-derived sweep and not by mine:** `deleteInternal`'s `childrenSorted.headOption` (`PipelineStepRepository.scala:635`), which *deletes* every non-absorbed child's subtree rather than merely dropping it from a listing. I independently confirmed the executor's justification for not touching it: the method body is **byte-identical to base `a9d1bdcd`** (diffed the whole `deleteInternal` block) and its selection rule is `sortBy(_.position).headOption` — position-**agnostic**, so its correctness never depended on the deleted "at most one `position == 0`" fence. Correctly flagged and spun off (HEL-966) rather than silently changed inside an engine ticket. That is a better call than folding it in.
- **Independent re-sweep:** `grep` for a single-element selection over any parent-keyed child set across all of `backend/src/main` returns exactly `trunkOf:729` and the `deleteInternal` SQL above. No ninth site.

**CR3 — analyze delta vs. code: RESOLVED, and the code moved rather than only the spec.**
Lane-kind both-input derivation is genuinely implemented: `analyzeNodes` is now a topological pass honoring the lane dependency edge, and `inferUnion`/`inferJoin`/`inferLookup` consume a `secondarySchema` (`PipelineAnalyzeService.scala:173-262, 399-440, 826-895`). `join` gained its first dispatch case (it previously fell to the `unknown`-op arm, emitting a spurious `Unknown op: 'join'`); no live spec or test asserted that old behaviour, and the change is covered.
I checked the narrowed requirement sentence against the code clause by clause — **no remaining SHALL the code does not satisfy**:

| Delta clause | Code |
| --- | --- |
| lane-kind → derived from both inputs (`join`/`union`/`lookup`) | `inferJoin`/`inferUnion`/`inferLookup` all consume `secondarySchema` ✅ |
| source-kind → secondary NOT resolved | `secondarySchema` is always `None` for source-kind (no repo at this layer) ✅ |
| source-kind `union` → identity passthrough | `case None => (inputSchema, None)` ✅ |
| source-kind `join` → parent lane's schema unchanged | `case None => (inputSchema, None)` ✅ |
| source-kind `lookup` → columns appended, best-effort typing | empty `secondaryTypes` → `"string"` placeholder ✅ |

The tests discriminate rather than confirm: lookup asserts the resolved type is `"float"`, not the `"string"` placeholder; union asserts `result("rejoin").outputSchema should not equal result("laneA").outputSchema`; join asserts the secondary side wins a name collision. The "spec overreach, not implementation shortfall" framing is accurate — source-kind derivation never existed at any point before this change either — and the residue is tracked as HEL-965.

**CR4 — legacy-shape rejection untested: RESOLVED.**
Seven codec tests plus three route tests, covering all three ops for the legacy flat field (`422`, nothing created), an unrecognised `kind`, `kind: lane` with no `stepId`, `kind: source` with no `dataSourceId`, and — the one I specifically asked for — CR4d, the legacy field present *alongside* a valid `secondaryInput`, pinning `decodeStrict`'s legacy-check-first ordering.

**CR5 — write-time lane arm untested; transactional path unguarded: RESOLVED.**
Five route tests including the cross-tenant case. I read that one in full: it seeds a second user, data source, pipeline and step via real SQL, then asserts `422`, that the response names the foreign step id, and that `GET /steps` still returns exactly one step — i.e. status, message and persisted state, independently. `validateStepCrossOwnerRefs` gained a request-scoped mirror of the same three checks for the single-call create path, with three "nothing persisted" tests.

**CR6 + non-blocking items — RESOLVED.** Frontend widening tests added (`useStepCardState.test.ts:193+`); the RFC-2119 warning is gone; the stale `*DataSourceId` test names are cleaned (grep returns nothing); the `PipelineStepRepository` indentation drift is fixed.

## The post-review `buildStepsAction` defect — both parts confirmed

**The fix is real.** `rewriteLaneClientId` (`PipelineService.scala:283-299`) rewrites a `lane`-kind `secondaryInput`'s request `clientId` to the real persisted `PipelineStepId` through the *same* `clientIdMap` the adjacent `parentStepId` line uses, and returns `Left(clientId)` — surfaced as a named `BadRequest` — when the reference is forward and therefore genuinely unresolvable in a single left-to-right fold. That limitation is reported loudly rather than absorbed, is documented in design.md (§141/§147/§372) with a measured cost estimate, and matches a convention that already governed `parentStepId` at base (`PipelineService.scala:252` pre-ticket) and the proposal path. Failing by name is the correct choice over silently re-persisting the unresolved clientId.

**The replacement test is real coverage.** The old test asserted only that create returned `Right` — it certified the broken state. The new one (`PipelineCreateTransactionalSpec`, "…persist the REAL step id (not the clientId), and the pipeline actually runs") asserts two independent things: (a) persisted state — `rejoinStep.config.secondaryInput shouldBe SecondaryInput.Lane(laneBStep.id.value)` **and** `should not be SecondaryInput.Lane("laneB")`, with laneB identified by its own distinguishing config rather than by position; and (b) behaviour — the persisted pipeline actually runs through the real engine and the rejoin node appears in `nodeOutcomes`. Either leg alone would catch the defect. This is exactly the "assert what it produced, not that the call succeeded" correction the lesson calls for.

## Live verification at HEAD (not just unit tests)

The backend that `start-servers.sh` reported as "already healthy" was the **cycle-1 build**; reusing it would have proved nothing about this cycle. I killed it (pid 3108320) and restarted so the running binary is HEAD, then exercised the arms end-to-end:

| Probe | Result |
| --- | --- |
| `GET /analyze` on the real migrated `union-eval-pipeline` | 200, per-step schemas, no spurious validation errors |
| `POST /steps` with `{"kind":"lane","stepId":"no-such-step-xyz"}` | **422** — `Lane reference 'no-such-step-xyz' does not exist in this pipeline.` |
| `POST /steps` with a lane ref naming the new step's own parent | **400** — `…would create a cycle (it is an ancestor of this step).` — matches the ticket AC's literal "400 naming the cycle" |
| `POST /steps` with `{"kind":"other",…}` | **422** — `'secondaryInput.kind' must be 'source' or 'lane', got 'other'.` |
| `POST /steps` with legacy `otherDataSourceId` | **422** — `'otherDataSourceId' is no longer a valid config field. Use 'secondaryInput': …` |
| Post-probe `SELECT count(*) FROM pipeline_steps` for that pipeline | still **4** — nothing persisted by any rejected request |

---

### Phase 1: Spec Review — PASS

All cycle-1 issues closed. Live capability specs reflect the shipped behaviour: `pipeline-execution` no longer carries the Phase-1 `InvalidGraph` requirement (REMOVED block applied), `pipeline-analyze-api` carries the narrowed and now-accurate requirement, and `pipeline-lane-walk` / `pipeline-lane-rejoin-input` exist as new capabilities. Task 11.8's wording was corrected rather than left ticked against unimplemented behaviour. Two genuine scope reductions (source-kind analyze derivation, forward lane references via the single-call path) were escalated or recorded rather than absorbed, each with a spinoff or a documented rationale.

### Phase 2: Code Review — PASS

No new findings. DRY/readability/modularity/type-safety/error-handling/dead-code are clean; the new helpers (`rewriteLaneClientId`, `inferUnion`/`inferJoin`, `validateLane`) are small, single-purpose and placed next to the code they mirror.

### Phase 3: UI Review — PASS

Re-run against a HEAD backend. Pipeline list and detail render; a post-V97 `lookup` step still displays its migrated reference source; analyze returns per-node schemas; rejected writes surface named messages rather than blank screens or unhandled exceptions. Only console error is the pre-existing benign `404 /schedule`. No layout breakage at 768/1440.

### Overall: PASS

## Non-blocking Suggestions

1. **Delete the stray `openspec/changes/multi-lane-pipeline-engine/auditor-report.md`** in this worktree (untracked, left by the agent-merge auditor). It makes `check:openspec` fail locally for anyone who runs it here, while HEAD is clean — a false alarm waiting to cost someone an investigation.
2. **`PipelineService.scala:995`'s comment slightly overstates its claim.** "exactly mirroring `persistNewStep`'s real placement logic" holds for the no-`parentStepId`/no-`position` branch (both use `trunkOf(current).lastOption`, verified). It does not hold for the explicit-`position` branch, where the real anchor can be `current(count - 1)` — a tail, per that branch's own round-8 note. In that narrow case the cycle check is computed against a different anchor than the step's actual placement, so a cycle could be persisted. **Not a change request:** it fails loudly at run time with a named `LaneReferenceError`/422, which is precisely the backstop Engine contract item 7 designates for this class, and there is no security or silent-corruption consequence. Worth narrowing the comment so a future reader does not over-trust it.
3. **Do not cite the two committed delta checks as ongoing evidence.** Post-archive, `check-legacy-field-coverage.py`'s `LIVE` scan finds no requirement naming a legacy field (they are all rewritten), so it now reports 0 vacuously. They did their job at the design gate; they are not a standing gate.
4. **Consider one sentence in `pipeline-lane-rejoin-input`** noting that the single-call create path resolves lane references against earlier `clientId`s in the same request. The reconciliation is thorough in design.md, but a future reader of the live spec alone sees only "any node in the pipeline".
5. **Dev-DB disclosure:** my cycle-1 Phase-3 pass changed one `lookup` step's reference data source on `union-eval-pipeline` and left its `last_run_status` as `Failed` (an incomplete draft I ran deliberately). Test residue on the shared dev DB, not a product defect.
