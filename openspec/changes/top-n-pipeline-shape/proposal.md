## Why

Charts and tables frequently want the top (or bottom) N rows by a measure. HEL-391 landed the
`PipelineShape` abstraction/registry/catalog and HEL-393 landed the first concrete shape
(`single-row`); this change adds the second — `top-n` — sort + limit by a measure with an
explicit, deterministic ties policy, using only the existing `sort`/`limit` ops.

## What Changes

- Register a `top-n` shape in `PipelineShape.Registry` (`backend/src/main/scala/com/helio/domain/shapes/`).
  Params: `measure` (field), `direction` (`asc`/`desc`, case-insensitive), `n` (positive count),
  `ties` (`strict`, default — exactly N rows via `limit`). Expansion → one `sort` step + one
  `limit` step. No new step kinds.
- Ties policy: `strict` relies on `SortStep`'s documented stable sort, so the Nth/N+1th boundary is
  broken deterministically by original input row order. A `keep-ties`/dense variant (all rows tied
  with the Nth) would need the `window` op (HEL-376) and per-partition filtering — `expand` rejects
  any `ties` value other than `strict` with a `Left` explaining the deferral.
- Scope: global top-N only. Per-group (partitioned) top-N also needs `window` + a rank-based
  filter, isn't trivial to add here, and is filed as a HEL-337 spinoff.
- `outputContract = OutputContract(RowCountContract.AtMostParam("n"), fields = Vector.empty, ...)`
  — `AtMostParam`'s first real (non-`single-row`) consumer; fields empty since columns mirror the
  source, unknown ahead of `expand`-time (mirrors `passthrough`/`single-row` precedent).
- Fix `SingleRowShape`'s `fn` validation to be case-insensitive (mirrors `combinator`'s existing
  convention and `AggregateStep.apply`'s own runtime `fn.toLowerCase`, which the stricter
  case-sensitive validation was inconsistent with) — small, single-file, contained fix.
- Add a named-shape HTTP-catalog assertion covering both `single-row` and `top-n` (gap flagged,
  not acted on, in HEL-393's review).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-shape-registry`: registry gains a third shape (`top-n`); catalog response gains an
  `AtMostParam` example; `SingleRowShape`'s `fn` validation becomes case-insensitive.

## Impact

- `backend/src/main/scala/com/helio/domain/shapes/` — new `TopNShape.scala`; `Registry` gains one
  line; one-line case-insensitivity fix in `SingleRowShape.scala`.
- `backend/src/test/scala/com/helio/domain/shapes/` — new `TopNShapeSpec.scala`, registry-parity
  additions to `PipelineShapeSpec.scala`, a new case in `SingleRowShapeSpec.scala` for the `fn`
  case-insensitivity fix.
- `backend/src/test/scala/com/helio/domain/` — new `TopNShapeEngineSpec.scala` (end-to-end).
- `backend/src/test/scala/com/helio/api/routes/PipelineShapeRoutesSpec.scala` — named-shape
  catalog assertion.
- No Flyway migration, no route/schema wire-shape change (existing catalog schema already
  represents `AtMostParam` and empty `fields` generically).
- Out of scope: panel wiring, MCP surface, editor UX (sibling tickets); per-group top-N and
  `keep-ties` (spun off).

## Non-goals

- Per-group (partitioned) top-N and the `keep-ties`/dense ties variant — both need the `window` op
  plus rank-based filtering; filed as a HEL-337 spinoff rather than built here.
- Runtime enforcement that execution actually yields ≤N rows — `expand` is pure; the guarantee
  depends on `sort`+`limit` executing as expanded (same declared-not-enforced posture as
  `single-row`'s `ExactlyOne`).
