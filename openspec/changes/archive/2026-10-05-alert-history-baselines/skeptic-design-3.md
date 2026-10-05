## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 2f4956509d0e125414335d99fc44628f6d264cc2 (main). The change dir is untracked, and there are no code changes yet.
cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/alert-history-baselines/HEL-1278`.

### What I verified (with evidence)

**`openspec validate alert-history-baselines --type change` passes.** Output: `Change 'alert-history-baselines' is valid`.

**Round-2 CR1 (living "Clearing the condition auto-resolves" contradiction): fixed.**
- The living text is at `openspec/specs/alert-evaluation-engine/spec.md:95-106`.
- The MODIFIED block in `specs/alert-evaluation-engine/spec.md` now resolves only when "the rule produced a comparison and that comparison does not breach":
  - a threshold rule must have extracted its metric;
  - a baseline rule must have resolved both its current value and its baseline.
- Both living scenarios are kept verbatim: "Clear transitions firing to resolved" and "No active event, no breach — no-op".
- A new scenario, "Insufficient baseline leaves an active baseline event firing", pins the behaviour that was previously ambiguous.
- This is consistent with "Insufficient baseline never breaches" (no breach and no auto-resolve).

**Round-2 non-blocking notes: addressed.**
- C1 (tasks.md) now says the current-run point is inserted "with the NEWEST captured_at". That means M2 (`listRecent(k)`) really goes red, given that `listRecent` sorts `(capturedAt desc, id desc)` (`OutputHistoryRepository.scala:74-77`).
- The previous-run resolve example is now concrete: 125 against a previous 120 gives delta 5, which is not greater than 10, so the event resolves.
- Task 2.1 covers the case where `sum: null` is treated as no value.

**Whole-plan re-check against every living requirement.** I listed every `Requirement:` in `openspec/specs/alert-evaluation-engine/spec.md` and `openspec/specs/alert-rule-crud-api/spec.md`.
- **Contradicted living requirements now have MODIFIED blocks.** These are: Single evaluation entry point, Metric extraction, Threshold comparator, Breach drives a firing event, Clearing auto-resolves, and Create alert rule.
- **The remaining requirements are not contradicted by the plan:**
  - Evaluation never fails the run: a malformed baseline throws inside the per-rule recover.
  - Fired/resolved events are logged.
  - Load enabled rules.
  - List, Get, Update and Delete alert rule. Update is partial-field, and `applyUpdate` re-validates only a supplied `condition`, so a PATCH without a condition is unaffected.

**Live code claims re-checked:**
- `AlertEvaluationService.scala:43-67` matches design Context: `numericValue` has no string coercion, and `extractMetric` sums.
- `AlertRuleService.validateCondition` (`:137-154`) currently validates only `comparator` and `threshold`. D6's additions slot in there.
- `new AlertEvaluationService` is constructed only at `ApiRoutes.scala:419` (grep of `backend/src/main`). There is no Main/scheduler construction, so D7's single wiring line covers every caller, including scheduled runs that go through PipelineRunService.
- `outputHistoryRepoOpt` (`:253`) is declared before `alertEvaluationServiceOpt` (`:415`).
- `OutputHistoryPoint.runId: Option[String]` supports the D2 run-id filter.
- `schemas/alerts/create-alert-rule-request.schema.json:18` still has the stale "validates only `comparator` and `threshold`" description. Task 1.5 covers it.

**AC trace (plan level):**
- AC1 (previous/rolling breach and resolve): spec scenarios, plus tasks 2.1 and 2.2.
- AC2 (empty history means no breach): "Empty history" scenario, task 2.2, and M5.
- AC3 (400 on create and update): crud delta, task 2.4, and M6.
- AC4 (current run excluded): C1 with M1/M2, a deterministic newest-point fixture.
- AC5 (API-only; schemas updated): task 1.5; no frontend or MCP work.

There is no scope drift: the plan stays out of PipelineSchedulerService, Main, OutputRoutes, OutputService and PublicDashboardRoutes, and has no migration. The extractMetric product escalation is avoided because D1 leaves existing threshold rules byte-unchanged.

### Verdict: CONFIRM

### Non-blocking notes
- The "History-baseline conditions" requirement says "the `n` newest history points" without restating the exclusion. The separate "Baseline excludes the triggering run" requirement governs, so this is fine. The implementer should still read the two together.
- Task 2.4 should also check that a condition with no baseline but stray `mode`/`n` keys is rejected on PATCH, not only on POST. This is already listed in 2.4's malformed set; this note just flags that it should not be dropped.

### Gate notes
- Design gate: no screenshots or measurement artifacts were captured, and nothing relies on mtime ordering.
