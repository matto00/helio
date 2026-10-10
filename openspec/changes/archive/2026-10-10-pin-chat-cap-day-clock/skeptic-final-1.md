## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `e276b46a26fab1e9b91ac7a31d0e707baf6d135a`. Base, resolved live: `222e855c0852376a90dbc77a965c130316588729`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/pin-chat-cap-day-clock/HEL-1473`.
No UI change, so step 4 (design judgment) does not apply and no servers were started.

### What I verified (with evidence)

**AC1. How the day bucket gets its time.** At base, `AssistantDailyUsageRepository.incrementIfUnderCap` computed `LocalDate.now(ZoneOffset.UTC)` inline, which is the real clock (`git diff` base...HEAD, removed line). No other main-code path reads or writes `assistant_daily_usage`: a grep of `src/main` finds only the repo itself, comments, and the two `ApiRoutes` constructors.

**Point 1 / C3. Production behaviour is unchanged.**
- The new signature is `class AssistantDailyUsageRepository(ctx: DbContext, clock: Clock = SystemClock)`.
- `SystemClock.now()` is `Instant.now()` (`domain/util/Clock.scala`).
- `LocalDate.ofInstant(Instant.now(), UTC)` gives the same value as `LocalDate.now(ZoneOffset.UTC)`, since both are the system UTC clock's instant mapped into UTC.
- `ApiRoutes.scala:437` and `:611` still call `new AssistantDailyUsageRepository(dbContext)`, so they get the default.
- `git diff --name-only base...HEAD | grep -i 'ApiRoutes|EmbeddedPostgres|migration'` returns zero hits.
- C2 holds as well: the diff contains no EmbeddedPostgres startup line.

**Point 2 / C1. The RED probe confirms the root cause.** I read the probe diffs and logs myself.
- `probe-2.1.diff`: the shifted clock is `Instant.now().plus(offset)`, which keeps ticking in real time. It is aimed at `2026-03-04T23:59:56Z`, followed by a real `Thread.sleep(5000)`. The read-back uses the same shifted clock, so it cannot produce a probe artifact.
- `probe-2.1-attempt2.log:212-220`:
  - The two admitted calls are at `23:59:56.0` and `23:59:56.29`. The rows dump is `Vector((2026-03-04,2))`.
  - The next call is at `2026-03-05T00:00:01.34`. `rows-after=Vector((2026-03-04,2), (2026-03-05,1))`.
  - The failure is `200 OK was not equal to 429 Too Many Requests (ClaudeRoutesChatGateSpec.scala:216)`. Line 216 in the probe file is base line 212 + 4, which is `status shouldBe st` inside `expectTier`. That is the expected-429 call being admitted, which is the RED criterion.
  - Attempt 1 shows the same failure, but its dump did not print rows-after.
- `probe-2.2-attempt2.log:249-256`: rows go from `Vector((2026-03-04,1))` to `Vector((2026-03-04,1),(2026-03-05,1))`. The failure is `200 OK was not equal to 429` at `AssistantConversationRoutesSpec.scala:592`, which is the denied converse call's status assertion.
  - Attempt 1 returned a 500 instead: the admitted call exhausted the one-response scripted transport. That is a probe artifact, and it was correctly fixed by adding a second response rather than counted as RED. Its dump still showed two rows.
- Both REDs meet D2/C1: real elapsed time crosses UTC midnight through the production date expression, the denied call is admitted, and there are two `usage_date` rows one day apart, each at or under the limit. The epoch was shifted through the new seam, not the OS clock, and the design states this openly.

**Point 3. Every boundary-sensitive spec is pinned.**
- Sweep: I grepped `new AssistantDailyUsageRepository(` in `src/test` and got 8 sites.
  - Four are pinned: ClaudeRoutesChatGate, AssistantConversationRoutes, AssistantDailyUsageRepository and AiPipelineQuotaGate.
  - Four are unpinned: RefinementRoutes, DashboardAuthoringRoutes, AuthoringTelemetry and AssistantTelemetry. I checked their claim. Each one seeds only `'owner'` users (lines 128, 132, 144 and 110 respectively), with no `beta` anywhere in the file. `ChatAccessService.checkConverseCap` returns early for Owner (line 42) without calling `incrementIfUnderCap`, so those four never touch a day bucket.
- C4: `grep -n LocalDate.now` over the four pinned specs returns no output (exit 1).
- The "yesterday" seed in the repository spec and the three RLS reads now derive from `pinnedDate`.
- Initialization order is safe. `PinnedDayClock` is a Scala `object` (lazy). `pinnedDate` is a class-body val, and it is only read from methods and tests, which run after construction.
- **Shadowed wiring guard in ClaudeRoutesChatGateSpec: it does not matter.**
  - `mutation-3.2.log:472-475` confirms it. With the pin dropped, line 247 (`usage(f) shouldBe Some(2)`, reading the pinned date) fails first with `None was not equal to Some(2)`, so the new guard on line 250 is never reached.
  - The read-back on the line before is itself pinned to `2026-01-01`, so it is a wiring detector too. Dropping the pin turns 3 tests red in this spec, so the mutation the guard exists to catch is caught.
  - The guard still has independent value against the double mutation (pin dropped and the read-back reverted to the real clock). There, `SELECT usage_date` would return today, not `2026-01-01`, and fail on every day except 2026-01-01. That guard was not run red in isolation in this spec. However, the identical guard in AssistantConversationRoutesSpec did fire on its own (`mutation-3.2.log:251`, `Vector("2026-10-10") was not equal to Vector("2026-01-01")`, line 600). That demonstrates the pattern can fail.
  - This is non-blocking.
- Isolation: ClaudeRoutesChatGate and AssistantConversationRoutes create a fresh user per test (the `newUser`/`newUserWithTier` calls are visible in the diff context). The repository and quota specs call TRUNCATE at the start of each test (`cleanDb()`/`cleanUsage()`), per files-modified.md and the diff context.

**Point 4. Loop proof judged by log.** I grepped all 20 `loop-iter-*.log` files myself. Every iteration shows:
- `Tests: succeeded 43, failed 0`
- exactly one `[hel1468-guard] ScalaTest summary: failed=0 aborted=0`
- zero `*** FAILED` and zero `RUN ABORTED`

`loop-iter-20.log` lists all 4 suites, with `Suites: completed 4, aborted 0`. No iteration ran zero tests. The loop logs cannot be tied to a commit SHA by their content. To close that gap I ran the four specs fresh on HEAD e276b46 with a clean worktree, using `nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false testOnly <4 specs>`:
- `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
- `Suites: completed 4, aborted 0`
- `Tests: succeeded 43, failed 0`

This was 43 real tests, not a cached no-op. The sbt process exited when the batch finished.

**Full suite (evaluator's pasted log, read by me).** `evaluator-cycle1/testFull.log:69467-69471` shows `hel1468-guard failed=0 aborted=0`, `Suites: completed 478, aborted 0`, and `Tests: succeeded 6571, failed 0, canceled 4`.

**Mtime evidence.** No conclusion here relies on mtime ordering. The probe REDs rest on the printed instants and row dumps inside each log, and on line-number arithmetic against the base file.

### Verdict: CONFIRM

### Non-blocking notes
- ClaudeRoutesChatGateSpec:250's `usage_date` guard sits after the pinned read-back on line 247. That read-back already catches a dropped pin, so the guard only adds coverage for the double mutation. It could be moved above line 247 so it is the first assertion to fire. This is cosmetic.
- `PinnedDayClock`/`pinnedDate` are duplicated across four specs, consistent with the per-spec private-clock convention (D3). A shared test helper would be a scope widening and is not requested.
