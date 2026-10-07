## Skeptic Report — final gate (round 1, skeptic-final-1.md)

**Commit reviewed:** `b871f80fe85d4fe65d2b0547b5c800476763840a`. The base was resolved live with `resolve-review-base.sh` as `d125b654141ac79d96a8fd0f9cb5e74b834c7c0c`. Two commits: 482b1d794 and b871f80fe.

**Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/baseline-semantics-after-thinning/HEL-1285`.

### What I verified (with evidence)

**The code matches ruling Q1 (C1).**
- `OutputHistoryRepository.scala` adds an inner per-output recency ranking: `row_number() OVER (PARTITION BY output_id ORDER BY captured_at DESC, id DESC)`.
  - This is the same ordering `listRecent` uses.
  - The outer bucket rank only sees rows where `recency > $protectedNewest`.
  - `$protectedNewest` is a bound interpolation, not text splicing.
- The age-purge DELETEs are untouched and still run first, so the tier cap still beats protection.
- `HistoryBaselineLimits` (domain) has `MaxRollingN = 100` and `ProtectedNewestPoints = MaxRollingN + 1`.
  - `HistoryBaseline.MaxRollingN` aliases it, so the alert validator and the thinner cannot drift.
  - There is no env var.
  - `OutputHistoryRetentionService` takes `protectedNewest` with the constant as its default. `Main` wiring is unchanged.
- **C2:** window compare code (`nearestAtOrBefore`) is untouched. Only scaladoc was added.

**I re-ran the proof and the affected specs myself.**
- Command: `sbt -batch -Dsbt.server.autostart=false "testOnly …HistoryBaselineAfterThinningSpec …OutputHistoryRepositorySpec …OutputHistoryRetentionServiceSpec …RetentionLockGuardSpec"`.
- Result: `Tests: succeeded 40, failed 0`.
- In `HistoryBaselineAfterThinningSpec`, (a), (b), (c1), (c2), the age-cap case and the 40-day free+owner case all ran and passed.
- **Measurement note:** my first attempt used the thin client and silently loaded a different worktree's build (`.../task/fix-lz4-java-advisory/hel-1367/backend`). The new spec never ran in that attempt, so I discarded it. I re-ran in `-batch` mode after confirming that `loading project definition` pointed at this worktree. This is an environment hazard, not a defect in this change.

**The proof fixture meets C3/C4.**
- `now` is fixed at 12:04Z.
- 111 one-minute points carry distinct values (`1000 - i`) in both `metric.value` (with `v: 1`) and `columns.amount.sum`.
- Point 0 carries the triggering `runId`, and the rule `gte -1e6` breaches deterministically.
- (b) asserts the real `OutputHistoryService.forOutput` baseline is `minutesAgo(1)` with value 999.
- (c1) and (c2) read the persisted event's `value.baseline` from a real `AlertEvaluationService` run.
- (a) checks the exact survivor set `0..100 ∪ {101, 105, 110}`, which tells K=101 apart from K=100.

**Red proof.** I did not re-run it myself. I am relying on two sources:
- The executor's log at `red-proof/red-predicate-reverted-split-c.log`.
- The evaluator's independent reproduction in evaluation-2.md, with these failure lines:
  - (b) `Some(11:59) was not equal to Some(12:03)`
  - (c1) `995.0 was not equal to 999.0`
  - (c2) `None.get`: fewer than 100 eligible points, so no event

These readings are consistent with the SQL. With the recency predicate removed, the [12:00, 12:05) bucket collapses to point 0, so the previous point becomes 11:59 = point 5 = 995. I accept this as a predicate-only revert that still compiles.

**Frontend and MCP tests.**
- Jest `OutputEditorSheet.compare` + `metricHistoryView`: 53/53 passed.
- Root jest `helio-mcp/src/server.test`: 15/15 passed.

**UI.** The only UI change is that the chart Compare `Select` now uses the same option list as metric Outputs (an existing shared component). I viewed the evaluator's HEL-1350 dark-theme picker screenshot (`e2e-evidence/HEL-1350/editor-compare-picker-dark.png`); it is consistent with sibling fields. No new styling or tokens were added, so there is no design-standard surface to judge. I did not take my own screenshots: the design risk is nil, and REFUTE is already warranted below.

**AC1: recorded on HEL-918.**
- The ruling is in `events.jsonl` as `escalation.answered` (`protect-newest-101, keep-d6-and-document, re-add-here, docs-only`).
- HEL-918's `updatedAt` is today, but my Linear tool cannot list comments, so I could not read the recorded comment itself. This is unverified by me, not refuted.

**AC2 (code matches decision + thinned-fixture test): met**, per the above.

**AC3 (document the semantics wherever users see compare/alert baselines, "such as the API docs"): NOT met.** I grepped the whole tree for the old wording: `grep -rnI -i "surviving|RETAINED|not necessarily|thinn"` over `schemas/`, `openspec/specs/`, `helio-mcp/src` and `frontend/src`. It found contract and spec text that still states the superseded semantics, and the branch does not touch any of it:
- **API contract schemas.** CLAUDE.md names `schemas/` as the source of truth for the API contract. Both history response schemas still say: *"previous_run: the second-newest RETAINED point (history is thinned with age, so this is not necessarily the immediately previous run)."*
  - `schemas/outputs/output-history-response.schema.json:35`
  - `schemas/outputs/public-output-history-response.schema.json:32`
  - This is the literal "API docs" surface the AC names, and it now contradicts the shipped behavior, CLAUDE.md, the MCP description and the new spec delta.
- **`openspec/specs/mcp-output-tools/spec.md:150-152`** still requires: *"It SHALL state that a `previous_run` baseline is the second-newest retained history point, which may be older than the immediately preceding run … The description SHALL NOT claim the baseline is the previous run."*
  - The branch rewrote the MCP description (`helio-mcp/src/tools/outputs.ts`) to say exactly the opposite ("the immediately previous recorded run").
  - The change dir has no `mcp-output-tools` delta, so once archived, the main spec and the code will directly contradict each other.
- **`openspec/specs/output-snapshot-history/spec.md:76-78`**, scenario "Thinning keeps the newest point per bucket", says: *"only the newest point in that bucket remains"*.
  - This is now false for any bucket among an Output's newest 101 points.
  - There is no `output-snapshot-history` delta. The `output-history-retention` delta covers the scheduler requirement, but not this repository-primitive requirement.

### Verdict: REFUTE

### Change Requests
1. **Update both history response schemas' `baseline.description`** (`schemas/outputs/output-history-response.schema.json:35`, `schemas/outputs/public-output-history-response.schema.json:32`):
   - Replace the "second-newest RETAINED point … not necessarily the immediately previous run" text with the ruled semantics: `previous_run` is the immediately previous recorded run, because thinning never deletes an Output's newest 101 points.
   - State the window slack: the baseline may be up to one thinning bucket (5 min / 1 h / 1 d by age) earlier than `current.capturedAt − window`.
   - Wording should match CLAUDE.md and the `output-history-api` delta. Run the schema-drift check afterward.
2. **Add a MODIFIED `mcp-output-tools` spec delta** for the "get_output_history MCP tool" requirement (and the "compare is documented on every Output config write tool" requirement if its text pins the old `previous_run` wording).
   - Replace the "second-newest retained … SHALL NOT claim the baseline is the previous run" sentences with the new semantics plus the window slack.
   - The existing "does not contain the phrase 'previous run'" scenario may stay; the current description satisfies it. Keep every other scenario.
3. **Add a MODIFIED `output-snapshot-history` spec delta** for "History repository primitives":
   - Qualify the thinning primitive and its "Thinning keeps the newest point per bucket" scenario so that an Output's newest 101 points (`captured_at DESC, id DESC`) are never thinned, and bucketing applies to older points (newest unprotected point per bucket).
   - The tier max-age purge still applies to protected points.
   - Keep the other scenarios unchanged.
4. Re-grep after the edits to show zero remaining hits for the superseded semantics outside `openspec/changes/archive/**` and this change dir: `grep -rnI -i "RETAINED point\|not necessarily the immediately previous\|second-newest retained" schemas openspec/specs helio-mcp/src frontend/src`.

### Non-blocking notes
- `compareOptions.ts:17`: `CHART_COMPARE_OPTIONS` is now a bare alias of `METRIC_COMPARE_OPTIONS`. That is fine, but collapsing the two is optional.
- The 40-day spec's `modelSurvivors` partitions by age class like the SQL, so it is not fully independent of the straddling-boundary behavior. It is acceptable because the 5-minute proof also pins a hand-derived exact set.
- Environment hazard for future gates: `sbt` (sbt 2 thin client) run from this worktree attached to another worktree's sbt server and ran that build's tests with exit 0. Use `sbt -batch` and check the `loading project definition` line. Consider adding this to MISTAKES.md.
