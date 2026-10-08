# HEL-1402: POST /api/pipelines accepts a compute step with an unknown function (201) that validateRawConfig rejects — error surfaces only later in analyze

## Description

origin_kind: followup
origin_ticket: HEL-1315

Found by HEL-1315's evaluator (pre-existing, verify): the single-call `POST /api/pipelines` accepts a `compute` step
whose expression calls an unknown function and returns 201, but `validateRawConfig` rejects the same config. The user
only finds out later, from analyze. Because HEL-1279 (c26c30567) skips dataset-write auto-run for `step-config-invalid`
pipelines, such a pipeline is now saved but silently never auto-runs.

Scope note (HEL-1310 comment, relayed by the driver): the single-call create (`buildStepsAction`) never calls the
companion `validateRawConfig` for ANY step kind — fix it once there for all kinds, not just compute.

## Acceptance criteria

* Create, and step add/update, reject an invalid compute expression with a 4xx naming the function and the supported
  list (consistent with `validateRawConfig` / analyze), on every write path (single-call create, step routes, proposal
  apply). Red-first per path.
  * Premise correction (premise-validation.md): the ticket text says 400; every write path that already runs
    `validateRawConfig` returns **422** (`pipeline-step-config-rejection`), 400 being reserved for an unparseable
    config. This change uses 422 for consistency with those paths — the AC's own "consistent with" intent.
* The single-call create path runs `validateRawConfig` for every step kind (not only compute), so it can no longer
  accept any config another write surface rejects.
* Legacy stored invalid steps still read and analyze as today (no read-time failure).
* helio-news (`/home/matt/Development/helio-news`, read-only) step configs sent via MCP `create_pipeline` are not
  newly rejected — proven by a spec using their literal configs.
