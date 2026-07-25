## Context

HEL-391 (merged, commit b28731a5, PR #288) landed the `PipelineShape` abstraction, `PipelineShape.Registry`,
and `GET /api/pipeline-shapes`, with one trivial reference shape (`PassthroughShape`, expands to a single
`select` step, `RowCountContract.Unbounded`, empty `fields`). This ticket is the first concrete shape
(`single-row`) HEL-337 calls for, and closes two items HEL-391's design.md explicitly deferred: a
registry-parity drift test, and confirming `RowCountContract`'s sealing. `single-row` reduces a source to
one row using only the existing `aggregate`/`filter`/`limit` step kinds (`backend/src/main/scala/com/helio/domain/steps/`)
— no new op, no migration (the registry is code-level, like `ConnectorRegistry`).

## Goals / Non-Goals

**Goals:**
- Register `single-row`, expanding via two modes: `"aggregate"` (measures → one `aggregate` step, empty
  `groupBy`) or `"filter"` (conditions → `filter` + `limit 1`).
- Declare `outputContract = OutputContract(RowCountContract.ExactlyOne, fields = Vector.empty, ...)`.
- Add the registry-parity drift test HEL-391 deferred (mirrors `ConnectorRegistrySpec`).
- Fix `OutputContract.scala`'s stale doc comment (claims `RowCountContract` is "non-`sealed`"; the
  declaration is already `sealed trait RowCountContract` — the comment is simply wrong, not the code).

**Non-Goals:**
- Any UI/editor authoring surface, MCP tool, or panel binding (sibling tickets, HEL-337 epic).
- Runtime enforcement that `expand`'s output actually is one row — `expand` is pure and only builds a
  step list; whether execution yields exactly one row depends on the data (see Risks).
- A `role`-style field-semantics addition to `OutputFieldContract` — HEL-391 dropped that for YAGNI;
  `single-row`'s `fields = Vector.empty` (param-driven) doesn't need it either.

## Decisions

**1. Params are a `mode`-discriminated union (`"aggregate"` | `"filter"`), decoded by hand (mirrors
`PassthroughShape.expand`'s tolerant `JsObject` pattern-match, not a derived `JsonFormat`).** Two
sub-shapes share one `id`/`Registry` slot because both reduce a source to one row and the ticket
describes them as one shape's two configuration modes, not two shapes — matching the ticket text
verbatim ("Params: a set of measures ... OR a filter-to-one config"). *Alternative rejected*: two
separate registry entries (`single-row-aggregate` / `single-row-filter`) — rejected because the ticket
names one shape id (`single-row`) and splitting it invents catalog surface the ticket never asked for.

**2. Reuse `com.helio.domain.steps.Aggregation` and `com.helio.domain.steps.FilterCondition` directly
for params decoding**, rather than inventing parallel case classes. Both already live in
`com.helio.domain.steps` (not `com.helio.api.protocols`), so importing them into `com.helio.domain.shapes`
doesn't violate the domain/shapes → api/protocols layering ban (HEL-391 design.md Decision 1) — same
precedent as `PassthroughShape` importing `SelectConfig`/`SelectStep`. Their existing `RootJsonFormat`s
are reused for decode. *Alternative rejected*: define `MeasureSpec(fn, field, alias)` / a shape-local
filter-condition case class — pure duplication of `Aggregation`/`FilterCondition`'s fields with no
behavioral difference.

**3. `expand` validates `fn` (aggregate mode) and `operator` (filter mode) against each step's known
value set, returning `Left` on an unrecognized value, rather than deferring to the step's own runtime
behavior.** `AggregateStep.apply` throws `IllegalArgumentException` (uncaught, not `Either`) for an
unsupported `fn`; `FilterStep.evalCondition` silently returns `false` for an unrecognized `operator`
(matching zero rows, not an error) — both are worse failure modes than `expand` catching the typo before
any step is built. Known sets: `sum`/`avg`/`min`/`max`/`count` (from `AggregateStep`'s scaladoc) and
`=`/`!=`/`>`/`>=`/`<`/`<=`/`contains`/`is null`/`is not null` (from `FilterCondition`'s scaladoc).
*Alternative rejected*: no validation, let the step fail at execute time — worse UX, and silently-wrong
(zero-row) is strictly worse than a `Left` error for a shape whose contract promises one row.

**4. `outputContract.fields = Vector.empty`, matching `passthrough`'s precedent (HEL-391 design.md
Decision 2), not attempting to synthesize field entries from `measures` aliases.** `outputContract` is
declared once on the trait, not computed per-`expand`-call — it cannot know a caller's `measures` aliases
or which source columns a `filter`-mode call passes through ahead of time. `rowCount = ExactlyOne` is the
part of the contract that's genuinely shape-level and knowable in advance; `fields` isn't for either mode.
*Alternative rejected*: a params-schema-driven placeholder field list — no caller of `outputContract`
today (catalog only) needs synthetic field names, and it would misrepresent aliases the shape can't see.

**5. Registry-parity drift test asserts `PipelineShape.Registry.keySet` against an independently-authored
literal `Set("passthrough", "single-row")`** (mirrors `ConnectorRegistrySpec`'s pattern exactly — a
literal set written independently of both `Registry` and any shared constant, so a typo'd `id` or a
missing `Registry` line fails the test on either side).

**6. `RowCountContract`'s sealing is a no-op for this ticket — already `sealed trait RowCountContract`
in the merged code.** Only `OutputContract.scala`'s doc comment (lines 6-7, "A small, non-`sealed` closed
set") is wrong and gets corrected; the declaration itself needs no change. Confirmed by reading the
merged file directly, not assumed from the ticket's pre-briefing note.

## Risks / Trade-offs

- **[Risk]** `ExactlyOne` is a declared guarantee, not a runtime-enforced one — a `filter`-mode call whose
  conditions match zero source rows (or a source with zero rows) yields zero rows at execution, violating
  the contract in practice. → **Mitigation**: documented here and in `SingleRowShape`'s scaladoc as a known
  limitation; matches every other shape's contract (`passthrough`'s `Unbounded` is trivially satisfiable,
  `single-row`'s `ExactlyOne` is not, by nature of filtering) — no existing mechanism in this codebase
  enforces post-execution row-count contracts, and adding one is out of this ticket's scope.
- **[Risk]** Duplicate `measures` aliases would silently overwrite one another in `AggregateStep.apply`'s
  `Map` construction → **Mitigation**: `expand` rejects duplicate aliases with `Left` before any step is
  built (cheap, catches an easy authoring mistake at the one point that can see the whole `measures` list).
- **[Risk]** Two modes behind one `id` means `paramsSchema` (a flat `Vector[ShapeParamDescriptor]`) can't
  express "measures required only when mode=aggregate" structurally → **Mitigation**: each conditionally-
  required descriptor's `description` text states the condition explicitly (same flat-metadata limitation
  `passthrough` already accepts; `ShapeParamDescriptor` is descriptive only, never validating — HEL-391
  design.md Decision 3).

## Planner Notes

- Self-approved: one shape id with two internal modes vs. two registry entries (Decision 1) — the ticket
  text names a single shape id.
- Self-approved: `fn`/`operator` validation in `expand` (Decision 3) — strictly improves failure UX over
  the steps' own runtime behavior, no new external dependency, small and testable.
- Self-approved: no Flyway migration, no route/schema change — confirmed the existing
  `pipeline-shape-catalog.schema.json` already represents a non-`Unbounded` `rowCount` and non-empty
  `fields` generically; nothing to extend.
