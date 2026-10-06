## Context

See proposal.md - Why. Time sources today (all JVM-side `Instant.now()`, none use DB `now()`):

- `ConnectorCompletionService.mintToken` — `expiresAt = Instant.now().plus(effectiveExpiry)`.
- `ConnectorCompletionService.resolveValidToken` — `token.isValid(Instant.now())` (in-memory check, used by `complete`
  and `describePending`).
- `ConnectorCompletionTokenRepository.mintSupersedingPrior` (`supersededAt`/`createdAt`), `consume` (the atomic
  predicate `expires_at > now`, and `consumedAt`), `findLiveByConnector`.

The three latency-sensitive tests in `ConnectorCompletionServiceSpec` (all build a `shortLivedService` with
`defaultExpiry = Duration.ofMillis(50)`):

1. "consume() itself refuses a token that expired AFTER being read as live" — asserts `isValid(Instant.now())` is
   TRUE after mint + `findByHash` (two DB round trips inside 50 ms), then sleeps 100 ms.
2. "refuse an expired token, then a re-mint ... succeeds" (the one HEL-1287 saw fail) — re-mints with 50 ms expiry and
   then asserts `complete` SUCCEEDS (findByHash + findByIdUnscoped + encrypt + consume inside 50 ms).
3. "owner re-mint also recovers an expired pending Connector" — same shape as 2.

Hypothesis (unconfirmed until the probe): under contention, the "must still be live" leg exceeds 50 ms of wall clock,
so the token is already expired and the test sees `RefusalError`/`false`. The "must be expired" legs only get safer
under load.

The repo already has `com.helio.domain.util.Clock` / `SystemClock` (HEL-415) and a per-spec `private class FakeClock`
convention (e.g. `OutputHistoryRetentionServiceSpec`, `PipelineSchedulerServiceSpec`).

## Goals / Non-Goals

**Goals:** a deterministic spec whose verdict does not depend on wall-clock latency; production behaviour unchanged;
expiry still genuinely exercised end-to-end through the real `consume` SQL predicate.

**Non-Goals:** see proposal.md - Non-goals. No change to expiry semantics, defaults, or ceiling.

## Decisions

**D0 — Probe before fix (gate on the hypothesis).** Before editing product or test code, the executor reproduces the
flake under a contended setup within the hardware cap (≤3 concurrent forks or ≤3 `nice -n 19` background load
processes, ≤4 workers total, load PIDs recorded and killed by PID) and records: run count, failure count, and the exact
failing test + assertion + message for every failure. It also runs a deterministic mechanism probe on a scratch
(uncommitted, reverted) edit: insert a delay longer than 50 ms between the re-mint and the `complete` in test 2 and
show it fails with exactly the observed assertion. If the contended repro shows failures in a different test or
assertion, or the probe contradicts the hypothesis, STOP and return an ESCALATION with the evidence — do not proceed
to D1. If contention cannot reproduce any failure in a reasonable budget (record attempts), the deterministic probe
still pins the mechanism; record both honestly.

**D1 — Inject the existing `Clock`, defaulted.** Add `clock: Clock = SystemClock` to `ConnectorCompletionService`
(after `maxExpiry`) and to `ConnectorCompletionTokenRepository` (second param list stays `implicit ec`). Replace every
`Instant.now()` in both classes with `clock.now()`. Defaults keep `ApiRoutes` and `SourceServiceSpec` source-compatible
and keep production on the real wall clock. Alternatives rejected: lengthening the window (forbidden by the ticket;
only moves the threshold); "wait on state" polling (there is no state change to wait for — the defect is that the
*live* leg must finish before a wall-clock deadline); DB `now()` (changes where time comes from in production, out of
scope); `java.time.Clock` (a second clock abstraction alongside the repo's own).

**D2 — Service and repository share one fake clock per test.** The `consume` predicate's `now` must come from the
same clock as `mintToken`'s `expiresAt`, otherwise a fake-clock expiry is invisible to SQL. Each of the three tests
builds its own `FakeClock` (private, `@volatile`, `advance(Duration)`; following the repo convention), its own
`ConnectorCompletionTokenRepository(ctx, clock)` and its own service over it, starting at real `Instant.now()` so
rows are realistic. Expiry is crossed by `clock.advance(...)` past the configured expiry (the 50 ms value may stay or
become any duration; it no longer matters to timing). No `Thread.sleep` remains in these tests. Other tests keep the
shared real-clock fixtures.

**D3 — Same assertions, plus a latency-insensitivity proof.** Every existing assertion in the three tests is kept
(live-then-expired, refusal is byte-identical `RefusalError`, connector still pending, re-mint same connector, new
token completes, old token stays refused). Proofs the executor must record (scratch edits, reverted):

- Latency-insensitivity: insert a ≥500 ms `Thread.sleep` in each fixed test's "must still be live" leg — still green.
- Clock threading: make `consume` use `Instant.now()` instead of `clock.now()` — test 1 goes red (the SQL predicate
  must observe the fake clock). Make `resolveValidToken` ignore the clock — at least one test goes red.
- Expiry predicate: delete `&& r.expiresAt > now` from `consume` — test 1 goes red (existing mutation guarantee kept).

**D4 — Product-bug branch.** If D0 shows a product defect (not the test's 50 ms window), fix the product, add a test
red without the fix, and if it alters security semantics (token validity, consume predicate, refusal shape) return an
ESCALATION instead of deciding.

**D5 — Evidence and recommendation.** After the fix, run the same contended setup ≥20 consecutive times; each run
must show the spec's test count actually executed (sbt 2 caching can make a repeat a silent no-op — see MISTAKES.md),
0 failures. Then `nice -n 19 sbt testFull` once, green. Record everything in
`openspec/changes/connector-completion-injected-clock/probe.md`, ending with a 3-fork recommendation that states what
the evidence does and does not cover (local contention is a proxy for CI runners; other specs were not swept).

## Risks / Trade-offs

- [Fake clock hides a real wall-clock bug] → expiry still flows through the real SQL predicate with real persisted
  timestamps; only "now" is controlled. Mutation proofs in D3 show the predicate is still exercised.
- [Local contention doesn't reproduce] → deterministic mechanism probe (D0) pins the mechanism; recommendation states
  the limitation.
- [Constructor default silently left unwired in prod] → default is `SystemClock`, identical to today's `Instant.now()`.

## Planner Notes

- Self-approved: injecting the existing `Clock` (no new dependency, no API change); updating the MISTAKES.md CI note
  that names this flake, to reflect the fix while leaving the fork setting as a separate decision.
