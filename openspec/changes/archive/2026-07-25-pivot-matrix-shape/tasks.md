### Backend

## 1. PivotMatrixShape

- [x] 1.1 Add `PivotMatrixShape.scala` in `backend/src/main/scala/com/helio/domain/shapes/` with
      `id = "pivot-matrix"`, `label`, `description`, `paramsSchema` (`index`, `column`, `values`,
      `agg`).
- [x] 1.2 Implement `expand`: validate `index` (non-empty array of non-empty, non-duplicate strings),
      `column` (non-empty string), `values` (non-empty string), `agg` (one of
      sum/count/avg/min/max/first, case-insensitive against `PivotStep`'s six-value set).
- [x] 1.3 Validate collisions: `column ∈ index`, `values ∈ index`, `values == column` are each rejected
      with a descriptive message naming the collision.
- [x] 1.4 On success, branch on `agg` (case-insensitively): `sum`/`avg`/`min`/`max`/`count` → emit
      `aggregate` (groupBy = `index :+ column`, one aggregation reducing `values` via `agg`, alias
      `values`, original casing preserved) then `pivot` (agg hardcoded to the literal `"first"`);
      `first` → emit `pivot` alone (agg normalized to the lowercase literal `"first"`, not the caller's
      original casing).
- [x] 1.5 Declare `outputContract = OutputContract(RowCountContract.Unbounded, Vector.empty,
      <description noting value columns are data-dependent>)`.
- [x] 1.6 Register `PivotMatrixShape` in `PipelineShape.Registry`.

## 2. Registry/catalog extension

- [x] 2.1 Extend `PipelineShapeSpec`'s independently-authored id set and registry-equality assertions
      to include `"pivot-matrix"` (size 5).
- [x] 2.2 Extend `PipelineShapeRoutesSpec`'s named-shape catalog assertion to also check for a
      `"pivot-matrix"` entry with a non-empty `paramsSchema`.

### Tests

## 3. Unit and end-to-end coverage

- [x] 3.1 Add `PivotMatrixShapeSpec` (domain unit tests) covering: valid two-step expansion for each
      reducer `agg` value, valid one-step expansion for `agg = "first"`, `agg` case-insensitivity
      (casing preserved in `aggregate`'s `fn`, normalized to lowercase in `pivot`'s `agg`), missing/empty
      `index`/`column`/`values`, duplicate `index` entries, unsupported `agg`, and the three collision
      rejections (`column ∈ index`, `values ∈ index`, `values == column`).
- [x] 3.2 Add `PivotMatrixShapeEngineSpec` (end-to-end) proving the expansion decodes via
      `PipelineStepConfigCodec.decode` and, run through the real pipeline engine: (a) with `agg = "sum"`
      against a fixture containing duplicate `(index, column)` pairs, produces a correct crosstab with
      cells pre-collapsed via the aggregate step; (b) with `agg = "first"` against a fixture with no
      duplicates, produces a correct crosstab via `pivot` alone.
- [x] 3.3 Run `sbt test` for the full backend suite; confirm no pre-existing test regresses and no new
      Flyway migration was added.

## 4. Docs/handoff

- [x] 4.1 Write `files-modified.md` summarizing changed/added files for archive handoff.
