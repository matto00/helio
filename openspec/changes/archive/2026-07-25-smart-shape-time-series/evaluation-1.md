## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All four ticket ACs addressed explicitly:
  - Catalog entry with params (timeField/granularity/measures) + output contract — verified via
    `PipelineShapeRoutesSpec` ("include named entries for single-row, top-n, and time-series, each
    with a non-empty paramsSchema") and `TimeSeriesShape.paramsSchema`/`outputContract`.
  - `expand(params)` → datebucket + aggregate + sort, one row per bucket ordered by bucket — verified
    both statically (`TimeSeriesShapeSpec`) and end-to-end through the real pipeline engine
    (`TimeSeriesShapeEngineSpec`, shuffled multi-month fixture → 3 rows, chronological, correct sums).
  - Tests present for both expansion-shape and e2e-run per AC3.
  - Additive/backward-compatible: no Flyway migration added (`git diff --stat` confirms), no existing
    wire shape changed, no `schemas/` edit (consistent with design.md's verified claim that
    `rowCount.kind` already includes `"unbounded"`).
- No AC silently reinterpreted — re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and the
  spec delta; all agree with the implementation on the exact three-step expansion, `Unbounded` row-count
  contract, and lowercase-normalized `granularity`.
- All 11 `tasks.md` items marked `[x]` and match what's actually in the diff (no over- or
  under-claiming); `files-modified.md` accurately lists the 6 changed files.
- No scope creep — diff touches exactly `TimeSeriesShape.scala` (new), `PipelineShape.scala` (registry
  entry), and the 4 test files called out in the plan. No panel/MCP/editor code (explicitly out of
  scope per the ticket) is touched.
- No regressions to existing behavior: full `sbt test` run independently (see Phase 2) — 1999/1999
  tests pass, including all pre-existing `single-row`/`top-n`/`passthrough` shape specs.
- No API-contract/schema updates were needed and none were made, consistent with the design's own
  verified reasoning.
- Planning artifacts (design.md Decisions 1–6, spec delta) accurately reflect the final implemented
  behavior — cross-checked design.md's factual claims against source (`DateBucketStep.floorFn`
  case-sensitivity, `AggregateStep`'s `keyMap ++ aggMap` right-bias, `SortStep`'s string-fallback
  comparator) and all are verbatim-accurate, matching the skeptic's independent design-gate
  confirmation (`skeptic-design-1.md`, verdict CONFIRM).
- Gap-filling spinoff (design.md Decision 5) independently verified live in Linear: HEL-622, parented
  under HEL-337, content matches Decision 5.

### Phase 2: Code Review — PASS
Issues: none.

Gates re-run independently (not trusting executor's self-report):
- `node scripts/check-scala-quality.mjs` → 0 hard errors (only pre-existing, unrelated soft
  file-size warnings on other files). No inline FQNs in `TimeSeriesShape.scala` or its tests.
- `node scripts/check-schema-drift.mjs` → clean.
- `npm run format:check` (Prettier over the whole repo glob) → clean; confirmed separately that
  Prettier has no Scala parser and the `.` glob simply skips `.scala` files (does not error), so
  format:check genuinely passes rather than silently no-op-failing.
- `npm run lint` → clean (0 warnings).
- `npm run check:openspec` → fails exactly as documented (change complete-but-not-archived); this is
  the expected/precedented pre-archive state, not a defect.
- `cd backend && sbt test` (full suite, independently invoked, not the executor's report) → **1999
  tests, 0 failures**, including the 4 targeted new/extended specs (`TimeSeriesShapeSpec`,
  `TimeSeriesShapeEngineSpec`, `PipelineShapeSpec`, `PipelineShapeRoutesSpec`) and no regression in any
  pre-existing suite.
- Commit `91636c77` uses `--no-verify`; the commit body explicitly names every hook, states which ones
  were verified manually pre-commit (lint/format/schemas/scala-quality), and explains the one
  legitimately-failing hook (`check:openspec`) — matches CONTRIBUTING.md's AI-Collaborator bypass
  disclosure requirement and the two precedent tickets (HEL-393/394) in this epic.

Standards checks:
- **CONTRIBUTING.md [mechanical]**: no inline FQNs (grep-checked via `check-scala-quality.mjs`, plus
  manual read of `TimeSeriesShape.scala` — all imports at top); file sizes well within the 250-line
  soft budget (179 / 209 / 76 lines for the three new/substantial files).
- **HEL-391 layering contract** ("`domain/shapes` must NOT import `com.helio.api.protocols`"):
  `TimeSeriesShape.scala` imports only `com.helio.domain.steps.*` and `spray.json._` — no
  `api.protocols` import. The `api.protocols` imports present in `TimeSeriesShapeSpec.scala` are in a
  test file (not `domain/shapes` production code) and exist to exercise the codec-decode boundary per
  AC3/the spec's own "valid against the existing step decode path" requirement — same pattern as
  `SingleRowShapeSpec`/`TopNShapeSpec`/`PassthroughShapeSpec`, not a layering violation.
- **DRY**: reuses `Aggregation`'s existing `{fn,field,alias}` wire shape and `DateBucketConfig`/
  `AggregateConfig`/`SortConfig`/`SortKey`/`AggregateField` directly; no duplicated validation or
  config types. Extends (does not duplicate) `PipelineShapeSpec` and `PipelineShapeRoutesSpec` per the
  ticket's explicit instruction.
- **Readable**: clear per-field validation helpers (`validateTimeField`/`validateGranularity`/
  `validateMeasures`/`validateMeasureContents`), no magic values (`SupportedGranularities`/
  `SupportedFns` named sets), descriptive `Left` error messages that name the offending value.
- **Correctness of design claims, independently re-verified against source** (not just trusted from
  design.md): `DateBucketStep.floorFn` (`DateBucketStep.scala:74-81`) matches granularity via an exact
  `case "day" => ...` with no `.toLowerCase` — confirms the lowercase-normalization necessity.
  `AggregateStep.apply` (`AggregateStep.scala:82-102`) builds `keyMap ++ aggMap`, right-biased —
  confirms the alias/timeField collision hazard is real. `SortStep.apply` (`SortStep.scala:59-82`)
  falls back to raw string comparison when `PipelineRowJson.toDouble` fails to parse — confirms the
  zero-new-code chronological-sort claim for `yyyy-MM-dd` strings. `Kind` constants
  (`"datebucket"`/`"aggregate"`/`"sort"`) and the `Aggregation(alias, fn, field)` field order both match
  actual definitions.
- **Type safety**: no `Any`/untyped escape hatches; `expand` returns `Either[String, Vector[...]]`
  consistently with the trait contract.
- **Error handling**: every validation branch returns a descriptive `Left`; no silent failures or
  swallowed exceptions (`Try(...).toOption` in `validateMeasures` is used correctly to detect
  malformed measure objects, not to hide errors — a parse failure still surfaces as a `Left`).
  `TimeSeriesShapeEngineSpec.makeStep`'s `MatchError` fallback is a test-only invariant guard, not
  production code.
- **Tests meaningful**: `TimeSeriesShapeSpec` covers every validation branch called out in the spec
  delta (missing/empty timeField, unknown granularity, missing/empty measures, unsupported fn,
  duplicate alias, alias/timeField collision) plus the exact-config assertions for all three expansion
  steps; `TimeSeriesShapeEngineSpec` proves the real regression a stub-only test would miss (shuffled
  input order → chronologically sorted output). These would catch a real regression (e.g. dropping the
  trailing sort, or reverting the lowercase normalization).
- **No dead code**: no leftover TODO/FIXME/commented-out code in the diff.
- **No over-engineering**: exactly the fixed three-step expansion the ticket asked for; no premature
  generalization (e.g. no unrequested `outputColumn` param — explicitly rejected in design.md
  Decision 1 as unrequested scope).
- **Behavior-preserving**: this is additive (new shape + registry entry + extended tests), not a
  refactor of existing code — `PipelineShape.scala`'s diff is a single added `Map` entry.

### Phase 3: UI Review — N/A
Pure backend domain-layer change. No files under `frontend/**`, `backend/src/main/scala/.../ApiRoutes.scala`,
`schemas/**`, or the canonical (merged) `openspec/specs/**` were touched — confirmed via
`git diff main...HEAD --stat`. The `openspec/changes/smart-shape-time-series/specs/pipeline-shape-registry/spec.md`
file touched by this change is a change-delta artifact under `openspec/changes/`, not the merged
`openspec/specs/` tree, so it does not trigger Phase 3. No dev servers were started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None.
