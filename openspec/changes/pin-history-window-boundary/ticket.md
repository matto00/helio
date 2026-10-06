# HEL-1290: History delta API: pin behaviour for a point exactly at latest − window

## Description

origin_kind: followup
origin_ticket: HEL-1273

The HEL-1273 delta read API resolves its baseline as the nearest point at or before `latest − window` (D6). No test pins
what happens when a history point's timestamp is exactly `latest − window`.

## Acceptance Criteria

- Add a repository-level and a route-level test where a point sits exactly on the boundary, and assert that it is
  selected as the baseline (the "at or before" semantics).
- The test must go red under a mutation that changes `<=` to `<` in the nearest-at-or-before query.

## Driver constraints (HEL-918 batch, 2026-10-06)

- Owner ruling D6 (HEL-918): the baseline is the nearest point at or before the target; none → null + `availableFrom`.
- Both tests must go red under the `<=` → `<` mutation; record the red AND the green.
- If the code is wrong at the boundary (selects `<` today) that is a product bug: red test first, then a minimal fix.
  (Premise check: the query is `<=` today — `OutputHistoryRepository.nearestAtOrBefore` — so no fix is expected.)
- Boundary must be exact at microsecond precision (Postgres `timestamptz` is microseconds; a JVM `Instant` can carry
  nanoseconds); state how.
- Test-only change (HEL-1326 is parked and will touch history schemas / `NodeSnapshotRepository`). Do not touch
  `ci.yml`, `playwright.config.ts`, `.gitignore`. New route specs extend `com.helio.testkit.HelioRouteTest`.
- EmbeddedPostgres only; never the owner's `matt@helio.dev` account.
