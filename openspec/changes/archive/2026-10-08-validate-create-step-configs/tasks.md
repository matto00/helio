## Standing Constraints

- [C1] Backend tests via sbt testFull/testOnly only, never bare sbt test
- [C2] Never pkill/pgrep/killall; never --no-verify/HUSKY=0 without disclosure; no writes under ~ outside the worktree; cap 3-4 workers, nice -n 19
- [C3] Red-first per newly validated write path: a test that fails on base and passes after, proven by mutation/revert
- [C4] helio-news is READ-ONLY; its exact step configs must be proven accepted by a spec, never assumed
- [C5] Dev DB residue recorded by exact id; never use matt@helio.dev; shared Playwright browser — log in fresh
- [C6] An existing test fixture that starts failing because its config is now rejected is a question (fixture wrong vs code wrong), never a silent fixture edit; justify each in evidence

## 1. Enumerate and pin

- [x] 1.1 Re-verify the write-path table in proposal.md against the tree (grep every caller of `pipelineService.create`,
      `addStep*`, `updateStep`, `insertInternal*`, `spliceInsert*`, `attachTail*`); record any path the table missed.
- [x] 1.2 Re-grep `/home/matt/Development/helio-news` (read-only) for every step config it sends; list them.

## 2. Red tests (must fail before the fix — record the failing output)

- [x] 2.1 Single-call `POST /api/pipelines` with a `compute` step calling an unknown function → expect 422 naming the
      step clientId, the function and the supported list; expect no pipeline persisted (route-level spec).
- [x] 2.2 Same for a wrong-shape `cast` (`casts` array) and an unsupported aggregate `fn` (non-compute kinds).
- [x] 2.3 Patch-set apply containing a pipeline-create edit with an unknown-function compute step → HTTP 422 at resolve
      time (message `edit N: Step '<clientId>': ...`), no pipeline created, no earlier edit applied; and
      `/api/patch-sets/preview` of the same patch set → 422. (Red on base: 200 with `failure` set, or success.)
- [x] 2.4 Regression pin (NOT red-first — already rejected by `validateSteps`): proposal apply with an unknown-function
      compute step → 422, nothing persisted.

## 3. Fix

- [x] 3.1 In `PipelineService.buildStepsAction`, after the type check and before decode, call
      `PipelineStep.companionFor(spec.type).toOption.flatMap(_.validateRawConfig(spec.config.compactPrint))`; on
      `Some(msg)` fail with `PipelineCreateValidationFailure(ServiceError.UnprocessableEntity(s"Step '${spec.clientId}': $msg"))`.
- [x] 3.1a In `PatchSetApplyResolvers.resolvePipelineCreate`, after the roots pre-check, run the same check over the
      request's steps (registered kinds only) → `Left(ServiceError.UnprocessableEntity(s"edit $index: Step '<clientId>': $msg"))`.
- [x] 3.2 Confirm 2.1–2.3 now pass; mutation check: revert 3.1 (and separately 3.1a) and confirm the matching tests fail again.

## 4. Non-regression

- [x] 4.1 Spec: helio-news literal configs (design decision 6 + 1.2 findings) → `validateRawConfig` returns `None`.
- [x] 4.2 Non-regression pin: every shape expansion's and `FirstRunPlanner`'s generated step configs pass
      `validateRawConfig`; any failure is a BLOCKER, report it.
- [x] 4.3 Single-call create still succeeds for valid filter/aggregate(object groupBy)/sort/select steps and for an
      empty compute draft.
- [x] 4.4 Legacy: a compute step with an unknown-function expression inserted directly (bypassing the service) still
      lists and analyzes (analyze reports `step-config-invalid`, request succeeds).

## 5. Docs and gates

- [x] 5.1 Update `schemas/`, OpenAPI, `docs/agent-native.md`, `helio-mcp` tool docs only if they enumerate create's
      error statuses; otherwise record "no doc change" with the grep used.
- [x] 5.2 Run backend tests via `sbt testFull` (or targeted `testOnly` + full run), lint/format gates; commit.

## Execution notes (HEL-1402)

- 1.1: callers of `pipelineService.create` are `PipelineRoutes` (REST/MCP) and `PatchSetApplyForward`; proposal apply calls `create` via `PipelineProposalService`; `insertInternalAction` is used only by `buildStepsAction`. No path missed.
- 1.2: helio-news sends filter, aggregate (two shapes), sort, select configs (news/projects/build.py, news/enrichers/series.py, news/enrichers/__init__.py) -- all pinned in `CreateStepConfigNonRegressionSpec`.
- 2.3 base behaviour: patch-set apply with an unknown-function pipeline-create edit returned plain success (Right, pipeline created); preview also returned success. Cast `casts` array on base returned 400 (decode failure), now 422.
- 5.1: no doc change -- schemas/pipelines/create-pipeline*.schema.json, openspec/config.yaml, docs/agent-native.md and helio-mcp do not enumerate create's step-config error statuses (grep: `422|400|status` over those files).
