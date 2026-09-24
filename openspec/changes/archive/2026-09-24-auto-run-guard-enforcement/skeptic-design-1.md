## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
   `specs/pipeline-run-guard/spec.md`, `specs/dataset-write-auto-run/spec.md`,
   `workflow-state.md`.

2. **Independently re-traced the auto-run fire path in the actual code** (not the
   premise-validation narrative — read the files myself):
   - `AutoRunTriggerService.evaluateAndSchedule` (`backend/src/main/scala/com/helio/services/pipelines/AutoRunTriggerService.scala:73-92`)
     never calls `submit`/`executeRun` directly — its only DB effect on the allowed branch is
     `debounceRepo.upsertDebounce(...)`. Confirmed no synchronous run-submission path exists here.
   - `PipelineSchedulerService.processAutoRunDebounce → processAutoRunClaim → fireAutoRun`
     (`PipelineSchedulerService.scala:91-147`) is the only fire path, and `fireAutoRun` calls
     `pipelineRunService.submit(pipelineId, isDry = false, owner, triggerSource = TriggerSource.AutoRun)`
     unconditionally (line 133-134) — the same `submit` every other trigger source uses.
   - `PipelineRunService.executeRun` (`PipelineRunService.scala:957-996`) checks the rate limit via
     `pipelineRunGuardRepo.incrementRateIfUnderLimit(user.id, ...)` and the concurrency cap via
     `insertRunIfUnderConcurrencyCap(...)` **unconditionally, gated only on whether the collaborator
     is non-null** — there is no `triggerSource`-based branch anywhere in this method that could
     skip either check for `TriggerSource.AutoRun`. This directly confirms the ticket's
     premise-validation claim and the proposal's central assumption.
   - `PipelineAutoRunDebounceRepository.claimDue`/`releaseClaim` (lines 50-76) are genuinely
     DB-atomic (`UPDATE ... RETURNING`, compare-and-delete on the exact `claimed_at` token) — this
     independently confirms Decision 1's premise that the guard's correctness under a
     multi-instance/spread-out burst does not depend on debounce collapsing, since the rate-limit
     check itself (`incrementRateIfUnderLimit`) is keyed only on `user.id` and is a separate
     DB-atomic operation from the debounce claim.
   - Searched for any other writer of `pipeline_runs` rows reachable from a dataset write: found
     `insertRunInternal` has exactly one other caller, `SparkJobSubmitter.scala:69`, which is an
     unrelated legacy Spark-driver path with no connection to `AutoRunTriggerService`/
     `PipelineSchedulerService`. `recordUnrunnable`'s `insertRun` call is reachable only from
     `PipelineProposalService.createPipeline`, also unrelated. `grep -i "retry\|backfill"` across
     `PipelineSchedulerService.scala`, `AutoRunTriggerService.scala`,
     `PipelineAutoRunDebounceRepository.scala` returned zero hits — there is no separate
     retry/backfill mechanism outside the stale-claim self-healing path, which itself re-enters
     `claimDue → processAutoRunClaim → fireAutoRun → submit` and is therefore already guard-covered.
   - Net: I could not find a bypass. This corroborates the ticket's premise validation rather than
     just trusting it.

3. **Verified the two `MODIFIED Requirements` spec deltas are correctly scoped** against the current
   `openspec/specs/` baselines (not the change dir's own copies):
   - `pipeline-run-guard`: baseline requirement text (`openspec/specs/pipeline-run-guard/spec.md`)
     is reproduced in full in the delta, with only "a dataset-write auto-run trigger," inserted into
     the trigger-source list, and the two existing scenarios (hook, scheduled) preserved verbatim.
     One new scenario added. Correctly scoped.
   - `dataset-write-auto-run`: baseline requirement text (`openspec/specs/dataset-write-auto-run/spec.md`)
     is reproduced byte-for-byte identical in the delta (including the "recorded (at minimum,
     logged)" clause, which already backs Decision 3), with both existing scenarios preserved
     verbatim and one new scenario appended. Correctly scoped.
   - `openspec validate auto-run-guard-enforcement --type change` passes: `Change
     'auto-run-guard-enforcement' is valid`.

4. **Confirmed the referenced test files for the group-3.5 regression run actually exist**:
   `AutoRunTriggerServiceSpec.scala`, `PipelineSchedulerServiceSpec.scala`,
   `PipelineRunGuardIntegrationSpec.scala`, `DatasetWriteAutoRunCoalescingSpec.scala`,
   `DatasetWriteAutoRunEndToEndSpec.scala` all present under `backend/src/test/scala/com/helio/services/pipelines/`.

5. **Verified HEL-1173 exists and is scoped as claimed** (`mcp__linear__get_issue`): title matches,
   description correctly attributes the arithmetic and the owner ruling, `origin_ticket: HEL-1097`
   is present in the body text, labeled `Follow-up`, project is `Helio v0.8 — Interactive Data &
   Write-Back` (`28f119e2-5738-46b1-a53b-42f73e06b053`), matching C8. Did not independently verify
   the `relatedTo` link (not fetched via `includeRelations`) — minor, not load-bearing for this
   ticket's own design soundness, and C8 is an execution-time constraint on *this* ticket, not a
   gate on HEL-1173's own delivery.

### Answers to the five scrutiny points

1. **Debounce-defeated test strategy (Decision 1)**: Sound. Since I confirmed the rate-limit check
   is keyed only on `user.id` and is a DB-atomic operation entirely independent of the debounce
   table, proving the guard holds under (a) temporally-spread fires from one pipeline and (b) two
   scheduler instances sharing one DB is sufficient to prove the AC — the debounce mechanism plays
   no role in the guard's own correctness, only in how many *fire attempts* get generated. I could
   not find a scenario this misses (e.g., cross-pipeline aggregation for one owner is the same code
   path parameterized identically on `user.id`, so it's not a materially different case requiring a
   separate scenario).

2. **Guard-bypassed red case (Decision 2)**: Legitimate, not tautological. `pipelineRunGuardRepo`
   is a real nullable-optional constructor parameter with an explicit `if (pipelineRunGuardRepo !=
   null)` branch in production code (`executeRun` line 963) — constructing a fixture without it
   exercises a real branch of real production code, not dead code. Task 3.3's requirement to first
   confirm the red case actually fails when the repo IS wired in (before committing it in its
   guard-off form) is the correct falsifiability discipline. This test only proves the suite's own
   assertions are guard-sensitive; it does not by itself prove there's no bypass elsewhere in
   production — that's task 1.1/1.2's job, correctly kept separate.

3. **Guard-rejection visibility staying log-only (Decision 3)**: Defensible, not a silent scope
   narrowing. The ticket's own scope item 4 explicitly required a *stated* decision rather than an
   assumption, and Decision 3 does exactly that — with a documented alternative considered and
   rejected, and an explicit statement that the evaluator/skeptic gates can override it if the
   AC's literal text is later found to require more. The AC text itself ("a burst of writes cannot
   exceed the per-principal run budget") is about enforcement, not visibility, and the existing
   `dataset-write-auto-run` baseline spec already only required "recorded (at minimum, logged)" —
   this decision doesn't narrow anything already promised.

4. **Task 1.1 concreteness**: Concrete enough. It names the exact classes/methods to re-check
   (`AutoRunTriggerService`, `PipelineSchedulerService.processAutoRunDebounce`/`fireAutoRun`),
   requires confirming each reaches the guard with "no alternate route," and requires findings
   recorded in the PR body (auditable). The one open-ended clause, "any retry/backfill-adjacent
   code," is inherently exploratory (an audit task can't pre-enumerate what it hasn't found) — my
   own grep confirms there is in fact no such code today, so this clause should resolve to "none
   found" rather than being a gap the executor could dodge.

5. **Spec delta scoping**: Correct — both `MODIFIED Requirements` blocks contain the full original
   requirement text (confirmed against the current `openspec/specs/` baselines) plus additive
   scenarios/clauses, not partial rewrites. `openspec validate` passes.

### Verdict: CONFIRM

The design is sound. My own independent code reading corroborates the premise validation's central
claim (the guard already applies unconditionally on the auto-run fire path, keyed on `user.id`,
DB-atomic, with no bypass route found), and the four design decisions are well-reasoned,
non-tautological, and consistent with the ticket's owner-ruled scope (proof plus closing any real
gap found, not new guard machinery). The spec deltas are correctly scoped.

### Non-blocking notes

- Task 1.1's catch-all "any retry/backfill-adjacent code" phrase could optionally note explicitly
  that my own grep found none today, so the executor isn't left wondering whether they're expected
  to invent a retry mechanism to audit. Not required — the task's own final clause ("If no gap is
  found, do not invent one") already covers this.
- Consider having the executor also fetch `HEL-1173`'s relations (`includeRelations`) to confirm the
  `relatedTo HEL-1097` link C8 requires, since I did not verify it here.
