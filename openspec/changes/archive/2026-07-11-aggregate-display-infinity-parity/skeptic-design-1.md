## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Structural validity**: `openspec validate aggregate-display-infinity-parity --strict` →
  `Change 'aggregate-display-infinity-parity' is valid` (exit 0).

- **Ticket vs. plan alignment**: Read `ticket.md` (2 ACs: metric-avg-decimal-overflow fix;
  `"Infinity"` alignment-or-document). Both are addressed by `proposal.md`/`design.md`/`tasks.md`
  with a matching spec delta (`specs/panel-viz-aggregation/spec.md`, 4 scenarios covering long
  decimal, integer, non-numeric, and `"Infinity"` passthrough).

- **`MappedPanelData` is really `Record<string, string>`, and value really is
  collapsed with no aggregate/plain distinction**: read
  `frontend/src/features/panels/hooks/usePanelData.ts` lines ~140-180. Confirmed:
  `mapped.value = aggregate !== null ? String(aggregate) : ""` (aggregate path) vs.
  `mapped[slot] = String(value)` (plain fieldMapping path) — both land in the same
  `string`-typed field with no tag distinguishing provenance. This grounds the design's
  central claim that formatting can't be gated to "aggregate-only" without deeper plumbing,
  justifying Decision 1's "format any numeric-looking value" scope.
  Also confirmed `metricLiteral` (HEL-293) only overrides `label`/`unit`, never `value` — so
  there's no literal-value-override path that could unexpectedly interact with the new
  formatting.

- **`MetricRenderer.tsx` renders `data?.value` verbatim** (line 27) — confirms the overflow
  bug is real and the fix point (this file) is correct.

- **`aggregate.ts`'s `coerceNumber`** (lines 26-36): confirmed it rejects `"Infinity"` via
  `Number.isFinite(Number(s))` — `Number("Infinity")` is `Infinity`, which fails
  `Number.isFinite`, so the string is excluded. Matches the design's description exactly.

- **Backend `AggregateStep.scala`** (line 87) calls `PipelineRowJson.toDouble`, which for a
  `String` case (`PipelineRowJson.scala` line 59) delegates to `s.toDoubleOption` — Scala's
  `String.toDoubleOption` wraps `java.lang.Double.parseDouble`, whose grammar accepts
  `"Infinity"`/`"-Infinity"`/`"+Infinity"` as real (non-finite) doubles. This confirms the
  stated divergence is real, not hypothetical, and that the top-of-file "mirrors ... exactly"
  comment in `aggregate.ts` is currently slightly inaccurate — which is exactly what Decision 2
  proposes to fix with an inline comment.

- **Existing spec text supports "document, don't align"**: read
  `openspec/specs/panel-viz-aggregation/spec.md` — the `Aggregation semantics match the
  pipeline aggregate step` requirement already states TS aggregation operates over "values
  coercible to a **finite** number." Aligning `coerceNumber` to accept `"Infinity"` would
  indeed contradict this existing (unchanged) requirement, confirming aligning would itself
  be an undisclosed spec-level behavior change. Decision 2's reasoning holds.

- **No naming/behavior conflict in the spec delta**: the new "Metric aggregate value is
  formatted for display" requirement is additive and orthogonal to the existing "Aggregation
  semantics match..." requirement (numeric semantics unchanged; only display formatting is
  new) — no contradiction between old and new requirements.

- **Test-impact claim checked**: read `MetricRenderer.test.tsx` — existing cases use `"84"`,
  `"42"`, `"100"`, `"84/100"` (integer strings). `Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2, useGrouping: false }).format(84)` → `"84"` (no added decimals,
  no grouping), so the claim that existing tests keep passing unmodified is correct.

- **Grep for pre-existing `Intl.NumberFormat` usage**: none found — this introduces a new
  formatting pattern rather than deviating from an established one. Existing
  `toLocaleString()` calls (`PipelineListTable.tsx`, `StepCard.tsx`, etc.) are all integer row
  counts in an unrelated domain (grouping thousands), not decimal-precision formatting — the
  design's rationale for not reusing that convention here is sound.

- **Tasks ↔ spec scenario parity**: `tasks.md` §2.1 lists exactly the 4 cases the spec delta
  enumerates (long decimal → 2 fraction digits, integer unchanged, non-numeric unchanged,
  `"Infinity"` unchanged). No scenario is unimplemented; no task lacks a corresponding
  scenario.

### Assessment of the specific concerns raised

1. **Precision policy (2 fixed fraction digits, no grouping)** — reasonable and well-justified
   given the codebase evidence above. Minor unaddressed edge cases (negative numbers,
   near-zero decimals rounding to `"0"`/`"-0"`) are not called out in design.md, but these are
   standard `Intl.NumberFormat` behaviors, not novel risk for a polish ticket, and don't change
   my verdict.
2. **Formatting ALL metric values, not just aggregate-derived** — justified by the
   `MappedPanelData: Record<string,string>` structural constraint (verified above), not an
   arbitrary scope choice. The risk (existing dashboards' precise raw values could visually
   change) is explicitly named in design.md's Risks section with a reasonable mitigation
   (integers/non-numeric text untouched). Acceptable trade-off for a self-approved
   polish-ticket decision.
3. **"Document, don't align" for `"Infinity"`** — well-justified; the existing spec text
   already requires "finite," so aligning would be an undisclosed spec change smuggled into a
   polish ticket. Documenting is the more conservative, contract-preserving choice and matches
   the ticket's explicit either/or framing.
4. **Spec delta / tasks completeness** — both ACs are covered; scenarios in the spec delta and
   tasks.md are consistent with each other and with design.md.
5. **Scope creep** — none found. Impact section lists exactly the 3 touched files/artifacts;
   Non-goals explicitly fence off chart-axis formatting and `computeAggregate` semantics.

### Verdict: CONFIRM

### Non-blocking notes
- Design doesn't explicitly address negative-number or near-zero decimal rounding display
  (e.g. `-0.001` → likely renders `"0"` via `Intl.NumberFormat`'s default negative-zero
  handling) — worth a quick sanity check during implementation/test-writing, not a design
  blocker.
- Scala's `toDoubleOption`/`Double.parseDouble` also accepts the literal `"NaN"` as a valid
  (non-finite) double, which is a second latent TS/Scala divergence not mentioned in the
  ticket or design (TS's `Number.isFinite` correctly excludes `"NaN"` too, so behavior is
  actually consistent between the two paths in this one case — no action needed, just noting
  it was checked).
- `tasks.md` 1.1 leaves the helper's exact location ("`MetricRenderer.tsx` or colocated
  module") open — fine to leave as an implementation detail for a change this small.
