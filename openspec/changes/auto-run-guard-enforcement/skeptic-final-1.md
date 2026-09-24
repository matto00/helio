## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Ticket: HEL-1097 "Expensive-op guard interaction with auto-run"
Commit reviewed: 1a500cb58e91ddda2abc27bc2f8a8a7bcd5a5395 (branch task/auto-run-guard-enforcement/HEL-1097)
Base resolved via `resolve-review-base.sh . main origin`: f272a6055a91b69e8df0bd78a49813bc5ec1250b

### What I verified (with evidence)

**Diff scope (independent, not trusted from files-modified.md):**
`git diff f272a605...1a500cb5 --stat` → 11 files, 955 insertions, 0 deletions, 0 files under
`backend/src/main/**` or `frontend/**`. Exactly 2 new test files
(`AutoRunGuardBurstProofSpec.scala`, `AutoRunGuardNoRetryStormSpec.scala`) plus 9 openspec
planning/spec-delta files. Confirms "proof-only, no production code changed" as a fact of the
diff, not merely as an executor/evaluator claim.

**AC trace — "a burst of writes cannot exceed the per-principal run budget":**
Read both spec files in full (not summaries). `AutoRunGuardBurstProofSpec` 3.1/3.2 assert
`pipeline_runs` row count AND `pipeline_run_rate_window.request_count` (never a log line) after a
6-write burst against a budget of 3, in both a single-instance and a two-concurrently-ticking-
scheduler-instance scenario; both assert `shouldBe 3`. `AutoRunGuardNoRetryStormSpec` drives 5
synthetic ticks after a deterministic denial and asserts the debounce claim releases cleanly with
no re-fire. This is a genuine, falsifiable proof of the AC, not a tautological one — see the
mutation reproduction below.

**Independent test execution (own run, not the evaluator's pasted output):**
```
sbt testOnly com.helio.services.pipelines.AutoRunGuardBurstProofSpec com.helio.services.pipelines.AutoRunGuardNoRetryStormSpec
→ Tests: succeeded 4, failed 0
sbt testOnly <the 5 named regression specs>
→ Tests: succeeded 36, failed 0
```
4 + 36 = 40, matching evaluation-1.md's claimed 40/40 exactly, on my own fresh run.

**Independent falsifiability reproduction (mutation, per systematic-debugging.md):**
Edited `AutoRunGuardBurstProofSpec.scala` line 267 `withGuard = false` → `withGuard = true`,
re-ran the suite myself: test 3.3 **FAILED** — `3 was not equal to 6
(AutoRunGuardBurstProofSpec.scala:272)` — exactly matching the transcript the executor pasted into
files-modified.md. Reverted the file (`diff` against the committed version now shows nothing —
byte-identical). This closes the "evidence-shaped non-evidence" risk from feedback memory: I did
not merely trust the pasted transcript, I reproduced the red case myself.

**Production code trace (own read, not the executor's narrative):**
- `AutoRunTriggerService.triggerAutoRun`/`evaluateAndSchedule` (lines 61-92): its only effect for
  an eligible pipeline is `debounceRepo.upsertDebounce(...)`. Never calls `PipelineRunService` at
  all. Confirmed the `user` parameter (the writer) is used ONLY for the denied-entry
  `visible`/`canRun` response gates (doc comment lines 26-31, 55-60, code at `handleDenied`) — it
  plays no role in which principal is later charged.
- `PipelineSchedulerService.fireAutoRun` (lines 121-147): the ONLY call site that fires an
  auto-run. Re-derives the acting principal as `AuthenticatedUser(pipeline.ownerId, ...)` —
  independent of whoever wrote the dataset — and calls
  `pipelineRunService.submit(pipelineId, isDry = false, owner, triggerSource = TriggerSource.AutoRun)`
  unconditionally. A `TooManyRequests` result is caught, logged, and the debounce claim released
  in `processAutoRunClaim` (line 118) regardless of outcome — no retry path.
- `PipelineRunService.submit`/`executeRun` (lines 963-994): `pipelineRunGuardRepo != null` gates
  the rate-limit and concurrency checks — the exact nullable-optional convention the new specs'
  `withGuard` fixture flag exploits for the 3.3 red case. Not gated on `triggerSource` at all.
- `Main.scala` (line 275-279): `PipelineSchedulerService` constructed with
  `apiRoutes.pipelineRunService` — confirmed the SAME instance (and therefore the same non-null
  guard repo) the manual-run HTTP route uses.
- `PipelineAutoRunDebounceRepository`: `claimDue`/`releaseClaim`/`upsertDebounce` are debounce-
  table bookkeeping only — none creates a `pipeline_runs` row.
No alternate path was found. The "proof-only" outcome is honest, not scope avoidance — I re-traced
this independently rather than accepting the executor's/evaluator's account of it.

**Cross-principal charging vs. the AC's literal "per-principal" text (item 3):**
Confirmed by the code trace above: the principal charged by the guard is always
`pipeline.ownerId`, computed fresh in `fireAutoRun`, regardless of which user's write triggered
the debounce. The tests use `AuthenticatedUser(owner)` as the writer, but this loses no proof
coverage — the writer identity passed to `triggerAutoRun` is provably inert to the charging
mechanism (only affects response visibility flags for denied entries, verified above). So "a burst
of writes cannot exceed the per-principal run budget" is proven for the one principal that is ever
actually charged (the owner), which is what the mechanism does today regardless of who writes.
The deferred question in HEL-1173 — whether a non-owner writer being able to spend the owner's
budget is *fair* — is a different question from whether the per-principal budget itself can be
exceeded (it cannot, per 3.1-3.2's proof). The PR framing in ticket.md/design.md states this
distinction explicitly and does not overstate what was resolved. Cross-checked HEL-1173 in Linear:
filed correctly (origin_kind/origin_ticket/Follow-up label/v0.8 project all present), and its
description independently corroborates the same owner ruling and arithmetic cited in ticket.md —
consistent, not a one-sided restatement.

**Decision 3 (guard-rejection stays log-only) visibility (item 4):**
`design.md` carries an explicit, named "Decision 3" section with rationale and an alternative
considered/rejected, plus a dedicated "Trade-off" bullet in the Risks/Trade-offs section, plus
`ticket.md` scope item 4 requiring this be stated rather than assumed. This is adequately visible
in the delivered artifacts that a PR description would be generated from (no PR exists yet at this
gate — `gh pr view` returns "no pull requests found for branch", confirmed). Recommend the
orchestrator/executor's PR-body step for this ticket explicitly carries Decision 3's log-only
framing forward verbatim rather than dropping it, but this is not a defect in the reviewed
artifacts themselves.

**UI/frontend surface (item 5):**
Confirmed via `git diff --stat`: zero `frontend/**` files, zero `schemas/**` files, zero
`backend/src/main/scala/routes/ApiRoutes.scala` changes. This is a backend-only, proof-only
delivery with no UI-affecting surface — confirmed independently, not assumed from the evaluator's
Phase 3 N/A.

**Spec deltas:** Read both `openspec/changes/.../specs/{pipeline-run-guard,dataset-write-auto-run}/spec.md`
deltas in full. Both map 1:1 onto the committed test assertions (the auto-run scenario in
`pipeline-run-guard` ↔ 3.1-3.3; the no-retry-storm scenario in `dataset-write-auto-run` ↔ 3.4).
`npx openspec validate auto-run-guard-enforcement --type change` → `Change 'auto-run-guard-
enforcement' is valid` (own run).

**Code quality gate:** `npm run check:scala-quality` → clean, 0 blocking findings (own run). The
276-line soft-budget warning on `AutoRunGuardBurstProofSpec.scala` is informational only per
CONTRIBUTING.md and consistent with dozens of pre-existing specs over the same budget in this same
package — not a defect.

**Gate-defect check (mtime/evidence-directory soundness, per this role's standing instructions):**
No screenshot or mtime-ordering evidence is load-bearing anywhere in this delivery (no UI surface
at all), so there is no mtime-unsound evidence dependency to flag as a gate defect here.

### Verdict: CONFIRM

This delivery ships. Both new spec files are genuine, falsifiable, DB-state-based proof (not
log-inspection, not tautological — I reproduced the red case myself rather than trusting the
pasted transcript). The "no production code change" outcome is independently confirmed honest by
my own trace of every auto-run-adjacent code path, not inferred from the executor's/evaluator's
narrative. The owner's charging-fairness ruling is consistent with the AC's literal text (the
principal that is ever charged is always bounded correctly; HEL-1173 covers a genuinely separate
fairness question, filed correctly). Decision 3's log-only trade-off is explicitly stated rather
than silently assumed. No UI surface exists for this change.

### Non-blocking notes

- Recommend the eventual PR body explicitly restates design.md's Decision 3 (log-only
  guard-rejection visibility) rather than only the AC-proof summary, so a human reviewer sees the
  trade-off without having to open design.md — this is about PR presentation, not a code or test
  defect, and does not block merge.
- The pre-existing file-size-soft-budget duplication the evaluator noted (shared
  seed/fixture-helper extraction opportunity between the two new specs) is a reasonable low-priority
  future cleanup, not a defect introduced by this change.
