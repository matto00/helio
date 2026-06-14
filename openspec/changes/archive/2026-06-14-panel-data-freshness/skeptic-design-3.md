## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

**1. Prior REFUTE resolution check**

Read `skeptic-design-1.md` (round 1, REFUTE). Two CRs were issued:
- CR #1: Tie-break semantics — design D3 originally omitted the `last_run_status = 'success'` filter.
- CR #2: Binding detection mechanism unspecified.

Read current `design.md`, `tasks.md`, and `specs/panel-data-freshness/spec.md` to assess remediation.

**2. Binding detection — CR #2 RESOLVED**

`design.md` D3a (lines 54–61) now specifies that the extraction mechanism is `panel.dataTypeId`, declared as an abstract method on the `Panel` sealed trait. Verified in `backend/src/main/scala/com/helio/domain/Panel.scala` line 58: `def dataTypeId: Option[DataTypeId]` — confirmed present. The subtype-level handling of empty `DataTypeId("")` as `None` is also stated. CR #2 is fully resolved.

**3. Status filter value — CR #1 "resolved" BUT INTRODUCES A NEW ERROR**

`design.md` D3 (line 49) and `specs/panel-data-freshness/spec.md` (lines 6, 12) both now specify the filter as `last_run_status = 'success'`.

Ground truth: searched all backend source files for the actual string used when a pipeline run succeeds.

Evidence from codebase:
- `backend/src/main/scala/com/helio/spark/PipelineRunCache.scala` line 9: `val Succeeded = "succeeded"`
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` line 292: `pipelineRepo.updateLastRun(pipelineId, "succeeded", now, ...)`
- `backend/src/main/scala/com/helio/api/routes/PipelineRunRegistry.scala` line 23: `Set("succeeded", "failed", "dry_run")`
- `backend/src/test/scala/com/helio/infrastructure/PipelineRepositorySpec.scala` line 78: `found.get.lastRunStatus shouldBe Some("succeeded")`

The success status value in this codebase is `"succeeded"`, not `"success"`. Design D3 and the spec both say `'success'`. If the executor follows the design verbatim, the Slick query will filter `WHERE last_run_status = 'success'` — a value that is never written to the database. The new repository method will always return `None`, the `dataAsOf` field will always be `null`, and the feature will silently fail to work in production with no compile-time or test-time error (unless the test in task 3.1 seeds with `"succeeded"` and asserts the return is non-null, which is not guaranteed given the task text).

**4. Spec scenario terminology — same wrong value**

`specs/panel-data-freshness/spec.md` lines 12 and 26 repeat `last_run_status = 'success'` in the scenario conditions. Task 3.1 says "returns correct timestamp for a pipeline with a run" without specifying the status string used when seeding. If the test seeds with `"succeeded"` (correct) but the implementation filters on `'success'` (wrong), the test will fail. If the test seeds with `'success'` (wrong, matching the spec) and the impl filters on `'success'`, the test passes but the production path (which writes `"succeeded"`) never exercises the filter.

**5. All other elements verified sound**

- AC coverage: all 4 ACs traced to tasks and design decisions. No gaps.
- `PanelResponse` field count (8 → 9, `jsonFormat9`): confirmed via round 1 evidence; design D5 accurate.
- `withSystemContext` pattern: confirmed present in `PipelineRepository.scala` lines 44–45, 194.
- `output_data_type_id` column: confirmed in `PipelineRepository.scala` line 264.
- `formatRelativeTime` utility: confirmed in round 1, not re-read (non-controversial, no new evidence needed).
- Schema: `dataAsOf` already present in `schemas/panel.schema.json` per round 1 report.
- No Flyway migration needed: confirmed, `last_run_at` exists already.
- `Future.sequence` for N+1 mitigation: design acknowledged, acceptable risk documented.
- No internal contradictions found in proposal ↔ design ↔ tasks alignment (except the status string error, which is consistent across design and spec — consistently wrong).

---

### Verdict: REFUTE

### Change Requests

1. **Wrong run-status string in design D3 and spec** — The codebase writes `"succeeded"` (not `"success"`) as the successful run status. `RunStatus.Succeeded = "succeeded"` (`PipelineRunCache.scala:9`); `pipelineRepo.updateLastRun(pipelineId, "succeeded", ...)` (`PipelineRunService.scala:292`). Design D3 (`design.md:49`) and `specs/panel-data-freshness/spec.md` (lines 6 and 12) both specify `last_run_status = 'success'`. If implemented as written, the SQL predicate will never match any row, the new method will always return `None`, and `dataAsOf` will be `null` for all panels regardless of pipeline history — a silent correctness failure. Fix `design.md` D3 to say `last_run_status = 'succeeded'` and update the spec scenarios accordingly. Also ensure task 3.1's test explicitly seeds with `"succeeded"` so the test can catch a regression.

### Non-blocking notes

- Task 3.1 is underspecified on the seed status value. Even after fixing the design/spec, the task text should explicitly say "seed a pipeline row with `last_run_status = 'succeeded'`" (not just "a pipeline with a run") so the test author does not accidentally seed with the wrong string and create a passing-but-worthless test.
- The schema file `schemas/panel.schema.json` was already populated before execution (noted in round 1). Task 1.5 remains a likely no-op; executor should verify before acting.
