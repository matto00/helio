## Context

- `AssistantDailyUsageRepository.incrementIfUnderCap` (infrastructure/persistence/assistant) computes
  `val today = LocalDate.now(ZoneOffset.UTC).toString` inline per call and upserts `(user_id, usage_date)` with
  `WHERE message_count < :limit`. There is no clock seam on the repo, on `ChatAccessService`, or on
  `AiPipelineQuotaGate.Live`. Production constructs the repo at `ApiRoutes.scala:437` and `:611`.
- `ClaudeRoutesChatGateSpec` (`usage(f)`, ~l.203) and `AssistantConversationRoutesSpec` (`dailyUsageCount`, ~l.264)
  both assert exact caps ((limit+1)th call -> 429 `CHAT_LIMIT_REACHED`) and read the counter back by recomputing
  `LocalDate.now(ZoneOffset.UTC)` themselves. `AssistantDailyUsageRepositorySpec` (`~l.111`, plus the "yesterday" test
  ~l.170) and `AiPipelineQuotaGateSpec` (`countFor`, ~l.66) share the identical pattern.
- An injectable `com.helio.domain.util.Clock` / `SystemClock` already exists (HEL-415; reused as `guardClock` by
  HEL-1374/1439/1471).
- No libfaketime on this machine; the next real UTC midnight is ~13.5 h from planning time.

## Goals / Non-Goals

**Goals:** a behaviour-preserving clock seam on the repo; pinned clocks in every boundary-sensitive spec; a red-first
probe in which real elapsed time crosses a UTC midnight on the unpinned path; a failable wiring guard; a by-log loop.

**Non-Goals:** production behaviour change; `ApiRoutes` edits; `EmbeddedPostgres` startup lines (HEL-1445);
rate-window guards (HEL-1439/1471).

## Decisions

### D1. Seam: constructor `Clock` on the repository, default `SystemClock`

`class AssistantDailyUsageRepository(ctx: DbContext, clock: Clock = SystemClock)(implicit ec)`, and
`today = LocalDate.ofInstant(clock.now(), ZoneOffset.UTC)`. `LocalDate.now(ZoneOffset.UTC)` is
`LocalDate.ofInstant(Clock.systemUTC().instant(), UTC)`, so with `SystemClock` the value is identical: production
behaviour is unchanged and both `ApiRoutes` call sites stay unchanged (they use the default). Update the repo's doc comment.

Alternatives: (a) an `Instant` parameter on `incrementIfUnderCap` (the `PipelineRunGuardRepository` style) -- rejected,
it forces a clock into both `ChatAccessService` and `AiPipelineQuotaGate.Live` for no production benefit; (b) a clock on
`ChatAccessService` only -- rejected, the day is computed in the repo, so the gate spec would stay unpinned.

### D2. Probe before fix (systematic-debugging law): real elapsed time crosses midnight

Waiting ~13.5 h for a real UTC midnight, or installing libfaketime (a system-path write), are both rejected. The
deciding probe instead uses the D1 seam with a SHIFTED REAL clock -- `Instant.now().plus(offset)` -- which ticks with
the real wall clock (it is `SystemClock` translated in time, exactly libfaketime's "start-at" mode done in-process).
The date arithmetic under test is the unchanged production expression. Procedure (temporary, never committed):
in ONE cap test of each target spec (ClaudeRoutesChatGateSpec "counted on the shared counter and get 429 ... across
both routes"; AssistantConversationRoutesSpec "a beta-tier user under the cap ... gets 429 ... once at the cap"),
construct the repo with the shifted clock aimed so shifted-midnight falls ~1 s after the test starts, and insert a
sleep so the midnight lands strictly between the last admitted call and the call expected to be denied. Log each
call's shifted `Instant` and dump ALL of that user's `assistant_daily_usage` rows. During the probe every usage
read-back in the probed test (e.g. ClaudeRoutesChatGateSpec `usage(f) shouldBe Some(2)`) reads the date from the SAME
shifted clock, so a read-back cannot fail on a probe artifact before the real defect is reached.
- RED counts ONLY if the failing assertion is the call expected to get 429 returning 200/201
  (ClaudeRoutesChatGateSpec ~l.243 / AssistantConversationRoutesSpec ~l.583); any other failing line is a probe
  artifact -> fix the probe and retry within budget.
- RED confirmed when the test fails with the denied call admitted (200/201 instead of 429) AND the dump shows exactly
  two `usage_date` rows one day apart, each `message_count <= limit`. One row only refutes the hypothesis -> stop and
  escalate. Budget: at most 6 aimed attempts, then escalate with transcripts.
- Disclosure (state it in the report): the crossing is real elapsed time through the production date expression, but
  the epoch is shifted via the new seam, not the OS clock. A pure clock-JUMP fake (no real ticking) is illustration only
  and does not confirm the cause.

### D3. Fix: pin a mid-day instant in each boundary-sensitive spec

Each spec gets a private pinned clock, e.g. `private object PinnedDayClock extends Clock { def now() =
Instant.parse("2026-01-01T12:00:00Z") }` (mirroring the per-spec private `FakeClock` convention; no shared helper --
scope widening), passes it to every `AssistantDailyUsageRepository` it builds, and its read-back helper queries the
pinned date (derived from the same clock, not `LocalDate.now`). EVERY today/yesterday in a pinned
spec comes from the pinned clock -- including `AssistantDailyUsageRepositorySpec`'s read-back helper (~l.111), the
"yesterday" test (~l.172, seeds `pinnedDate.minusDays(1)`) and the inline reads in its RLS tests (~l.196, ~l.210,
~l.221; l.196's `rows shouldBe empty` would otherwise go vacuously green across a midnight). Acceptance: `grep -n
'LocalDate.now' ` across the four pinned specs returns zero hits, output pasted into files-modified.md. A pinned instant shared across tests is safe only if no two tests share a user's usage row
-- confirm per spec (fresh users or `TRUNCATE` between tests) and record it.

**Wiring guard (failable):** in each target spec, one cap test asserts the stored `usage_date` equals the pinned date
(2026-01-01). On `SystemClock` that fails on every day except 2026-01-01, so dropping the pin is caught at once.
Prove it by mutation: temporarily construct the repo without the clock, observe red, revert.

### D4. Sweep

Enumerate every `new AssistantDailyUsageRepository(` in `backend/src/test` (planning found: ClaudeRoutesChatGateSpec,
AssistantConversationRoutesSpec, AssistantDailyUsageRepositorySpec, AiPipelineQuotaGateSpec, RefinementRoutesSpec,
DashboardAuthoringRoutesSpec, AuthoringTelemetrySpec, AssistantTelemetrySpec). Classify each boundary-sensitive or not
with the reason (e.g. every fixture user is owner tier, so `incrementIfUnderCap` is never called -- verify per spec).
Pin only the sensitive ones with the D3 pattern; list all with reasons in files-modified.md.

### D5. Red / green / loop evidence

- RED: D2 transcript. GREEN: fixed specs pass; D3 mutation transcript (guard red without the pin).
- LOOP: 20 iterations of the changed specs, `nice -n 19`, `-J-Xmx3g`, `-batch -Dsbt.server.autostart=false`, one sbt
  JVM at a time; each iteration judged green by LOG (expected `Tests: succeeded N, failed 0`, no `*** FAILED`,
  no `RUN ABORTED`) and the `[hel1468-guard] ScalaTest summary: failed=0 aborted=0` line present; never by exit code.
  Beware sbt 2 caching a repeat `testOnly` into a zero-test no-op (MISTAKES.md): an iteration that ran 0 tests is not
  green. Save transcripts under the run evidence dir, not /tmp.

## Risks / Trade-offs

- [Aiming a sub-second crossing is timing-fiddly] -> log shifted instants; 6-attempt cap, then escalate.
- [Pinned instant shared across tests] -> confirm per-spec isolation (D3).
- [Concurrent lanes HEL-1435/1436] -> disjoint files; no `ApiRoutes` edit keeps the overlap surface at zero.

## Planner Notes

- Self-approved: behaviour-preserving seam with a default, test-only otherwise, `skip_specs: true`, no new dependency,
  API or architecture -> no escalation.
- Driver statements were treated as claims; the premise was verified at Setup (premise-validation.md).
