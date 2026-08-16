## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

This is a cold, independent pass — not a rubber-stamp of `skeptic-design-{1,2,3}.md`. I read
`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and `specs/pipeline-assert-evaluation/spec.md` in
full, then re-derived every load-bearing factual claim in `design.md` against the actual source tree
rather than trusting the document's or the prior reports' narrative.

**Round 3's fix (Decision 4a) — independently re-verified, genuinely present and correct.**
`design.md` Decision 4a (lines 110-128) and Decision 6 (lines 143-162) state every `insertAssertions`
call site is wrapped in `.recoverWith { case _ => Future.successful(()) }`. I confirmed:
- `PipelineRunRepository.insertRun`/`insertDryRun` (`infrastructure/PipelineRunRepository.scala:43-54`,
  `:118-126`) both gate on `pipelineOwnedAction` (`:31-34`, `p.ownerId === UUID.fromString(user.id.value)`)
  and silently no-op (`case false => Future.successful(())`) for a non-owner — matches the design's
  citation exactly.
- `PipelineRunRepositorySpec.scala:269-274` ("insertRun is a silent no-op for a non-owner (CS2)") and
  `:276-281` ("insertDryRun is a silent no-op for a non-owner (CS2)") are real, passing tests exercising
  exactly this behavior — not hypothetical.
- `PipelineRunService.submit` (`services/PipelineRunService.scala:83-102`) genuinely lets an editor
  grantee trigger a run with their own identity (`case Some(pipeline) if pipeline.ownerId.value !=
  user.id.value => pipelineRepo.findGrantRole(...).flatMap { case Some("editor") =>
  runPipeline(pipeline, pipelineId, isDry, user, ...) ... }`), and `runPipeline`/`executeRun`
  (`:104-131`, `:250-319`) thread that same grantee `user` into `preExec`'s `insertRun` call
  (`:266-272`, already itself wrapped in `.recoverWith` at line 271) and `onDryRunSuccess`'s
  `insertDryRun` call (`:321-337`, wrapped at line 334) — the identical precedented pattern the design
  cites for the new `insertAssertions` guard.
- `tasks.md` task 5.1 (lines 42-57) and task 6.4's fifth case (lines 69-75), and
  `specs/pipeline-assert-evaluation/spec.md`'s new "Persisting assertion results never turns a silent
  no-op run into an unhandled failure" requirement (lines 81-99) all consistently require and test this
  fix. **Resolved, and consistent across all four artifacts.**

**Round 1 (regex null-handling) and round 2 (failed-dry-run FK guard) — re-checked, still holding.**
`StringOpsStep.extractRegexFn` (`domain/steps/StringOpsStep.scala:153-173`) matches Decision 3's
citation (`Pattern.compile` + `.matcher(v.toString).find()` + explicit `if (v == null) null else`
guard before `.toString`). `PipelineRunService.scala:284-304`'s `Failure` branch nests all real-run-only
work inside `if (!isDry) { ... } else Future.successful(())` at line 295, exactly where Decision 4 says.

**Other load-bearing claims independently checked against source, not prior narrative:**
- `FilterStep`'s numeric coercion (`domain/steps/FilterStep.scala:98`,
  `Option(fieldVal).flatMap(v => Try(v.toString.toDouble).toOption)`) — real, null-safe, matches the
  `range` rule's cited precedent.
- `V35__rls_owner_only_tables.sql:77-84`'s `pipeline_runs_owner` EXISTS-subquery policy shape — matches
  Decision 6's proposed `pipeline_run_assertions_owner` policy one level deeper.
- `DbContext.scala:50,63` confirms `withUserContext`/`withSystemContext` exist as the two ACL pools the
  design relies on.
- `PipelineAnalyzeService.scala:455-498` confirms the analyze-time `kind`/`severity` allow-list
  (`AssertRuleKinds`, `AssertFieldRequiredKinds`) that Decision 3's malformed-rule fallback cites is
  real, not invented.
- `PipelineStep.scala:64-71` / `InProcessPipelineEngine.scala:18-44` confirm the exact current shape of
  `PipelineExecutionContext` and `executeWithStepCounts` the plan proposes to extend — a defaulted 4th
  parameter (`assertionSink: AssertionSink = new AssertionSink`) is source-compatible with `execute`'s
  `.map(_._1)` delegation and `previewStep`'s existing 3-arg call site, as claimed. The one existing
  direct `PipelineExecutionContext(...)` construction outside the engine
  (`AssertStepSpec.scala:83-86`) will need updating for a new mandatory field, but that file is already
  in scope for extension per task 6.1 — not a gap.
- `V83__add_assert_op.sql` confirms the CHECK-constraint precedent pattern; current highest migration is
  actually V83 (not the "V59" ticket.md mentions), but `design.md` Decision 7 / task 4.1 already require
  re-checking the number at execution time rather than trusting planning docs — the stale ticket number
  is explicitly anticipated, not a defect.
- `grep -rniE "TODO|TBD|figure out later|to be determined|placeholder"` across all five planning
  artifacts: zero real hits (one false-positive substring match inside "toDouble").
- `git status --short` in the worktree: clean except the untracked `openspec/changes/` dir — no
  partial/contradictory implementation already present to reconcile against the plan.

**Acceptance-criteria trace:** AC1 (persist per rule per run) → Decisions 1/2/5/6 + tasks 4/5. AC2 (six
rule kinds, ScalaTest-proven) → Decision 3 + task 6.1 + spec.md scenarios for all six kinds. AC3
(repository method, RLS-safe for owner+grantee) → Decision 6 (owner-scoped + `Internal` variant,
mirroring `listByPipeline`/`listByPipelineInternal`) + tasks 4.3/6.3 — a reasonable, ticket-consistent
reading given the ticket's own scope line names only repository methods, and defers UI/route wiring to
419-D. AC4 (row-in/row-out contract) → Decision 1 (types live outside `AssertStep`, threaded via
context) + task 2.2 + spec.md's dedicated requirement/scenario. AC5 (migration, `sbt test`, no FQNs) →
tasks 4.1-4.2, 6.5; no FQNs found inlined anywhere in the planning docs.

I found no new defect of the class rounds 1-3 caught (unconditional persistence call vs. an FK precondition
that can legitimately be absent) after independently re-deriving the write-path control flow myself,
including checking whether `deleteOldRuns`/`deleteOldDryRuns` retention pruning could race the new
insert (it can't — pruning runs during `preExec`, before the engine or any assert step evaluates, and
never targets the just-inserted row) and whether the cascade-delete FK (`ON DELETE CASCADE`) on
`pipeline_run_assertions` is the correct behavior for retention (it is — orphaned assertion rows should
not survive their parent run being pruned).

### Verdict: CONFIRM

The design is sound. All three prior rounds' findings are genuinely fixed — verified against the actual
source, not the prior reports' restatements — and are consistent across `design.md`, `tasks.md`, and
`specs/pipeline-assert-evaluation/spec.md`. Every acceptance criterion traces to a specific decision and
task. No placeholders, no internal contradictions, no scope drift, no missing contract updates (this
ticket correctly adds no route/protocol change, consistent with AC3's own "repository method" framing).

### Non-blocking notes

- Decision 3's malformed-rule catch-all still doesn't explicitly enumerate `field` as part of "kind/
  severity fails the analyze-time allow-list" (the allow-list also checks a missing/unknown `field` for
  field-requiring kinds) — carried over from round 2/3's observation. `field: Option[String]`'s type
  already forces an implementer to handle `None` before evaluating a field-requiring rule, so this
  remains low-risk wording, not a functional gap.
- Decision 4's claim that preview "gets the same computation as before, just unread" is slightly
  imprecise: before this ticket `AssertStep.evaluate` was a pure identity no-op (HEL-454), so rule
  evaluation during `previewStep` is new computation this ticket introduces, not a repeat of prior
  computation. The *output* previewStep returns is unaffected either way (results are discarded via the
  default sink), so this is a wording nit in the design doc, not a behavioral defect.
- This worktree's `scripts/concertino/` is still missing `next-report-number.sh`/`persist-evidence.sh`/
  `emit-event.sh` (same gap rounds 2/3 flagged) — I invoked the main checkout's copies directly against
  this worktree's paths for report-numbering/persistence, as they did.
