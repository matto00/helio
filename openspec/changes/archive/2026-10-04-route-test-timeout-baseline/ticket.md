# HEL-1228: Flaky 1s RouteTest timeouts in backend specs under load (FirstRunRoutesSpec, ApiRoutesPipelineRunGuardSpec)

## Description

"Request was neither completed nor rejected within 1 second" (Pekko RouteTest's default `RouteTestTimeout`)
fails backend route specs under load. Observed while delivering HEL-1226 (docs/config-only diff, not caused by it):

* ApiRoutesPipelineRunGuardSpec "rejects the (limit+1)th test with 429" (local repeat run under load; passes 4/4 in isolation)
* FirstRunRoutesSpec "should build a dashboard with rendered rows for a free-tier user and make ZERO Claude calls"
  (PR #725 CI backend job, run 36919604393; 5107 succeeded, 1 failed)

HEL-1225 is the most frequent instance (FirstRunRoutesSpec first, cold request applies AND runs a pipeline and races
the 1s default; the spec sets no `RouteTestTimeout`). HEL-1225 is to be closed as a duplicate of this ticket.

Suggested direction (ticket): raise the RouteTest timeout (implicit RouteTestTimeout) for embedded-postgres-backed route
specs, or investigate why requests stall past 1s in CI. Related: CONTRIBUTING.md embedded-postgres test group guidance.

## Owner/driver direction for this run (claims; decided in design)

- Do not just raise the timeout in four specs. Every route spec doing real DB or pipeline work through `Route` testing
  gets one shared, explicit, generous `RouteTestTimeout` through a common base trait or fixture, so new specs inherit it.
- Investigate whether one cause stalls the first request (cold Slick/Hikari init, Flyway, first pipeline run). If a
  cheap warm-up removes the stall, prefer it and say so.
- The timeout guards test-harness latency and must not hide real performance regressions. Specs that assert latency are
  left alone.
- Driver-reported instances (claims): FirstRunRoutesSpec (many), ExistenceNotLeakedRoutesSpec (4 in one evaluator run),
  ApiRoutesPipelineRunGuardSpec, AssistantTelemetrySpec.

## Acceptance Criteria

1. Every backend spec that mixes in Pekko's route testkit does so through ONE shared base trait that supplies an
   explicit, generous, documented `RouteTestTimeout`; new specs inherit it, and a mechanical guard fails if a spec mixes
   in the testkit directly.
2. FirstRunRoutesSpec, ExistenceNotLeakedRoutesSpec, ApiRoutesPipelineRunGuardSpec and AssistantTelemetrySpec are covered.
3. The first-request stall is probed (cold init vs. load); if a cheap warm-up removes it, it is adopted and documented.
4. Specs that assert latency keep their own explicit bounds; the shared timeout does not change any latency assertion.
5. Proof: red reproduced locally (under bounded CPU contention, `nice -n 19`, <=3 workers, killed by exact PID, and/or a
   lowered-timeout mutation) and green under the same conditions, with the proof's limits stated honestly.
6. `nice -n 19 sbt testFull` passes. No migration.
