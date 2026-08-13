## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:

- **AC #3 ("Per-step validation errors are surfaced in the response body (not thrown)") is violated
  for a proven-reachable input: a proposal step whose `type` is not a registered
  `PipelineStepKind`.** `schemas/pipeline-proposal.schema.json`'s own step-shape description says
  `type` is "intentionally left unconstrained here (not enumerated) — the backend's step-kind
  registry (`PipelineStepKind.All`) is the authoritative allow-list, checked at apply time, not by
  this schema" — i.e. an unrecognized step `type` string is explicitly a valid, expected wire state
  at dry-analyze time (pre-apply). See Phase 2 for the code-level root cause and file:line. None of
  tasks.md's tests (3.7/3.8/3.10) exercise this case — 3.7 uses a recognized type (`compute`) with a
  bad config; 3.8 tests missing top-level fields, not an unrecognized step type.
- All other ACs verified as implemented and matching design.md/tasks.md:
  - AC #1 (projected schema, nothing persisted) — verified via test 3.2 (asserts row counts unchanged)
    and by reading `PipelineService.analyzeProposal`/`resolveProposalSourceSchema` (no repo writes,
    only reads).
  - AC #2 (reuses `PipelineAnalyzeService` verbatim, no divergent engine) — confirmed: `analyzeProposal`
    calls the unchanged `PipelineAnalyzeService.analyze` and the pre-existing
    `PipelineService.toAnalyzeStepResponse` as-is.
  - AC #4 (inline SQL non-SELECT rejected pre-analysis) — confirmed:
    `PipelineService.scala:296-298` calls `SqlConnector.checkQuery` before `inferSchema`; test 3.5.
  - AC #5 (RLS-scoped existing-source 403/404) — confirmed: `resolveProposalSourceSchema` uses
    `dataSourceRepo.findByIdOwned` → `None` → `ServiceError.NotFound`; test 3.9 asserts 404 and no
    leaked field name.
  - AC #6 (schema conformance) — confirmed via test 3.11 using the `JsonSchemaValidation` harness
    against a real `analyzeStepResponseFormat` output, and the schema's `AnalyzeProposalStep` `$defs`
    entry correctly matches the actual `type`-discriminator/object-`config` wire shape (design.md D6),
    not the sibling `pipeline-analyze-response.schema.json`'s stale `$defs.AnalyzeStep`.
  - AC #7 (additive, existing `/analyze` unchanged) — confirmed: `PipelineService.analyze` (existing
    method) has zero diff.
  - design.md D2's source-resolution precedence (`sourceId` wins over inline `type` when both
    present) — confirmed correctly implemented: `resolveProposalSourceSchema` matches `proposal.source.sourceId`
    first (`PipelineService.scala:262`), falling to `resolveInlineSourceSchema` only in the `None` case;
    covered by test 3.12.
  - design.md D2's "recognized inline type but config `Option` absent" guard — confirmed correctly
    implemented for all three connector-backed branches (`sql`/`rest_api`/`static`), each matches its
    config `Option` for `None` *before* touching the payload (`PipelineService.scala:289-291`,
    `303-305`, `318-320`) and returns `ServiceError.BadRequest`, never an unguarded `.get`. Tested
    (3.10) for the `sql` case.
- No scope creep: diff is limited to the new schema/protocol/method/route plus the minimal DI wiring
  (`ApiRoutes.scala` threads the existing `connector` instance) the new method needs.
- No regressions to existing behavior: `PipelineService.analyze`, `PipelineRoutes`'s pre-existing
  branches, and `JsonProtocols`'s existing mixins are unchanged apart from additive lines.
- Planning artifacts (proposal/design/tasks) accurately reflect the implemented behavior for
  everything except the gap above, which none of the planning artifacts anticipated (also not raised
  by any of the four design-gate skeptic rounds).

### Phase 2: Code Review — FAIL

Gates (fresh run, this worktree, `WORKTREE_PATH` — `EVALUATOR_CLEAN_WORKTREE` was not set):

- `cd backend && sbt test` → **all 2487 tests passed** (146 suites, 0 failed), including the new
  `PipelineAnalyzeProposalRoutesSpec` (13 tests, all green). Frontend gates not run — `git diff
  --name-only main...HEAD` touches only `backend/**`, `schemas/**`, and `openspec/**`.
- `node scripts/check-scala-quality.mjs` → clean (0 inline-FQN violations in the diff; only
  pre-existing soft file-size warnings across the codebase, informational per CONTRIBUTING.md).
- `node scripts/check-schema-drift.mjs` → schemas in sync with `JsonProtocols` (38 checked).
- `node scripts/check-openspec-hygiene.mjs` → only the expected "not yet archived" notice (this
  change hasn't reached the archive step of the workflow yet — not a defect).

**Blocking issue — unguarded exception path for an unrecognized step `type` (Error handling /
"no silent failures" and the "never an unguarded `.get`" concern called out for this review, applied
one level further down the same code path):**

`PipelineService.analyzeProposal` (`PipelineService.scala:230-256`) converts every
`proposal.steps` entry directly into a `PipelineAnalyzeService.PipelineStepInput` and never validates
`req.\`type\`` against `PipelineStepKind.All` before doing so — unlike the pre-existing `addStep`
(`PipelineService.scala:400-404`), which explicitly guards this exact case:

```scala
if (!PipelineStepKind.All.contains(req.`type`))
  Future.successful(Left(ServiceError.BadRequest(
    s"Invalid step type '${req.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
  )))
```

Without that guard, an unrecognized `type` string flows through two stages:

1. `PipelineAnalyzeService.analyze`'s `inferOutputSchema` dispatch degrades gracefully for an unknown
   op (`PipelineAnalyzeService.scala`, `case unknown => (inputSchema, Some(s"Unknown op: '$unknown'"))`)
   — no exception here.
2. `analyzed.map(toAnalyzeStepResponse)` (`PipelineService.scala:253`) then calls the pre-existing
   `toAnalyzeStepResponse` (`PipelineService.scala:347-386`), which re-decodes the step via
   `PipelineStepConfigCodec.decode(s.op, s.config)`. For an unregistered kind,
   `PipelineStep.companionFor(kind)` returns `Left(msg)`
   (`backend/src/main/scala/com/helio/domain/PipelineStep.scala:128-135`), which `decode` (
   `PipelineStepConfigCodec.scala:75-80`) turns into a `Failure`. `toAnalyzeStepResponse`'s
   `case Failure(ex) => throw new IllegalStateException(...)` (`PipelineService.scala:377-381`) then
   throws, uncaught, inside the `Future.map` callback — producing a failed `Future`. No custom
   `ExceptionHandler`/`RejectionHandler` exists anywhere in `backend/src/main/scala` (confirmed via
   grep), so Pekko's default handler converts this into an unhandled `500 Internal Server Error`
   in `ServiceResponse.run`'s `onSuccess(result)` (`ServiceResponse.scala:34-37`), not the per-step
   `validationError`-in-`200` or clean `400` the endpoint's contract requires.

`toAnalyzeStepResponse` was previously safe from this failure mode only because every caller that
reaches it today (the live `analyze()` endpoint) reads persisted steps that `addStep`/`updateStep`
already gated through `PipelineStepKind.All.contains` before write. `analyzeProposal` is the first
caller to feed it steps that never passed through that gate — and the proposal schema's own
description explicitly documents this as unenforced-until-apply-time, i.e. a proven-reachable dry-analyze
input, not a theoretical one.

**Required fix:** in `analyzeProposal`, validate every `proposal.steps` entry's `\`type\`` against
`PipelineStepKind.All` before building `stepInputs` — mirroring `addStep`'s existing guard
(`PipelineService.scala:401-404`) — and return `ServiceError.BadRequest` (with the same
"Invalid step type '...'. Allowed values: ..." message shape, or a per-step `validationError` if that
better fits the endpoint's per-step-error contract; either satisfies AC #3, but plumbing must not let
an unrecognized `type` reach `toAnalyzeStepResponse`). Add a task-3.x-equivalent test: a proposal step
with a `type` outside `PipelineStepKind.All` returns `400` (or a per-step `validationError` in `200`),
never a `500`.

Everything else in the diff is clean:

- **CONTRIBUTING.md mechanical rules** — no inline FQNs anywhere in the diff (verified via grep +
  `check-scala-quality.mjs`); per-domain formatter lives under `com.helio.api.protocols`, aggregator
  only mixes it in (`JsonProtocols.scala`); `PipelineService.scala` crossed further past the 400-line
  "propose a split" threshold (542 → 679 lines) without a split proposal in the PR description — see
  Non-blocking Suggestions (design.md D1 already reasons about staying in `PipelineService` rather
  than a new service class, so this is a judgment call already made explicitly, not an oversight).
- **DRY** — reuses `PipelineAnalyzeService.analyze`, `toAnalyzeStepResponse`, `toFieldResponse`,
  `SqlConnector.checkQuery`/`inferSchema`, `RestApiConnector.inferSchema` verbatim; no divergent
  re-implementation.
- **Type safety** — no untyped escape hatches; `connector: RestApiConnector = null` is a documented,
  precedented nullable-optional-collaborator pattern already used elsewhere in `ApiRoutes.scala`
  (comment cites `binaryRefRepo`/`imageUploadRepo`), guarded at its one call site via `Option(connector)`
  before use (`PipelineService.scala:311-317`) — not an unguarded null dereference.
- **Security** — inline SQL is guarded by `SqlConnector.checkQuery` before any execution; existing
  source lookups are owner-scoped (no existence leak on 404).
- **Tests meaningful** — the 11 new route-level tests each assert on the actual response shape/DB
  state, not just status codes; the schema-conformance test (3.11) is the actual verification signal
  for AC #6 the first design-gate round flagged as originally missing.
- **No dead code** — no unused imports, no leftover TODO/FIXME.
- **No over-engineering** — a single new method + two small private helpers on the existing service,
  consistent with design.md D1's explicit rejection of a new service class.
- **Route ordering (design.md D5)** — verified correct: `path("analyze-proposal")` registered before
  both `PipelineIdSegment`-based branches in `PipelineRoutes.scala`'s `concat` block.

### Phase 3: UI Review — N/A

Per the orchestrator's briefing: this ticket is backend-only (new schema, new protocol, new
`PipelineService` method, new route) with no frontend consumer. Independently confirmed via
`git diff --name-only main...HEAD`: no `frontend/**` files touched. `ApiRoutes.scala` is touched only
to thread an existing `RestApiConnector` instance into `PipelineService`'s constructor (no route-shape
change to any existing endpoint); the new `schemas/pipeline-analyze-proposal-response.schema.json` has
no frontend consumer yet (out of scope per proposal.md's Non-goals — MCP tool exposure is a separate
ticket).

### Overall: FAIL

### Change Requests

1. In `PipelineService.analyzeProposal` (`backend/src/main/scala/com/helio/services/PipelineService.scala:230-256`),
   validate each `proposal.steps` entry's `\`type\`` against `PipelineStepKind.All` before converting
   to `PipelineAnalyzeService.PipelineStepInput`, mirroring the existing guard in `addStep`
   (`PipelineService.scala:401-404`). An unrecognized step `type` must produce `ServiceError.BadRequest`
   (or a per-step `validationError` in a `200`) — never reach `toAnalyzeStepResponse`'s
   `PipelineStepConfigCodec.decode` re-decode path (`PipelineService.scala:347-386`), which throws an
   uncaught `IllegalStateException` for any kind `PipelineStep.companionFor` doesn't recognize,
   surfacing as an unhandled `500` (no `ExceptionHandler` is registered anywhere in the backend). Add
   a test asserting a proposal step with a `type` outside `PipelineStepKind.All` returns `400` (or a
   per-step `validationError`), never a `500`.

### Non-blocking Suggestions

- `PipelineService.scala` is now 679 lines, further past the CONTRIBUTING.md ~400-line
  "propose a split in the PR description" threshold (was 542 lines on `main`). design.md D1 already
  makes a reasoned case for keeping `analyzeProposal` on `PipelineService` rather than a new service
  class; worth a one-line acknowledgment in the PR description per CONTRIBUTING.md's own ask, but not
  blocking given the documented rationale.
