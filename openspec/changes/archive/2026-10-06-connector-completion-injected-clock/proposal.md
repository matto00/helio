## Why

`ConnectorCompletionServiceSpec` flaked once in HEL-1287 at 3 forked test groups per leg ("refuse an expired token,
then a re-mint ... succeeds", per that change's `profile.md`), so CI was held at 2 forks. Three of its tests mint
completion tokens with a real 50 ms expiry and then assert the token is still live after several DB round trips; under
CPU contention those round trips can take longer than 50 ms. A flaky security-path spec either blocks CI speed-ups or
trains people to re-run red builds.

## What Changes

- Probe-confirm the root cause under contention and record the failure rate before any fix (systematic-debugging law).
- Make the completion-token expiry decisions in `ConnectorCompletionService` and
  `ConnectorCompletionTokenRepository` read time from the existing injectable `com.helio.domain.util.Clock`
  (production default `SystemClock`, so production behaviour is unchanged).
- Rewrite the three 50 ms tests to drive expiry with a fake clock (advance past expiry explicitly) instead of
  `Thread.sleep` against a 50 ms wall-clock window. No window is lengthened; no assertion is weakened or removed.
- Record ≥20 consecutive green runs under the same contended setup, and a recommendation on 3 forks per leg.
- Update the `MISTAKES.md` CI note that cites this flake.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — no spec-level behaviour changes (`skip_specs: true`). Token expiry semantics (consume predicate, in-memory
validity check, 60 min default, 24 h ceiling) are unchanged; only the source of "now" becomes injectable.

## Non-goals

- Changing `HEL924_TEST_GROUP_CONCURRENCY` or anything in `.github/workflows/ci.yml` (separate decision).
- Touching `frontend/playwright.config.ts` or `.gitignore`.
- Fixing other timing-sensitive specs (noted as follow-ups if found, not fixed here).
- Moving expiry comparisons to database `now()`.

## Impact

- `backend/src/main/scala/com/helio/services/sources/ConnectorCompletionService.scala` (constructor gains a defaulted
  `clock` parameter).
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorCompletionTokenRepository.scala`
  (same).
- `backend/src/test/scala/com/helio/services/sources/ConnectorCompletionServiceSpec.scala`.
- `MISTAKES.md` (one note). No API, schema, migration or frontend change. Call sites in `ApiRoutes` and
  `SourceServiceSpec` keep compiling unchanged via defaults.
