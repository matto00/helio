## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` (the change dir is untracked; there are no code changes yet). `assert-cwd.sh` printed READY.

### What I verified (with evidence)

**design.md Context claims, checked against the tree**

- **C-1. TRUE.** `RaceSaveHooks.at` completes `parked` as a side effect of the call itself, at `DraftRaceFixture.scala:108-113` (`parked.trySuccess(()); DBIO.from(release.future)`). The call returns before the returned DBIO runs.
- **C-2. TRUE.** `PipelineDraftWrites.scala:88` defines `taken(...) = locks.choose(...).andThen(afterLock(site))`, and `:89-92` bind `panels`/`advisory`/`rules`/`outs` as strict `val`s. So `afterLock(SaveRules|SaveOutputs|SavePanels|SaveAdvisory)` is called when `lockDefinition` is invoked. Only `afterLock(SavePipeline)` (`:101`, `:110`) sits inside the `for`.
  - In `DraftSaveTransaction.scala:77-78`, `lockDefinition` is invoked inside the `flatMap` that follows `hooks.at(Begin)`. Concretely: Begin runs, then `parked` completes, and only then does the first lock statement run.
  - `AfterCompare` is lazy (`:92`).
  - My conclusion: for every `parkAfter = Some(<non-pipeline site>)`, the harness declares the save parked before the save holds any lock.
- **C-3. The CI signature is consistent.** Both failing cases use `parkAfter = Some(LockSite.SaveRules)` (`DraftSaveDeadlockSpec.scala:59,62,106`). `check()` (`:30-35`) asserts `deadlock` and, for protected cases, `blockedObserved`. That explains both red attempts.
- **C-4. TRUE.** The SaveFirst writer wait is `waitFor(5000)` (`DraftRaceFixture.scala:240`). `activeBackend` (`:146-147`) returns only the single most recent non-idle `race-writer` backend, but the writer runs on two pools (`:187`). D4's "cover every backend" point is therefore a real, separate weakness.
- **Release exposure is true.** `git rev-parse v0.9.8^{commit}` printed `29cb0a60f…`. `git merge-base --is-ancestor 544bd79ea v0.9.8` printed NOT_CONTAINS. v0.9.8's tree has 0 `V137` migrations.
- **The mutations the plan names exist.**
  - M1–M4 are in `archive/2026-10-17-atomic-draft-save-endpoint/evidence/mutations/`.
  - M5–M7 are in `.../evidence/cycle3/`.
  - SK1 and SK3 are in `.concertino/runs/HEL-1629/evidence/.concertino/scratch/HEL-1629/skeptic-final/`.
  - SK5 is in `.../skeptic-final-2/SK5-rules-key-share.diff`.
- **§8.3.1 exists** at `docs/live-draft-preview.md:477`.

**Does D6 show that the fix addresses the confirmed cause?**

Yes, with one gap in the reasoning (note 1).

- D6(i) pairs the OLD and NEW fixture under one deterministic forcing probe: an external session delays the save's first protocol lock.
- With the old fixture, `parked` fires at construction, the writer starts, and (for the alert-evaluator or Output-delete writer, neither of which touches panels) it commits with no wait. That is the exact CI signature.
- With the new fixture (D2), `parked` cannot fire until the hook DBIO executes. Slick runs a transaction's actions in sequence, so every earlier lock statement has already returned by then. That removes the cause.
- Task 1.3 also snapshots `pg_locks`/`pg_stat_activity` at the parked instant without the perturbation. That is what separates (a) from (b): under (b) no granted row locks on `alert_rules` appear at "PARKED", and under (a) they do. D8 sends (a) to ESCALATION before any production edit. The decision procedure is sound.

**Do the mutation controls stay meaningful under the changed oracle?**

Yes.

- D2 does not move the physical park point. The save already blocked at `DBIO.from(release.future)` after the site's lock; only the harness's knowledge of when that happened changes. So the LockSite-removal deadlock controls (`DraftSaveDeadlockSpec:49,62,77,95,109,153`) keep the same interleaving.
- D4 changes only how long the harness waits for a decisive state. It does not change what counts as a verdict:
  - Protected cases still need a `pg_blocking_pids` wait, so a hang-guard expiry still fails them through `blockedObserved=false`.
  - The violation controls (`DraftSaveRaceSpec:216-219`, `DraftSaveSetRaceSpec:41-71`) still need `violation=true`.
  - Neither half can turn vacuously green.
- Lock-strength mutations (SK1 and SK5, which are SQL changes rather than LockSite switches) become more meaningful. With a true park, a weakened lock now shows as a real commit-while-parked instead of depending on timing.
- D6(iii) and task 3.2 re-run all of these.

**Other checks**

- **Scope.** No production change under (b). D8 and C1 gate (a) correctly.
- **ACs.**
  - Root cause with traces: tasks 1.3–1.4.
  - 50/50 under load plus mutations red: tasks 3.1–3.2.
  - Siblings: D5 / task 2.4.
  - Protocol-change re-run: conditional on (a), deferred to the revised plan.
- **Placeholders.** None blocking. "Exact bounds are the executor's call, recorded with rationale" is acceptable at this level.

### Verdict: CONFIRM

### Non-blocking notes (the evaluator should check these at the final gate)

1. **The Context bullet 3 inference does not discriminate between causes.** `PatchSetStale` in the attempt-2 control does not show that the harness parked early. `parkAfter = Some(SaveRules)` parks before the fingerprint compare by construction (rules → outputs → compare). So under (a) as well, a writer that committed past a held rules lock would leave the save stale. `root-cause.md` must not cite `PatchSetStale` as evidence for (b). Only the 1.3 lock snapshots decide.
2. **The trace text is wrong for `parkAfter` sites.** `DraftRaceFixture.scala:238` and `:222` print "PARKED past its compare" even when the park is mid-protocol. Correct the note, for example to name the site, so future CI traces are not misread.
3. **An expired parked wait must not start the writer.** At `:237-239` (and `race3 :301`), when the parked wait expires, the harness still starts the writer and produces a verdict. D4 says "analogous windows" but never names this wait. It should become a hard harness failure ("save never parked"), never a race run.
4. **Write down what happens on a "neither" outcome.** D4's "reported as 'neither', not interpreted as a verdict" should state explicitly that the test fails. The current assertions make it fail, but the final diff must not add a path that skips or passes on "neither".
5. **No task records the release-exposure AC.** Add evidence to `root-cause.md` or the PR, for example the `merge-base --is-ancestor 544bd79ea v0.9.8` and `ls-tree v0.9.8 | grep V137` output. The proposal asserts it without a probe.
6. **Task 3.2 should list its mutations and their paths:** M1–M7, SK1, SK3 and SK5 (the locations above). It should also state which suite and case each one is expected to turn red, so "the rest" cannot shrink silently.
7. **D3 is redundant with D2.** Once D2 lands, `idle in transaction` at the parked point is guaranteed by Slick running statements in order, so D3 is a cross-check. That is fine, but it should not be presented as the fix.
