## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD: 222e855c0852376a90dbc77a965c130316588729 (planning artifacts untracked under openspec/changes/pin-chat-cap-day-clock/).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/pin-chat-cap-day-clock/HEL-1473`.
- **Premise (root cause by code reading):** `AssistantDailyUsageRepository.scala:31` has `val today = LocalDate.now(ZoneOffset.UTC).toString`, computed inline on each call. The class signature at l.20 is `(ctx: DbContext)(implicit ec)` and has no clock. The premise is confirmed.
- **Clock seam exists:** `com.helio.domain.util.Clock` (`def now(): Instant`) and `SystemClock.now() = Instant.now()`.
- **D1 behaviour identity (orchestrator point 2): sound.** In the JDK, `LocalDate.now(zone)` = `now(Clock.system(zone))` = `ofInstant(clock.instant(), zone)`. `Clock.system(UTC).instant()` and `Instant.now()` read the same VM wall-clock source. `LocalDate.ofInstant(SystemClock.now(), ZoneOffset.UTC)` therefore produces the same date. The two forms read the clock at slightly different nanoseconds, which is irrelevant because production reads it once per call either way. Name-clash risk: the repo file imports `java.time.{LocalDate, ZoneOffset}` and not `java.time.Clock`, so `Clock` resolves unambiguously to the helio trait. The default parameter keeps both `ApiRoutes.scala:437` and `:611` source-compatible.
- **D4 constructor enumeration (orchestrator point 3): complete.** `grep -rn "AssistantDailyUsageRepository(" backend/src` finds 2 main sites (ApiRoutes 437/611) and exactly 8 test sites: RefinementRoutesSpec:95, AiPipelineQuotaGateSpec:49, ClaudeRoutesChatGateSpec:126, DashboardAuthoringRoutesSpec:102, AssistantConversationRoutesSpec:140, AssistantDailyUsageRepositorySpec:90, AssistantTelemetrySpec:97, AuthoringTelemetrySpec:107. This matches the design's list. No subclass or helper builds the repo in any other way.
- **Other per-UTC-day real-clock readers:** `grep -rn "assistant_daily_usage\|usage_date"` over backend/src/test finds real-clock `today`/`yesterday` computations in:
  - ClaudeRoutesChatGateSpec: l.204, inside the `usage(f)` helper
  - AssistantConversationRoutesSpec: l.265, inside the `dailyUsageCount` helper. It is used only at l.624, an owner-tier `None` check. The beta cap test at l.572 reads nothing back.
  - AiPipelineQuotaGateSpec: l.66, inside the `countFor` helper
  - AssistantDailyUsageRepositorySpec: l.111 (`countFor` helper), l.172 (`yesterday`), **and three more inline sites in the RLS tests at l.196, l.210 and l.221**. The design does not mention these three. See CR-1.
- **Non-sensitive specs (D4):** RefinementRoutesSpec, DashboardAuthoringRoutesSpec, AuthoringTelemetrySpec and AssistantTelemetrySpec seed every fixture user as `owner` tier. Their own comments say so (l.94, l.101, l.106, l.70–71), and `ChatAccessService` never calls `incrementIfUnderCap` for owner. Not pinning them is correct, though for a different reason than the one the design gives (see notes).
- **Per-spec isolation under a shared pinned instant (D3):** ClaudeRoutesChatGateSpec and AssistantConversationRoutesSpec create a fresh user per tier test (`newUser`/`newUserWithTier`). AiPipelineQuotaGateSpec calls `cleanUsage()` (TRUNCATE) at the start of every test (l.81/88/95/104/111). The repo spec calls `cleanDb()` (TRUNCATE) in every test. Isolation holds.
- **D3 wiring guard (orchestrator point 3): failable.** The pinned date 2026-01-01 differs from today (2026-10-10). If a spec's repo is built without the pin, the stored `usage_date` is the real date and the equality check fails. Each target spec holds a single shared `usageRepo` var that every `chat(...)`/`chatAccessServiceWithLimit(...)` reuses, so one guard per spec covers every construction. The mutation step (3.2) proves failability. The only blind day is 2026-01-01 itself, and the design discloses it.
- **D2 probe (orchestrator point 1): sound in principle, disclosure adequate.** A shifted real clock (`Instant.now().plus(offset)`) goes through the unchanged production date expression and really ticks across a day boundary between calls. That is equivalent to libfaketime's start-at mode, and the design discloses it honestly (the epoch shift goes through the new seam, not the OS clock). The RED criterion (denied call admitted plus two `usage_date` rows one day apart) can be refuted, and there is a 6-attempt cap. One mechanical hole in the procedure is covered in CR-2.

### Verdict: REFUTE

The design is close and both of its main claims hold (D1 identity, a failable D3 guard). Two specific gaps would leave the fix incomplete or make the probe produce a misleading RED. Both are cheap artifact edits.

### Change Requests

1. **D3/D4 under-scope AssistantDailyUsageRepositorySpec.** D3 pins only "its read-back helper" and the "yesterday" seed, but the spec also computes `LocalDate.now(ZoneOffset.UTC)` inline in three RLS tests:
   - l.196, "RLS: ownerB's context cannot see ownerA's daily usage row": `rows shouldBe empty`. Across a midnight crossing this test turns **vacuously green**, not flaky: it queries a day with no row, so it proves nothing about RLS.
   - l.210, "cannot increment/overwrite": `updated shouldBe 0` is vacuous across midnight, then `countFor(ownerA)` breaks.
   - l.221, "withSystemContext sees the row": `rows should contain(ownerA.value)` fails across midnight.

   Revise D3 and task 3.3 to require every `today`/`yesterday` in the pinned specs to derive from the pinned clock. Add an acceptance signal: `grep -n "LocalDate.now" ` over the four pinned spec files returns zero hits, with the output pasted into files-modified.md.

2. **D2's procedure does not say what date the probe's read-back helpers use.** In ClaudeRoutesChatGateSpec's target test, `usage(f) shouldBe Some(2)` (l.242) runs between the last admitted call and the call expected to be denied. That is exactly the window where D2 places the midnight. `usage(f)` reads the real `LocalDate.now`, while the writes go to shifted dates, so whether l.242 passes depends on the arbitrary choice of offset. With a backward shift, for example, the test fails at l.242 with `None was not equal to Some(2)`. That failure is a probe artifact, not the hypothesised symptom, and it could burn attempts or be misread as RED. Revise D2 to require one of the following during the probe:
   - (a) the read-back helpers derive the date from the same shifted clock at read time, and the dump queries all of that user's rows regardless of date; or
   - (b) the sleep is placed after l.242 and before the third Post.

   Also state explicitly that RED counts only if the failing assertion is the expected-429 call returning 200/201: ClaudeRoutesChatGateSpec l.243 `expectTier(... TooManyRequests ...)`, or AssistantConversationRoutesSpec l.583 `status shouldBe TooManyRequests`. A failure anywhere else in the test is not RED.

### Non-blocking notes

- D4's example reason for skipping a spec ("limit 50 … fewer than 50 calls") is not the real reason for the four non-sensitive specs. They use only owner-tier users, so the repo is never called. Record that reason in files-modified.md instead.
- AssistantConversationRoutesSpec's beta cap test (l.572) has no usage read-back today. The D3 wiring guard there will be a new assertion (a `usage_date` query), not a change to an existing helper. That is fine, but its target is the new l.572-test assertion, not `dailyUsageCount`, which only serves the owner test at l.624.
- When pinning, `import com.helio.domain.util.Clock` must not be shadowed by a `java.time.Clock` import in specs that already import `java.time._` members. Check each spec's imports. ClaudeRoutesChatGateSpec and AssistantConversationRoutesSpec import `java.time.LocalDate`/`ZoneOffset` individually, so they are fine.
- AiPipelineQuotaGateSpec's cap test (l.94–100) is boundary-sensitive: `countFor(betaUser) shouldBe Some(1)` follows two calls. Pinning it as planned is correct.
