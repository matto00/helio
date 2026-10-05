## Context

See proposal.md (Why). Ground truth gathered at Planning (premise-validation evidence, HEL-1228 run dir):
- `grep -rn "ScalatestRouteTest" backend/src/test/scala` -> 113 `with ScalatestRouteTest` mixins (route specs,
  service specs that use the testkit only for its ActorSystem/materializer, and shared fixtures such as
  `FirstRunRoutesFixture`, `ApplyProposalSpecBase`). `com.helio.testkit` holds only `TempDirectorySupport`; there is
  no common base. Only `PublicRouteOwnerIdLeakSpec` declares `RouteTestTimeout` (15s, local `private implicit val`).
- Pekko's default is `RouteTestTimeout.default = RouteTestTimeout(1.second.dilated)`, resolved from the companion's
  implicit scope, so any implicit `RouteTestTimeout` in lexical scope (including an inherited member) wins.
- `build.sbt` (HEL-924/HEL-1018) already caps concurrent forked groups at 4 and pins `testForkedParallel := false`;
  its comment names this exact message as the HEL-924 contention symptom. Test JVM working directory is `backend/`.
- CI: in all 19 failing attempts the ONLY failure is FirstRunRoutesSpec's FIRST test (applies AND runs a pipeline
  through the in-process engine - no Spark). Its second test does the same build and never failed. That pattern
  points at a first-request one-time cost (class loading/JIT of the pipeline+first-run path, first pool use) on top
  of CI's small runner, not only generic load. Other named specs are local-only reports (unverified in CI logs).
- Latency-asserting specs (e.g. `DatasetWriteSubmitLatencySpec`, deadline loops in `ApiTokenAuthSpec`,
  `AuditMutationInstrumentationSpec`, `GoogleOAuthRoutesSpec`) measure with `System.nanoTime`/`currentTimeMillis`
  and never read `RouteTestTimeout`.

## Goals / Non-Goals

**Goals:** one explicit harness timeout every route-testkit spec inherits; a guard that keeps it inherited; an honest
probe of the first-request stall; red/green proof under bounded contention.
**Non-Goals:** production code; `build.sbt` grouping; any latency bound; dilating other testkit timeouts.

## Decisions

**D1 - A base trait `com.helio.testkit.HelioRouteTest`** (`backend/src/test/scala/com/helio/testkit/`),
`trait HelioRouteTest extends ScalatestRouteTest { this: Suite => implicit def routeTestTimeout: RouteTestTimeout }`,
returning a constant from its companion. An inherited implicit member beats the companion default; a spec that
genuinely needs a different bound overrides `routeTestTimeout` (Scala 2.13: a definition in a subclass is more
specific than an inherited one, so an override never goes ambiguous). Alternatives rejected: (a) per-spec implicits in
the four named specs - the class recurs in any spec doing DB work and new specs would not inherit it; (b) a test
`application.conf` raising `pekko.test.timefactor` - it silently dilates EVERY pekko-testkit timeout (probes,
`within`, `awaitAssert`), is not explicit at the use site, and `application.conf` resources merge with main's.

**D2 - Value: 15 seconds, fixed (not dilated).** Precedent: `PublicRouteOwnerIdLeakSpec` already uses 15s; fixtures'
own `Await` bound is 30s. A passing request returns as soon as its response is ready, so a generous bound costs
nothing on green; it only lengthens how long a truly hung request takes to fail. Constraint: the executor measures the
worst first-request latency of FirstRunRoutesSpec under the proof load (D5); 15s must give >= 5x headroom over it. If
it does not, STOP and escalate - a request that slow is a performance question, not harness latency.

**D3 - Migrate all 113 mixins, not just "route specs doing DB work".** Classifying which specs do "real DB or
pipeline work" is a hand-picked list (MISTAKES.md: a hand-picked input set is not mechanical) and goes stale the day a
spec adds a DB call. The timeout is inert for specs that never issue a `Route` request. Mechanical edit per file:
the `ScalatestRouteTest` import becomes `com.helio.testkit.HelioRouteTest` (keep any other selector such as
`RouteTestTimeout` that is still used), and `with ScalatestRouteTest` becomes `with HelioRouteTest`. The file list is
produced by grep and recorded as evidence. `PublicRouteOwnerIdLeakSpec` drops its now-identical local 15s implicit.

**D4 - Guard: `com.helio.testkit.RouteTestBaseGuardSpec`** (ScalaTest, runs in `sbt testFull` and CI). Walks
`src/test/scala` from the test JVM's working directory, matches `\b(with|extends)\s+(ScalatestRouteTest|RouteTest)\b` (and `new ScalatestRouteTest`) in every
`.scala` file except `HelioRouteTest.scala`, and fails listing offenders. Non-vacuity: it also asserts the scan root
exists, that it scanned > 100 files, and that `HelioRouteTest.scala` itself was found and matched - so a wrong cwd or
an emptied scan fails loudly instead of passing. A false positive from a comment is accepted (fail-closed).

**D5 - Probe before deciding on a warm-up.** Temporarily (never committed) time FirstRunRoutesSpec's first and
second build requests with `System.nanoTime`, idle and under the proof load. Adopt a warm-up ONLY if: the first
request is >= 3x the second in both conditions, a warm-up placed in `FirstRunRoutesFixture.beforeAll` (e.g. one
throwaway build for a fixture-owned user/source) brings the first measured request within 1.5x of the second, and it
is <= ~15 lines with no effect on any assertion (`claudeCalls`/counts are already read as before/after deltas;
verify). Otherwise do not add one, and record the measurements and why. The timeout (D1/D2) ships either way: the
warm-up removes one cause in one spec; the timeout covers the class.

**D6 - Proof under bounded contention.** Load: exactly 3 CPU burners, each `nice -n 19`, PIDs recorded at launch and
killed by exact PID afterwards (verify gone with `ps -p`). Tests: `nice -n 19 sbt` with Bash timeout 600000, targeted
`testOnly` of FirstRunRoutesSpec, ExistenceNotLeakedRoutesSpec, ApiRoutesPipelineRunGuardSpec, AssistantTelemetrySpec.
- Red A (pre-fix baseline): unmodified main test code under load, 5 runs; count 1s-timeout failures. May be 0 - say so.
- Red B (mutation of the shipped mechanism): set `HelioRouteTest`'s constant below the measured first-request latency
  (e.g. 200ms) -> FirstRunRoutesSpec fails with "neither completed nor rejected within"; restore. Proves the trait's
  value is what bounds that request (not some other path).
- Red C (guard): revert one migrated spec to a direct `ScalatestRouteTest` mixin -> guard fails naming it; restore.
- Green: fixed code, same load, same 5 runs, 0 harness timeouts; then a full `nice -n 19 sbt testFull`.
Limits to report: local hardware (6c/12t) is not CI's runner; Red A may not reproduce; green under local load does
not prove CI is flake-free - it proves the timeout is the binding constraint and 15s has measured headroom.

## Risks / Trade-offs

- [A hung request takes 15s to fail instead of 1s] -> only on an already-failing test; acceptable.
- [A real slowdown hides under 15s] -> the harness timeout was never a perf gate; latency specs keep their own bounds
  (verified unchanged in the diff), and D2's 5x-headroom rule escalates if first-request latency is itself alarming.
- [Mechanical edit of 113 files breaks an import] -> compile + full `testFull`; diff is mixin/import lines only.
- [Implicit ambiguity in a spec] -> grep shows no other `RouteTestTimeout` implicit besides the one removed.

## Migration Plan

Test-only change; rollback is a revert. No migration, no prod touch, no shared dev DB writes (all named specs use
embedded Postgres).

## Planner Notes

- Self-approved: migrating all 113 mixins (D3) rather than a hand-classified subset; fixed 15s over a dilated value.
- Driver-reported instances ExistenceNotLeakedRoutesSpec / AssistantTelemetrySpec are not in any CI log; covered by D3
  regardless, and exercised by D6's targeted runs.
