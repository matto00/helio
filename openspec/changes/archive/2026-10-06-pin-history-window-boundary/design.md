## Context

`OutputHistoryService.resolveBaseline` handles a window `w` by calling
`OutputHistoryRepository.nearestAtOrBefore(id, head.capturedAt.minus(w))`. The query
(`OutputHistoryRepository.scala:89-92`) filters `r.capturedAt <= at`, then orders by `(capturedAt desc, id desc)` and
takes 1. Coverage today:

- `OutputHistoryRepositorySpec` "nearestAtOrBefore ... including exactly-at" calls `nearestAtOrBefore(oid, t2)` with
  whole-second instants. It is not framed as `latest − w` and has never been mutation-recorded.
- `OutputHistoryRoutesSpec` window fixtures put points at T−9d/T−8d/T−6d/T. No point is at T−7d, so the route path has
  no boundary coverage at all.

Postgres `timestamptz` stores microseconds. A JVM `Instant` can carry nanoseconds, and `Instant.now()` on Linux carries
microseconds. If a test instant had a sub-microsecond component, Postgres would round it on write, and the "exact"
boundary would no longer be exact. Depending on the rounding direction, that makes the test vacuous or wrong.

## Goals / Non-Goals

**Goals:** a repository-level test and a route-level test, each with a point exactly at `latest − w` to the
microsecond. Each must assert that the boundary point is selected and must go red under `<=` → `<`.

**Non-Goals:** no production change unless the new tests prove the code wrong at the boundary. Not expected: the
query is `<=`. Also out of scope: public route coverage, thinning semantics, and schema or `NodeSnapshotRepository`
changes.

## Decisions

1. **Microsecond-exact construction, asserted rather than assumed.** Every instant in the new tests derives from a
   base that is truncated with `truncatedTo(ChronoUnit.MICROS)`. The base also gets a deliberate non-millisecond
   microsecond component, so the test exercises microsecond precision rather than just millisecond precision. For
   example, the repo test uses `Instant.parse("2026-03-10T12:00:00.123456Z")`. The route test uses
   `T.minus(1 day).plus(Duration.ofNanos(123_456_000))`, which stays ≥3 days before now so the existing C7
   now-relative kill still holds. The boundary is `latest.minus(Duration.ofDays(7))`, which is exact `Instant`
   arithmetic. Each test asserts two preconditions: `getNano % 1000 == 0` for every seeded instant, and the read-back
   `capturedAt` of the boundary point equals the seeded instant (repo: via `listRecent`; route: the `baseline` wire
   string equals `boundary.toString`). A Postgres rounding or truncation therefore fails loudly instead of silently
   moving the boundary. Alternative rejected: whole-second instants like the existing test. They never exercise the
   precision hazard the driver flagged.

2. **A decoy 1µs before the boundary (plus a point 1µs after).** Points sit at `b − 1µs`, `b`, `b + 1µs` and `latest`,
   each with a distinct headline value on the route test. Under `<` the query returns the `b − 1µs` decoy, a wrong
   but non-null pick, so the red shows the exact semantic failure rather than an incidental `None`. It also proves
   resolution at one-microsecond granularity. The `b + 1µs` point proves the pick is at-or-*before*, not nearest in
   either direction. Alternative rejected: a boundary point alone. Under `<` that makes the baseline null, so the
   test would pass for the wrong reason if a later change, for example a fallback to `earliest`, masked the null.

3. **Placement: extend the two existing specs, with no new spec files.** The new repo test is one new case under
   `"nearestAtOrBefore" should`, expressed as `latest.minus(w)`. The new route test is one new case under the
   existing `"GET /outputs/:id/history -- window baseline ..."` block. `OutputHistoryRoutesSpec` already mixes in
   `com.helio.testkit.HelioRouteTest` and the shared EmbeddedPostgres harness (`OutputHistoryApiHarness`), so the
   binding route-spec rule is met without a new class. The existing whole-second exactly-at assertion stays as is.

4. **Mutation protocol (evidence, never committed).** In the worktree, `sed` changes `r.capturedAt <= at` to
   `r.capturedAt < at` in `OutputHistoryRepository.scala`. Run both specs with `testOnly` and capture the failing
   output, which must name both new tests. Revert with `git checkout -- <file>` and confirm
   `git diff --quiet -- backend/src/main` exits 0. Re-run both specs green, again capturing output. The red and green
   transcripts are saved as `mutation-red.txt` / `mutation-green.txt` in the change directory and persisted with
   `persist-evidence.sh`. sbt 2 can cache test results, so each transcript must show the named tests actually
   executing. A "0 tests" green is not evidence.

5. **Test runs respect the machine cap.** Every sbt invocation is `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt ...`
   with a Bash timeout of 600000. `sbt --client shutdown` runs as its own Bash call afterwards. Any `FirstRunRoutesSpec`
   timeout or "Java heap space" is reported verbatim.

## Risks / Trade-offs

- [The route test's T is wall-clock-relative] → T stays ≥3 days before now (C7), and the boundary is relative to the
  stored newest point, not to now, so the test is deterministic across clock time.
- [`id desc` tiebreak could mask a duplicate-timestamp issue] → every seeded instant in the new tests is distinct.
- [The spec scenario adds wording to a shared capability that HEL-1326 may also touch] → this is a MODIFIED delta of
  the requirement text, and its body is otherwise unchanged. HEL-1326 is parked, and archive merges at delivery time.

## Planner Notes

- Self-approved: the test-only scope, extending the existing specs, and the spec scenario addition.
- Premise: the D6 owner ruling is confirmed, and the query is already `<=`. A mutation red is expected; a product bug
  is not.
