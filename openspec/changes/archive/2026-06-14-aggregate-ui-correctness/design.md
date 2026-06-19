## Context

`AggregateConfig.tsx` already uses the shared `TextField` / `Select` primitives (no native HTML).
The component is missing: (1) per-function inline hints, (2) per-field alias validation, (3) a
descriptive relationship label between the group-by and aggregation sections.

`AggregateStep.apply` in `AggregateStep.scala` and `PipelineAnalyzeService.inferAggregate` were
audited against the apply/infer parity checklist. The only gap found: `sum` of an all-null group
returns `0.0` (Scala's empty-seq `sum`) while the inferred type is `"number"` — this is accurate
and expected per the spec and existing tests. No correctness bug exists in the engine itself, but
the regression test suite (`InProcessPipelineEngineSpec`) does not yet have a dedicated
`AggregateStepSpec` file covering all function × edge-case combinations as required by the ticket.

## Goals / Non-Goals

**Goals:**
- Add per-function inline hints inside each aggregation row, below the function Select
- Add alias-empty per-field validation warning to each aggregation row
- Add a static relationship description below the group-by section header
- Add a dedicated `AggregateStepSpec.scala` with all 5 functions × null/empty/multi-group cases
- Extend `AggregateConfig.test.tsx` to cover the new hint and alias-validation rendering

**Non-Goals:**
- Changing the wire config shape
- Adding new aggregate functions
- Modifying the backend engine logic (no correctness bug found)

## Decisions

**1. Inline hints as a static map, not fetched from backend.**
A `FN_HINTS` record in `AggregateConfig.tsx` maps each `AGG_FNS` member to a one-line hint string.
Rationale: purely presentational; no network call needed. Hints are rendered below the fn Select as
a `<span className="pipeline-detail-page__aggregate-fn-hint">` inside each aggregation row.
The authoritative hint text for each function is defined in `spec.md` and must match exactly:
  sum → "Sums numeric values; ignores nulls"
  avg → "Averages numeric values; ignores nulls"
  min → "Minimum numeric value; ignores nulls and non-numeric"
  max → "Maximum numeric value; ignores nulls and non-numeric"
  count → "Counts non-null values in the field"

**2. Alias validation via InlineError, shown after blur.**
An aggregation row with an empty alias (after the alias input has been blurred) emits an
`<InlineError>` component from `shared/chrome/InlineError`. `InlineError` renders as a `<p>` with
no ARIA role. Test code must use `screen.queryByText("Output name required")` (not `queryByRole("alert")`)
to check its presence or absence.

**3. Dedicated `AggregateStepSpec.scala`, not extending `InProcessPipelineEngineSpec`.**
`InProcessPipelineEngineSpec` already has aggregate cases but focuses on engine integration.
A standalone `AggregateStepSpec` calls `AggregateStep.apply` directly (pure unit test), making
the intent explicit and the test matrix easier to read.

**4. No general correctness fix required; one parity gap is documented as intentional.**
Audit findings:
- `count` returns `Long` → matches inferred `"integer"` type. Parity intact.
- `sum`/`avg`/`min`/`max` operate on `PipelineRowJson.toDouble` results. Nulls and non-numeric
  values produce an empty `nums` seq: `sum` returns `0.0`, `avg`/`min`/`max` return `null`.
- **min/max on non-numeric (string-typed) fields**: `toDouble` cannot parse strings, so `nums`
  is empty, and the result is `null`. `inferAggregate` infers the source field's declared type
  (e.g. `"string"`), creating an apparent parity gap. This is intentional: `min`/`max` are
  numeric operations in this engine and produce `null` for non-numeric inputs. The UI should
  add a hint note to clarify ("Operates on numeric values"), and the AggregateStepSpec SHALL
  add a test case confirming this behavior. No engine code change is needed.
- **empty rows + aggregate**: when `rows` is empty, `grouped` is an empty Map, so `apply`
  returns an empty `Seq` (zero output rows), not a single row with computed values. Tests
  must reflect this.

**5. Alias-empty validation: blur-first approach.**
The alias `InlineError` SHALL only render after the user has interacted with (blurred) the alias
input. Implementation: maintain a `Set<number>` of row indices that have been blurred via
`onBlur` on the alias `TextField`. The error only fires when the index is in the blurred set AND
`agg.alias === ""`. This prevents the "Output name required" warning from appearing immediately
when a new row is added.

**6. `InlineError` import path.**
`InlineError` is at `shared/chrome/InlineError` and is NOT exported from `shared/ui/index`.
The import in `AggregateConfig.tsx` must use `../../../shared/chrome/InlineError`.

## Risks / Trade-offs

- [Risk] Blur-state is held in local component state (`useState<Set<number>>`) and resets if the
  parent re-renders with a new config prop. → Mitigation: blur tracking is purely cosmetic UX;
  silently losing blur state on prop change is acceptable (new pattern — no prior precedent in
  the pipeline config components, but the UX impact is minor).

## Planner Notes

Self-approved. No new external dependencies. No API changes. No Flyway migration needed.
All changes are additive UI (hints + validation) and additive test coverage.

## Open Questions

None.
