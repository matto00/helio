## Context

Three CI-only e2e failures. Main is 07a118001; none of the three spec files changed since the failing head
f1ceb2f3c. HEL-1804 (787a283e9) is an ancestor of f1ceb2f3c, so the hel1791 failure is on current code (its line 290
is HEL-1804's own test). CI runners are slower than this desktop (HEL-1789 runner record: `cpu_model:` in each e2e job
log). Earlier timing flakes reproduced locally with CDP `Emulation.setCPUThrottlingRate` 4-6x (HEL-1808, HEL-1813) or
an injected ~450-500 ms main-thread stall (HEL-1814); HEL-1812 found an uncontrolled scheduler-tick auto-run racing a
test.

Failure evidence to collect first, per test: the failing job id(s), `gh run view --job <id> --log-failed`, the trace /
report artifacts (`gh run download`), the failing assertion message and line, and the runner CPU.

- **T1** `hel1791-compact-counter-stack-height.spec.ts:290`, run 44998353027, job `e2e (4)`.
- **T2** `hel1582-mobile-pipeline-motion-and-states.spec.ts:244`, run 44998353027, job `e2e (7)` rerun (attempt 2).
- **T3** `hel1572-appearance-preferences.spec.ts:126`, PR #1222 earlier head and PR #1223 older head (find the runs
  with `gh run list --branch <dependabot branch>` / `gh pr checks`; pull both failures).

## Hypotheses (claims to settle by probe, NOT assumed)

- **T1.** H1a: the status region's "The row was added." is transient (cleared on a timer or by a refetch re-render),
  so on a slow host the text is gone, or replaced, before `verify` reads it; or the alert text comes from the first
  (still in-flight) submit, not the routed 400. H1b: a re-render replaces the region element, so the captured
  `elementHandle` is detached (`same element still attached` fails) -- that would be an app regression of HEL-1804's
  "same always-mounted region" contract and must be escalated, not patched. H1c: the geometry read races a layout
  change (counter value re-render) between the text assertion and `getBoundingClientRect`.
- **T2.** H2a: `waitForFunction(every animation not running)` never settles because an infinite / repeating animation
  (skeleton shimmer, spinner, pulse) is running on a slow host, so the 300 s test timeout hits. H2b: the 8 s
  `waitForTimeout` per theme plus two sheet opens and the hit-area bisection exceed 300 s on a slow runner (a test
  timeout with no assertion failure). H2c: a scheduler-tick auto-run / refetch (HEL-1812 class) re-renders the panel
  mid-check. H2d: a geometry/hit-test check reads during the panel's open animation or the sheet's.
- **T3.** H3a: a one-shot `fontFamily` read (not retried) runs before the style's stylesheet / font swap applies on a
  slow host. H3b: the Mono then Serif preference saves race on the server (two writes, out-of-order arrival,
  last-arrival wins), so `/api/auth/me` polls `mono`; that is an APP bug (out-of-order preference writes) and must be
  escalated, not hidden by the test. H3c: the new-device context reads before the profile fetch applies the style.

## Goals / Non-Goals

**Goals:** a probe-confirmed root cause per test, stated with evidence; a fix that keeps the assertion's meaning;
20/20 local passes per spec file (2 workers, `nice -n 19`), including under the stress that reproduced it; each test
red under a mutation of the behaviour it guards.

**Non-Goals:** app changes; other specs; HEL-1615/HEL-1624 files; CI config.

## Decisions

1. **Probe first (systematic-debugging law).** Per test: read the CI failure, then reproduce locally (repeat runs,
   then CDP CPU throttling 4x/6x on the page, then an injected main-thread stall), instrumenting to discriminate the
   hypotheses above (e.g. a MutationObserver on the live region recording text/element replacement with timestamps
   for T1; `document.getAnimations()` names/iterations at timeout for T2; request start/finish order of the
   preference PATCHes and the server's stored value for T3). The red run (or the probe output) is committed as `.txt`
   before any fix (C12). Probe code that is not part of the fix is committed as `.txt` too, not as a live spec.
2. **Fix rules.** Allowed: bounded waits with explicit messages on the real precondition (a configured or computed
   value, a request's response, a region's text), `expect.poll`/web-first assertions instead of one-shot reads,
   pausing/finishing animations only when the assertion is not about the animation, routing/holding a request the
   test does not own, disabling an uncontrolled background trigger the test does not exercise. Not allowed: removing
   or loosening an assertion, widening a tolerance without a measured reason, adding retries, raising a timeout as the
   fix (a timeout raise is acceptable only alongside a proven, measured cost and never as the root-cause fix),
   `test.fixme`/`skip`.
3. **App-side cause.** If the probe shows the defect is in app code (e.g. H1b, H3b), stop for that test: do not edit
   app code; write the evidence to the change dir and to `.concertino/runs/HEL-1826/evidence/`, report it to the
   orchestrator as a follow-up candidate, and recommend the test (by title) for the lane flake list. The test is left
   unmodified unless a test-only change is still correct independent of the app fix.
4. **Unreproducible.** After the debug budget (2 attempts per symptom) without a reproduction, state the root cause
   as unconfirmed with what was tried and the CI evidence, and recommend the flake list. Never ship a guessed fix as
   confirmed.
5. **Evidence per fixed test** (in the change dir, `.txt`): CI failure excerpt, red run, root-cause write-up
   (`root-cause.md`), mutation run (red AT the guarding assertion, with the mutation diff), 20x green under 2 workers
   and `nice -n 19` (split into batches under the 600 s tool timeout), and 20x green under the reproducing stress.
   Full spec files are run (C12), not grep-filtered single tests, for the 20x and for one final pass.
6. **Environment.** Lane DB `helio_hel1826` (`createdb`), backend/frontend via `scripts/concertino/start-servers.sh`
   on this run's ports with `ANTHROPIC_API_KEY` exported empty and `DATABASE_URL`
   (`jdbc:postgresql://localhost:5432/helio_hel1826`, `DB_USER=matt`) set for servers, Playwright and cleanup. All
   scratch in the main checkout's `.concertino/scratch/HEL-1826/`. See `driver-constraints.md` (binding).

## Risks

- Only one of two CI failures for T3 may be retrievable (old dependabot heads); use what exists, say what is missing.
- A local desktop may never reproduce a runner-speed race; Decision 4 covers that.
