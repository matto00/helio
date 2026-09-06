## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `f1554b99` "HEL-994 Guard previewOutputs' own dependency-closure path in both arms"

### Phase 1: Spec Review — PASS

Issues: none.

- **AC1 (observe executed node SET on the previewOutputs path)** — met. Both guards assert
  `preview.stepRowCounts.keySet` and nothing else; no assertion on the target's own rows
  (`PipelineRunServiceSpec.scala:1361, 1381, 1385`).
- **AC2 (RED under a mutation on the previewOutputs path specifically; NOT at :507)** — met and
  independently corroborated. All three mutations land inside `previewOutputs`' body:
  M1 at the `case Some(id)` `previewAtNode(...)` call (:345), M2 at the `Future.traverse`
  `previewAtNode(pipelineId, stepKey, rootKey, user)` (:362), M3 at the `byNodeKey(...)` re-pair
  (:369). I verified each mutated line's text matches real source in the current file at those
  lines. Corroborating: the discarded wrong-reason transcript carries a real stack frame
  `PipelineRunService.$anonfun$previewOutputs$14(PipelineRunService.scala:369)` — that is
  `previewOutputs`, not `:507`. No mutation touches `:507`.
- **AC3 (enabled off-closure node, non-degeneracy demonstrated)** — met, see Phase 2 below.
- **AC4 (wrong-reason red recorded and discarded)** — met. The `.take(1)` variant reds with
  `java.util.NoSuchElementException`, is captured verbatim in `evidence/wrongreason_evidence.txt`,
  and is explicitly excluded from the distinctness table.
- **AC5 (axes observationally distinct)** — met via the corrected pair criterion, and the
  cross-arm greens are really there (see Phase 2).
- **AC6 (`mutation-evidence.md` to HEL-957's standard)** — met: per-axis diff, command, verbatim
  output, observed-vs-expected sets, distinctness table, discarded section, final state.
- Tasks: all 6 sections checked and each maps to something actually in the diff or the evidence
  dir. No scope creep — the diff is 76 added test lines plus change-dir artifacts, nothing else.
- Planning artifacts reflect the implemented behavior; design.md's D2a distinctness correction is
  the criterion actually applied in the evidence.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gate re-run (my own, fresh, not the executor's report):**
`cd backend && sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec"` →
`Tests: succeeded 72, failed 0 ... All tests passed. [success] Total time: 9 s, completed Sep 5, 2026, 5:55:20 PM`.
Matches the executor's claimed 72/72. Frontend gates N/A (no `frontend/**` files changed).
Per instruction, no Playwright and no e2e specs were run (HEL-972 holds those).

**1. Mutations inside `previewOutputs`' body — VERIFIED.** See AC2 above. No `:507` mutation
anywhere in the evidence.

**2. RED output real, verbatim, and for a key-set mismatch — VERIFIED.** Each of
`evidence/m{1,2,3}_evidence.txt` is a complete sbt transcript (sbt banner, project load, logback
init, full describe-block listing, failure, `[error] Total time`), not an excerpt pasted into
prose. Strong corroboration that these were real separate runs:
- Distinct wall-clock completion times: 17:49:15, 17:49:44, 17:50:12, 17:50:40 — sequential and
  ~28s apart, consistent with edit → run → revert cycles.
- Each transcript contains `compiling 1 Scala source to .../scala-2.13/classes` — i.e. a **main**
  source was recompiled on every mutation run. If only the spec had been touched this line would
  name the test classes dir. This is direct evidence production source was genuinely mutated.
- Distinct fixture UUIDs per run (fresh EmbeddedPostgres seeds), so no transcript is a copy.
- The failure line numbers (1361, 1381, 1385) correspond **exactly** to the three assertion lines
  in the committed spec file, which I checked by line number.

Failure reasons are all key-set mismatches (`Set(...) was not equal to Set(...)`), not engine
exceptions: M1 `Set()` vs a 3-member set at :1361; M2 `Set()` vs a 3-member set at :1381; M3 a
**non-empty wrong** 3-member set vs the expected 2-member set at :1385. The one exception-shaped
red (`NoSuchElementException`) is the one that was correctly discarded.

**3. Cross-arm GREEN controls — PRESENT, REAL, AND SAYING WHAT IS CLAIMED.** This was the highest-
risk item and it holds. Each transcript lists both guard tests, so the green is observed in the
same run as the red, not asserted:
- `m1_evidence.txt`: single-Output guard `*** FAILED ***`; all-Outputs guard listed with **no**
  FAILED marker; footer `succeeded 1, failed 1`.
- `m2_evidence.txt`: single-Output guard listed clean; all-Outputs guard `*** FAILED ***`; footer
  `succeeded 1, failed 1`.
- `m3_evidence.txt`: same shape as M2 (all-Outputs reds, single-Output green).

So M1 and M2 red on **opposite** guards while both observe `{}`. Neither mutation reds both
guards — no axis collapse, and the `(which guard reds, observed key set)` pair genuinely
discriminates them. M3 is separated from both on the key set itself (non-empty wrong value).
The distinctness table matches the transcripts row for row.

**4. Fixture non-degeneracy DEMONSTRATED by a working positive control — VERIFIED.**
`branchNode` is inserted with `enabled = true` and `parentStepId = Some(stepA.id)`, i.e. a real
second child of `stepA`, outside `target`'s closure. The positive control is not an assertion
about the flag: guard 2 asserts
`keySetByOutputId(branchOutputId.value) shouldBe Set(stepA.id.value, branchNode.id.value)` and
that assertion **passes on unmutated source** (my own 72/72 run, and green in the M1 transcript).
That means `branchNode.id` genuinely appears as a `stepRowCounts` key when it is inside the
previewed closure — so it IS count-recorded on this fixture, ruling out the
`InProcessPipelineEngine.scala:449` `if (next.enabled)` vacuity trap. Its **absence** from
guard 1's exact-equality `Set(stepA, stepB, target)` is therefore load-bearing. The design's
choice to make the off-closure node also the second branch's Output-bound node is what gives the
positive control a vehicle; that is a genuine resolution of the skeptic's round-2 note, not a
restatement.

**5. All mutations reverted — VERIFIED independently.** `git diff --name-only main...HEAD` returns
exactly one source path, `backend/src/test/scala/.../PipelineRunServiceSpec.scala`, plus change-dir
artifacts. `git diff main...HEAD -- backend/` shows **no** change under `backend/src/main` at all.
`git status --porcelain` is empty (clean worktree, nothing uncommitted). No production source
change, no migration.

**Code quality:** the added block reuses the file's existing `insertStep`/`stepRepo.insertInternal`/
`outputRepo.insertInternal`/`await` harness rather than introducing a parallel one; the fixture is
factored into a single `seedClosureGuardFixture()` used by both guards (DRY); no fully-qualified
names inlined; no `any`-equivalent escape hatches; no dead code or TODO/FIXME; comments explain
*why* (which mutation each assertion is the guard against) rather than restating the code. Test
names are long but carry the AC/design references, matching HEL-957's established convention in
this file. No production behavior touched, so behavior preservation is trivially satisfied.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` files changed — the only
`openspec/` paths are this change's own artifact directory. Per the orchestrator's instruction and
the trigger list, no dev servers were started and Playwright was not used.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `mutation-evidence.md` states `git diff --stat -- backend/src/main` was empty "after each
  individual revert" but only the final state is captured as output. The final state is what
  matters and I verified it independently, so this is presentational only — a per-revert one-line
  capture would make that claim self-evidencing rather than narrated.
- Task 5.3 (state design.md's assumptions in the PR description) is checked but cannot be verified
  from the worktree since no PR exists yet. Worth confirming at PR time that D4's rejected-rootId
  axis and the three "Assumptions" are carried into the PR body **framed as assumptions**, not as
  rulings.
