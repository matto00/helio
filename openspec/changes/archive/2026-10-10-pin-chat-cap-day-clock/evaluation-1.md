## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `e276b46a26fab1e9b91ac7a31d0e707baf6d135a` (base `222e855c0852376a90dbc77a965c130316588729`, resolved live via `resolve-review-base.sh`). Worktree clean at review time.

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (how the day bucket gets its time): it is the real clock. `AssistantDailyUsageRepository.incrementIfUnderCap` at base computed `LocalDate.now(ZoneOffset.UTC)` inline. Confirmed in the base diff.
- AC2 (seam + pin, red-first): the seam is `clock: Clock = SystemClock` on the repository (`AssistantDailyUsageRepository.scala:25`), and the day is now `LocalDate.ofInstant(clock.now(), ZoneOffset.UTC)` (`:36`). Both target specs are pinned to 2026-01-01T12:00Z. I checked the RED transcripts myself, not the summary:
  - `probe-2.1-attempt2.log:216-220`: the first call after the sleep runs at shifted `2026-03-05T00:00:01.337Z` and fails `200 OK was not equal to 429 Too Many Requests (ClaudeRoutesChatGateSpec.scala:216)`. With the 4 probe lines added, line 216 maps to `status shouldBe st` in `expectTier`, so the failing call is the one expected to get 429. The rows dump is `Vector((2026-03-04,2), (2026-03-05,1))`: two `usage_date` rows a day apart, each at or under limit 2.
  - `probe-2.2-attempt2.log:252-256`: the expected-429 call at shifted `2026-03-05T00:00:01.046Z` returns `200 OK was not equal to 429` (`AssistantConversationRoutesSpec.scala:592`). Rows are `Vector((2026-03-04,1), (2026-03-05,1))`, each at or under limit 1. Attempt 1 failed with a 500 because the transport was exhausted. That was a probe artifact, correctly not counted. Attempt 2 added a second transport response, a reasonable correction made inside the 6-attempt budget.
  - Disclosure per D2: the crossing is real elapsed time through the production date expression, but the epoch is shifted through the new seam, not the OS clock.
- AC3 (by-log loop): I re-ran it myself. See Phase 2.
- Tasks 1.1–3.5 are all marked done and match the diff. No scope creep: the change is 1 main file and 4 test specs, with no API, schema, migration or frontend change.
- CONSTRAINTS:
  - C1: RED came from the shifted-real-clock probe. The loop is judged by log.
  - C2: the diff contains no `EmbeddedPostgres` line edits and no probe or mutation residue (grep for `ProbeClock|Thread.sleep|[probe]` over the diff finds nothing).
  - C3: `SystemClock` is the default, `ApiRoutes.scala` is not in the diff, and both production constructors (`ApiRoutes.scala:437,611`) use the default.
  - C4: I re-ran `grep -n LocalDate.now` over the four pinned specs myself and got zero hits (exit 1).
- D4 sweep verified independently. The 4 unpinned constructors (RefinementRoutesSpec:95, DashboardAuthoringRoutesSpec:102, AuthoringTelemetrySpec:107, AssistantTelemetrySpec:97) all seed `tier = 'owner'` fixtures only (RefinementRoutesSpec:128, DashboardAuthoringRoutesSpec:132, AuthoringTelemetrySpec:144, AssistantTelemetrySpec:110). Owner tier is never counted, so no day bucket is touched.

### Phase 2: Code Review — PASS
Issues: none blocking

Gates I re-ran myself (logs in `.concertino/runs/HEL-1473/evidence/evaluator-cycle1/`):
- Four pinned specs (`testOnly`, `nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false`), log `four-specs-run1.log`:
  - `Suites: completed 4, aborted 0`
  - `Tests: succeeded 43, failed 0`
  - `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
  - 43 `[info] - ` test lines, including both cap tests carrying wiring guards, the "yesterday" test and the RLS tests. This was not a zero-test run.
- Full `sbt testFull`, log `testFull.log`:
  - `Suites: completed 478, aborted 0`
  - `Tests: succeeded 6571, failed 0, canceled 4`
  - `[hel1468-guard] ... failed=0 aborted=0 unreadable=0`
  - No `*** FAILED`. The 4 cancellations are existing measurement tests gated on `HELIO_MEASURE`, unrelated to this change.
- `npm run check:scala-quality`: clean (soft file-size warnings only, all pre-existing). `npm run check:openspec`: clean. Prettier over the change dir: clean.
- Executor loop evidence: `loop-iter-{1..20}.log` all show `Tests: succeeded 43, failed 0` plus the guard line. I grepped each file myself.
- Mutation evidence (`mutation-3.2.log`): with the pin dropped, the AssistantConversationRoutesSpec wiring guard goes red (`Vector("2026-10-10") was not equal to Vector("2026-01-01")`, :600). ClaudeRoutesChatGateSpec also goes red, but on the pinned-date read-back (`None was not equal to Some(2)`, :247), one line before the new guard. Removing the pin is detected either way.

Code-quality checklist:
- Imports are top-of-file with no inline FQNs (the probe-only FQNs were not committed).
- Behaviour is preserved: `LocalDate.now(UTC)` is equal to `LocalDate.ofInstant(Instant.now(), UTC)`.
- No dead code, no over-engineering. Per-spec private clocks follow the existing `FakeClock` convention by design (D3).
- Per-spec isolation under the shared instant holds: fresh users in the route specs, and `TRUNCATE` in each test of the repo and quota-gate specs, as confirmed in the source.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. Only `openspec/changes/**` was touched, which is not a trigger.

### Overall: PASS

### Non-blocking Suggestions
- `ClaudeRoutesChatGateSpec.scala:250`: the new `usage_date` wiring guard was never seen red on its own, because the read-back at :247 fails first under the mutation. It adds little over the pinned read-back. Keep it or drop it.
- Import grouping: `import com.helio.domain.util.Clock` is placed in the middle of existing import lines, and `java.time.Instant` is a separate line rather than merged into the existing `java.time.{LocalDate, ZoneOffset}` selector (AssistantDailyUsageRepositorySpec, AiPipelineQuotaGateSpec). This is cosmetic only.
