## Evaluation Report — Cycle 1 (evaluation-1.md)

Scope constraint honored: `frontend/**` off-limits (HEL-912/HEL-968/HEL-969). No frontend
finding is raised below. `e2e/**` treated as in scope.

### Gates — all re-run fresh by the evaluator, not taken from the executor's report

| gate | result |
|---|---|
| `cd backend && sbt test` | **PASS** — 3725 tests, 0 failed, exit 0 |
| `npm run lint` | PASS (`--max-warnings=0`) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 252 suites / 2590 tests |
| `npm --prefix frontend run build` | PASS |
| `check:schemas` | PASS (73 schemas / 48 protocol files; AssistantProposalToolSchemas parity 14 surfaces) |
| `check:openspec` / `check:spec-structure` | PASS (339 canonical specs, 0 issues) |
| `check:e2e-types` / `check:helio-mcp-types` | PASS |
| `check:node-root-encoding` (+ selftest) | PASS, selftest proves it fires |
| `check:node-root-encoding:ts` (+ selftest) | PASS, selftest proves it fires |
| **Playwright** (servers 6345/9252, `start-servers.sh` READY) | **37 passed, 1 failed** — see Phase 3 |

---

### Phase 1: Spec Review — PASS (with one advisory)

**AC1 — migration test / one root per pipeline / row-for-row snapshot equality.** MET.
`V98PipelineRootsMigrationSpec` covers the backfill count, idempotency (re-running the DML is
`rowsAffected shouldBe 0`), and byte-identity of an untouched non-root step. `FlywayNonSuperuserMigrationSpec`
covers it against the real dump (73 pipelines) as the non-superuser role.

**AC2 — engine test: two roots joined by a lane-join; removing a root removes its lane's Outputs
and reports placements.** MET. `MultiRootIsolationSpec` + `PipelineRootRoutesSpec` ("remove a
non-last root, compact positions, and report counts", "delete node_snapshots explicitly...",
"refuse when a surviving lane references a step that would be deleted").
*Literal-wording note (looser-than-asked, judged acceptable):* the ticket says "reports placements"
and anchors it to "the same placement-count warning as step deletion".
`RemovePipelineRootResponse(removedStepCount, removedOutputCount)` reports removed **Outputs**, not
the **dashboard panels** placing them — but `DeletePipelineStepResponse(removedTailStepCount)`, the
comparator the ticket names, reports counts the same way (only `DeleteOutputResponse` returns
`removedPanelIds`). The shipped shape matches the comparator the ticket chose. Non-blocking
suggestion below.

**AC3 — ACL: unreadable root is a 404 at write time; run never reads a source the owner cannot
read.** MET. `PipelineRootRoutesSpec` "reject an unowned/nonexistent sourceId with 404 (R8)",
"reject a blank sourceId with 400 and perform no ownership lookup" (HEL-950's empty-seed guard
held), plus per-root resolution in `PipelineRepository.create`'s `resolveInOrder`.

**AC4 — route/MCP specs for `roots[]`/`add_root`/`remove_root`; `check:schemas` / `check:openspec`
green.** MET; both gates re-run green above.

**AC5 — `design.md` states the multi-root contract explicitly enough for HEL-914; HEL-911's item 11
superseded with a forward pointer.** MET. R1–R15 is genuinely plannable-from: R2/R3 settle root
identity vs. ordering and name the *three* permitted position-readers (an earlier draft's
unqualified ban was corrected rather than left aspirational — this is the difference between a
contract and a slogan). R5's two-address table pre-empts the exact HEL-914 collision it names.
Items 8 and 11 of the archived HEL-911 design carry inline forward pointers (verified in the diff).

**R4 representation table verified against the shipped code** (this was the specific ask):
- DB — TRUE: `pipeline_steps.root_id` + `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))` in V98 §3.
- Wire — TRUE: `rootId` on every `PipelineStepResponse` variant; the `rootId` default on the
  *response case classes* remains but every `fromDomain` call site threads a resolved value
  (`rootIdsOf` bulk / `rootIdOfStep` single). See non-blocking #3.
- Domain case classes — TRUE: no `rootId` field on the 24 op case classes.
- Threaded side-map — TRUE: `PipelineStepRepository.rootIdsOf` fetched at the service boundary and
  passed into `childrenOfRoot`/`trunkOfRoot`; `PipelineExecutionBackend` takes
  `roots: Vector[(String, DataSource)]`.

**Scope creep:** none found. No `frontend/**` file is touched (verified against the diff).

**Advisory — the 9.7 cluster (independent read, as requested).**
Leaving proposals single-source **is a coherent shipped state at runtime.** I verified the actual
path rather than reasoning from the artifacts: `PipelineProposalService.createPipeline`
(`:365-377`) resolves its one source and calls `pipelineService.create` with
`roots = Vector(CreatePipelineRootRequest(sourceId = Some(resolved.id.value)))`. A proposal
therefore produces a well-formed one-root pipeline that `add_root` extends. Nothing is broken,
nothing is half-migrated, and no user-visible surface is left in an inconsistent shape.

The one thing it *does* break is not runtime, it is archival: at Delivery these two deltas
(`pipeline-proposal-contract`, `pipeline-proposal-apply`) are archived into `openspec/specs/`,
at which point the canonical spec would assert `roots[]` on `PipelineProposal` while the code
ships `source`. `openspec validate` and `check:openspec` are both green and neither catches this,
so nothing mechanical would ever flag it again — it would become a silently-false canonical spec,
which is the same failure mode task 11.2 spent effort *correcting* elsewhere in this very change.

**Recommendation: move both deltas to HEL-914** (the orchestrator's option A), which already owns
that surface verbatim. The 9 correlated untouched sites should move with them. Implementing all 11
here would be scope HEL-914 then has to re-plan around, for no intermediate-state benefit.
This is a product/scope call, correctly escalated rather than self-authorized; it is recorded here
as advice, not as a change request, and it does **not** contribute to the FAIL below.

---

### Phase 2: Code Review — FAIL

#### Priority 1 — V98 (the highest-risk artifact): verified clean, on every point asked

- **`NO FORCE` bracket covers all five tables** including `pipelines` — verified at the top of V98
  (`pipelines`, `pipeline_steps`, `outputs`, `node_snapshots`, `binary_refs`). The header correctly
  identifies `pipelines` as bracketed **because it is READ**, and correctly separates the
  fail-SILENT policy set (`pipelines`/`outputs`/`node_snapshots`/`binary_refs`,
  `missing_ok = true` → closed-to-false) from the fail-LOUD one (`pipeline_steps`, V35's bare
  `current_setting` → 42704).
- **FORCE restored on all five** — V98 §10 enumerates all five explicitly, and
  `FlywayNonSuperuserMigrationSpec`'s `forceRlsTables` list independently asserts
  `relforcerowsecurity` for all five plus the new `pipeline_roots`.
- **Orphan deletion runs BEFORE the CHECK** — §5 (measure → log to `hel913_migration_counts` →
  DELETE) precedes §6's three CHECK constraints. Counts are measured, not assumed zero, and
  `V98PipelineRootsMigrationSpec` asserts both logged counts are `Some(1)`, so the logging path is
  itself exercised rather than being write-only.
- **`FlywayNonSuperuserMigrationSpec` genuinely exercises V98 as the non-superuser role** — yes.
- **The external superuser count comparison is intact and NOT weakened.** This is the point the
  brief flagged, and it holds: `pipelineCountBeforeV98` is captured over `superDbPreV94`
  (a plain superuser `JdbcBackend.Database`, immune to whatever RLS state the migration leaves
  behind), and compared post-migration against `SELECT count(*) FROM pipeline_roots` with both
  `shouldBe pipelineCountBeforeV98` **and** `should be > 0`. The `> 0` clause is what stops the
  comparison degenerating to `0 == 0`. A 20-line comment above the spec states it is load-bearing
  and must not be "simplified away as redundant with V98's own guard".
- **The vacuous-guard claim is empirically proven, not asserted.** `V98PipelineRootsMigrationSpec`
  reads the **shipped** `V98__*.sql`, deletes the `pipelines` bracket line from it, runs the
  mutated script as a genuine non-superuser role, and asserts `realPipelineCount shouldBe 1` /
  `realRootCount shouldBe 0` — i.e. it demonstrates the silent corruption and the guard's blindness
  to it, rather than describing them. This is the strongest single piece of evidence in the change.
- Additional correctness checked and found sound: the `pipeline_roots` RLS split (per-command
  policies, owner-only writes joined through `pipelines.owner_id`) correctly avoids the
  permissive-USING-reused-as-WITH-CHECK privilege escalation, and is covered by
  "let a grantee of a shared pipeline SELECT its roots but never INSERT/UPDATE/DELETE one";
  §7's unique-index recreate correctly re-keys only the `node_step_id IS NULL` index and
  documents why its complement is deliberately untouched; §4's `node_snapshots`-has-no-FK
  asymmetry is deliberate and justified by the `TRUNCATE ... RESTART IDENTITY CASCADE`
  ownership landmine V94 already recorded.

No V98 finding. This artifact meets the bar the ticket's migration constraints set.

#### Priority 2 — the thirteenth instance: **FOUND** (two sites, one root cause)

The class is "code that resolves THE root without saying WHICH root". The twelve fixed instances
are real and the audits behind them hold — I independently re-verified the hardest of the five
`firstRootIdAction` classifications rather than accepting the write-up: `spliceInsertAtInternal`'s
two remaining `(None, None)` production call sites (`PipelineService.scala:1603` and `:1631`) are
both lexically inside `persistNewStep`'s `if (roots.size > 1) → 400` guard at `:1576-1579`, so the
fallback is genuinely unreachable for a multi-root pipeline. That claim is sound.

But **the Output surface did not get the guard its sibling step surface got**, on both the write
and the read side. The encoding is one of the named hiding places: *an absent optional field used
as the whole node key*.

**Site A (write) — `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:133-139`
and `:186` (`resolveExplicitRootId`'s `case None => Right(None)`).**
`POST /api/pipelines/:id/outputs` with **neither** `nodeStepId` **nor** `rootId` falls through to
`OutputRepository.insertInternal`'s `case (None, None) => firstRootIdAction(...)`
(`OutputRepository.scala:209-211`), which binds the Output to the **lowest-positioned root**,
silently, with no 400. The in-code justification at `OutputService.scala:135-137` states the
precondition explicitly:

> "`nodeStepId` absent AND `rootId` absent still means 'the pipeline's (only) root' ... that is
> unambiguous only because **a pipeline with no way to create a second root yet always has exactly
> one**."

That precondition is **falsified by this very change**. `POST /api/pipelines/:id/roots`
(`PipelineRoutes.scala:83`) and the `add_root` MCP tool both ship here, and `roots[]` at create
ships here. So the comment documents a safety argument that this change itself removed.

The correct behavior already exists one file over: `PipelineService.persistNewStep`'s `(None, None)`
arm returns
`"This pipeline has N roots -- name one via rootId, or anchor via parentStepId"` when
`roots.size > 1`, and `resolveStepRootIndex`'s "neither" case does the same on the transactional
create path. The Output-create path is the one sibling that was not given that guard.

Worse, the behavior is **certified as correct by a test**:
`MultiRootIsolationSpec.scala:131` — *"both land on the pipeline's FIRST root today"*,
asserting `actualRootIds shouldBe Set(root0Id.value)` on a genuine two-root pipeline. That locks in
the silent default rather than flagging it, and it is why the existing sweep did not surface this.

This also violates R3 directly: auto-resolving to the lowest-positioned root *is* semantic
behaviour branching on position, and it is not one of R3's three enumerated permitted tiebreaks.

**Site B (read) — `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:325`,
`:336-341`, and `:357`/`:372`.**
The same defect on the read side, and this one returns **wrong rows to the user**:

```scala
val distinctNodeKeys = outputs.map(_.node.stepId.map(_.value)).distinct
...
val entries = outputs.map(o => OutputPreviewEntry(o.id.value, byNodeKey(o.node.stepId.map(_.value))))
```

`output.node.rootId` is dropped entirely from the key. Every root-bound Output — on **any** root —
collapses to the single key `None`, and `previewAtNode(pipelineId, None, user)` takes the
source-level arm at `:369-372`, which uses `roots.head._2`. On a two-root pipeline,
`GET` preview for an Output bound to root 1 returns **root 0's rows**, with no error and no notice.
The single-Output arm at `:325` has the identical defect.

`PipelineRunService.previewAtNode`/`previewOutputs` is **absent from task 5.8a's enumerated R12
sweep surface** (which lists `NodeSnapshotRepository`, `BinaryRefRepository`, `OutputRepository`,
`OutputService`, `OutputRoutes`, `OutputProtocol`, `model.scala`, `PipelineProposalProtocol`,
`DemoData`, Output schemas) — so this is a genuinely missed site, not a knowingly-deferred one.
Note the persisted-rows path *was* fixed (`OutputService.scala:339` threads
`explicitRootId = output.node.rootId`), which makes the preview path's omission an internal
inconsistency: the same Output reads correctly from snapshots and incorrectly from preview.

Neither site is caught by `check:node-root-encoding` — correctly so, and the guard's header is
honest about it, but it does mean nothing mechanical will catch a recurrence.

#### Priority 3 — evidence quality: spot-checked, holds on all three

Checked the three named load-bearing claims by reading the assertions, specifically looking for
"asserts the call succeeded" rather than "asserts what it produced":

1. **`rows`/`trunkOf`/binary-ref same-node agreement.** `trunkOf`'s doc
   (`PipelineStepRepository.scala:795-808`) names all five scalar-anchor consumers and states they
   read the *identical function* so they cannot disagree, and explicitly frames the
   "first `position == 0` child" rule as a documented legacy-compatibility convention rather than a
   claim of primacy — with the escape hatch named (`childrenOf`/`executionOrder`). This is the
   right shape: the coupling is asserted structurally, not by three tests that happen to agree.
2. **Two-root snapshot isolation.** `MultiRootIsolationSpec:85-118` asserts produced content —
   `root0Rows shouldBe Vector("root0-b")`, `root1Rows shouldBe Vector("root1-a") // NOT wiped` —
   plus a separate `count shouldBe 2` proving two roots can each hold `row_index 0` without a
   unique-index collision. Real coverage, not a success assertion.
3. **`node_snapshots` explicit-delete on root removal.** `PipelineRootRoutesSpec:273-301` counts the
   row `shouldEqual 1` *before* the DELETE and `shouldEqual 0` after, and separately asserts the
   step subtree is gone — so it distinguishes "explicitly deleted" from "never existed". The
   adjacent rollback test (`:305-331`) asserts *nothing* was deleted on the 400 path
   (`doomedStepId` count `shouldEqual 1`, roots `size shouldEqual 2`), which is the mutation-shaped
   complement. Both are genuine.

The V98 bracket mutation test (above) is the strongest instance of this discipline in the change.

#### Other code-review checks

- **CONTRIBUTING.md compliance:** no inline fully-qualified names introduced; imports/qualifiers
  clean. `check:scala-quality` reports only the 149 pre-existing soft warnings.
- **DRY / modularity:** `childrenOfRoot`/`trunkOfRoot` are added as root-scoped siblings of the
  existing functions rather than forking them; `removeRootCascadeAction` stays table-scoped and is
  composed into the caller's single transaction.
- **Type safety:** the `NodeKey`/`RootKey`/`StepKey` sealed trait replaces `Option[String]` keying —
  a real strengthening. No new untyped escape hatches.
- **Security:** per-root ACL at write time; the `pipeline_roots` RLS policy split correctly avoids
  privilege escalation; cross-pipeline `rootId` is a named 400, not a silent accept.
- **Error handling:** the multi-root reorder fail-closed fence (task 7.3d-i) and the
  surviving-lane-reference 400 both fail loudly rather than corrupting silently.
- **No dead code / no over-engineering:** the retired scalar was removed outright with no alias or
  fallback, per the standing no-deprecation rule; `firstRootIdAction`'s remaining reachable arms are
  each classified with a stated proof.

---

### Phase 3: UI Review — PASS

Servers started via `scripts/concertino/start-servers.sh` (READY backend `:9252`, frontend `:6345`;
both health-checked 200). Full Playwright suite run: **38 tests, 37 passed, 1 failed (49.9s).**

Applying the distinction the brief asked for:

- **`hel910-pipeline-to-dashboard-flow.spec.ts:90` — FAILED. Expected red, confirmed by mechanism,
  not merely by name.** The failure is
  `page.waitForURL: waiting for navigation to "/pipelines/undefined"` at `:144` — i.e. the create
  POST returned a body without an `id` because the Create Pipeline UI still posts the removed
  scalar and the backend 400s it. That is exactly HEL-969's frontend repair, reproduced precisely
  as predicted. Not this change's defect (and `frontend/**` is off-limits here).
  The *other* test in the same file (`:208`, existing-Output placement) **passed**, which is a
  useful discriminator — the file is not broadly broken, only the create-UI path is.
- **`hel813-mobile-touch-target-floor.spec.ts` — all 14 tests PASSED** at both 430px and 768px.
  Predicted expected-red; it is not red. The prediction was over-cautious, no action needed.
- **`hel908-full-flow.spec.ts` (HEL-964 flake)** — not run; already in `playwright.config.ts`'s
  `testIgnore` quarantine register. Correctly excluded without any evaluator intervention.
- **`hel912-lanes-rejoin.spec.ts` (HEL-972 quarantine)** — **does not exist on this branch.** It
  arrived on `main` with HEL-912's merge (`489c4c93`), which is after this branch's base
  `a45e9881`. Nothing to run and nothing to quarantine; no action needed, recorded so a later
  reader does not treat its absence from `testIgnore` as a missing quarantine entry.
- **Any OTHER spec red:** none. `auth-cookie-migration` (7), `hel773` (9), `hel908-step-card-split`,
  `hel908-trunk-reorder-drag`, `hel908-trunk-reorder-order` all green.

So the Playwright gap the executor honestly recorded as unverified is now closed, and it closed
clean: **zero reds attributable to this change.** Note this is a stronger result than the executor
could claim — `check:e2e-types` proved only compilation.

---

### Overall: FAIL

One defect class, two sites, both concrete and reachable in shipped code. Everything else in this
change is of unusually high quality — V98 in particular meets the bar its own header sets, and the
mutation-proof discipline is real rather than claimed.

### Change Requests

1. **`backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:130-139` — reject an
   ambiguous root-bound Output create on a multi-root pipeline instead of silently binding to
   `roots[0]`.** In `create`, when `req.nodeStepId.isEmpty && req.rootId.isEmpty`, load the
   pipeline's roots and, if `roots.size > 1`, return
   `ServiceError.BadRequest` naming the ambiguity — mirroring `PipelineService.persistNewStep`'s
   existing arm at `PipelineService.scala:1576-1579`
   (`s"This pipeline has ${roots.size} roots -- name one via rootId, or anchor via nodeStepId"`).
   Keep the single-root case exactly as today (no behavior change for the common path).
   Then **correct the stale safety argument** in the comment at `:133-137`, which currently asserts
   "a pipeline with no way to create a second root yet always has exactly one" — this change ships
   `add_root`, so that sentence is false as written and must not survive.

2. **`backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/MultiRootIsolationSpec.scala:131`
   — replace the test that certifies the defect.** The case *"both land on the pipeline's FIRST root
   today (5.8a's OutputService/CreateOutputRequest root-binding is deferred)"*, asserting
   `actualRootIds shouldBe Set(root0Id.value)`, locks in the silent default. Replace it with:
   (a) a two-root pipeline where a root-bound create naming **neither** field is a 400, and
   (b) two root-bound Outputs each naming their **own** `rootId`, each asserted to persist
   `node.rootId` matching its own root and not the other's.

3. **`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:325`, `:336-341`,
   `:357-372` — key Output preview by root, not by `stepId` alone.** `distinctNodeKeys` and the
   `byNodeKey` lookup must key on the full node identity `(stepId, rootId)` — the `NodeKey` /
   `RootKey` scheme R4 already introduces is the right type — so two root-bound Outputs on
   *different* roots no longer collapse to the single `None` key. `previewAtNode` needs a `rootId`
   parameter threaded through to the source-level arm, replacing the unqualified `roots.head._2`
   at `:372` with the named root's `DataSource` (and correspondingly for the truncation-notice
   source name). Both call sites at `:325` and `:336` must pass `output.node.rootId`.
   The persisted-rows path already does exactly this at `OutputService.scala:339`
   (`explicitRootId = output.node.rootId.map(_.value)`) — make preview agree with it.

4. **Add a regression test for CR3 that would be red today**: a two-root pipeline with a root-bound
   Output on each root, previewed via `previewOutputs` (both the all-Outputs arm and the
   single-`outputId` arm), asserting each Output's preview returns **its own root's** rows. Assert
   the rows produced, not that the call succeeded — under the current code both entries return
   root 0's rows and the call succeeds, which is precisely why this was missed.

5. **Record the two new sites in the R12 sweep surface** (`tasks.md` 5.8a / `design.md` R12).
   `PipelineRunService.previewAtNode`/`previewOutputs` is not in the enumerated list, and the
   enumeration is the artifact a future reader will trust as complete. Per design.md Rule B, a
   sweep that reads as complete while missing a site is the defect.

### Non-blocking Suggestions

- `PipelineStepRepository.spliceInsertAtInternal`'s parameter comment (`:426-432`) still reads
  "Defaulted to `None` ... this default is scheduled for removal" — task 7.3e already removed the
  default (`explicitRootId: Option[PipelineRootId]`, no `= None`). The comment now describes a
  default that does not exist. Same stale phrasing at `insertInternalAction` (`:227-233`) and
  `OutputRepository.insertInternal` (`:176-179`).
- `RemovePipelineRootResponse` reports `removedOutputCount` but not the dashboard panels those
  Outputs were placed on. `DeleteOutputResponse` returns `removedPanelIds` for the single-Output
  case; root removal silently orphans/removes the same panels with no equivalent report. Consider
  adding `removedPanelIds` for parity. Not an AC failure — the ticket anchors "placement count" to
  *step* deletion, which reports counts, not panel ids.
- `check:node-root-encoding` scans 3 files and `check:node-root-encoding:ts` 32; both headers are
  honest about coverage (good), but neither would have caught either site in CR1/CR3, since both
  are `Option`-shaped keying in service code rather than the SQL/Slick spellings the guards match.
  Worth noting in the guard headers so the next reader does not over-trust a green run.
- Wiring the four guards into `.github/workflows/ci.yml` rather than `.husky/` (task 11b) is the
  right call and the recorded reasoning is sound — CI is merge-blocking and unbypassable.
