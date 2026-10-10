## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: 222e855c0852376a90dbc77a965c130316588729 (planning artifacts untracked under openspec/changes/pin-chat-cap-day-clock/).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/pin-chat-cap-day-clock/HEL-1473`.
- **Premise re-checked against the code:** `AssistantDailyUsageRepository.scala:31` has `val today = LocalDate.now(ZoneOffset.UTC).toString`. The constructor is `(ctx: DbContext)(implicit ec)`. Production builds the repo only at `ApiRoutes.scala:437` and `:611`. No other main-code path reads `assistant_daily_usage` by date. `com.helio.domain.util.Clock`/`SystemClock` exist with `def now(): Instant`. D1 still holds.
- **CR-1 (every today/yesterday from the pinned clock): addressed in substance.** I grepped `LocalDate|CURRENT_DATE|now()|Instant.now|usage_date` in every test file that constructs the repo. The only real-clock date sources are:
  - ClaudeRoutesChatGateSpec:204
  - AssistantConversationRoutesSpec:265
  - AiPipelineQuotaGateSpec:66
  - AssistantDailyUsageRepositorySpec:111, 172, 197, 208, 221

  The `now()` hits elsewhere are SQL `created_at` on user inserts and are irrelevant to the day bucket. D3 now names l.111, l.172 (seeded as `pinnedDate.minusDays(1)`) and the three RLS sites (~l.196/210/221), including why l.196 would turn vacuously green. Standing constraint C4 and task 3.3a add the zero-hit `grep -n LocalDate.now` check over the four pinned specs, with its output pasted into files-modified.md. That check covers every site above, because each one is a literal `LocalDate.now(...)`. RlsPolicyGuardSpec mentions `assistant_daily_usage` only in its table-policy map (l.125), with no date, so it is correctly out of scope.
- **CR-2 (probe read-backs and the RED criterion): addressed.**
  - D2 now requires every usage read-back in the probed test to use the same shifted clock, and the dump to cover ALL of that user's rows.
  - D2 also states that RED counts ONLY when the expected-429 call returns 200/201. The cited lines are correct: ClaudeRoutesChatGateSpec l.243 is the third Post with `expectTier(... TooManyRequests, Some(2))`, and AssistantConversationRoutesSpec l.583 is `status shouldBe StatusCodes.TooManyRequests`. Any other failing line is classed as a probe artifact, to be fixed and retried within the 6-attempt budget.
  - The RED condition also requires two `usage_date` rows one day apart. One row refutes the hypothesis and leads to an escalation.
  - Task 2.1 repeats these points. This is a real fix, not a rewording.
- **Loop evidence hook exists:** `backend/project/ScalaTestSummaryGuard.scala:78` emits `[hel1468-guard] ScalaTest summary: failed=... aborted=...`, which is the line D5/3.5 require.
- **AC trace:**
  - AC1 (verify the time source): premise section plus D1.
  - AC2 (seam, pin, red-first by a forced midnight crossing): D1/D2/D3, tasks 1.1/2.x/3.x.
  - AC3 (loop judged by log with the guard line): D5/3.5.
  - Driver constraints: SystemClock is the default and `ApiRoutes` is not edited (C3). No EmbeddedPostgres line is touched (C2).
- **Contradictions and placeholders:** none found. There are no TODO/TBD entries. The proposal, design and tasks agree on scope (four pinned specs, four classified as non-sensitive). No API, schema or spec delta is needed, and `skip_specs: true` is consistent with that.

### Verdict: CONFIRM

### Non-blocking notes

- In ClaudeRoutesChatGateSpec's probed test, the `usage(f) shouldBe Some(2)` read-back at l.242 sits between the last admitted call and the denied call. Reading at shifted "now" only avoids a probe artifact if the sleep (the midnight) falls after l.242 and before the l.243 Post. If the midnight falls before l.242, the read returns `None`. The RED-only clause classifies that as an artifact, so it cannot be misread as RED, but it would waste an attempt. The executor should place the sleep after l.242.
- D1's phrase "keeps calling the two-argument-less form" is garbled. The intent is clear: `ApiRoutes` keeps `new AssistantDailyUsageRepository(dbContext)` unchanged.
- Carried over from round 1: record the real reason the four non-sensitive specs are excluded (owner-tier-only fixtures, so `incrementIfUnderCap` is never reached). In AssistantConversationRoutesSpec, the wiring guard is a new `usage_date` assertion in the l.572 beta cap test.
