# HEL-1407: Aggregate step editor: case-sensitive function match, p-input a11y; min/max analyze-vs-apply type mismatch; StepSchemaDiffChips duplicate key

## Description

origin_kind: followup
origin_ticket: HEL-1310

From HEL-1310 (9fbdd4267, median/percentile/count_distinct). Verify each.

1. The step editor matches function names case-sensitively: a stored "PERCENTILE"/"SUM" shows no hint, and "PERCENTILE" shows no `p` input. Analyze now lowercases, so the editor should match case-insensitively (or lowercase on save).
2. Accessibility of the `p` input: its error isn't linked to the input (no `aria-invalid`/`aria-describedby`), and the field loses its visible label once filled. Follow DESIGN.md's form-error pattern.
3. min/max: analyze reports the field's declared type (e.g. integer) but apply returns a Double. Align inference with apply (or apply with inference), proven by the HEL-1310 parity test pattern.
4. `StepSchemaDiffChips.tsx` ~:29 logs a duplicate React key when several aggregations have an empty alias (pre-existing).

## Acceptance Criteria

- Red-first tests for items 1, 3 and 4; an a11y assertion for item 2.
- Item 1: a stored function name in any case ("PERCENTILE", "SUM") shows its hint, selects the right picker option, and "PERCENTILE" shows the `p` input.
- Item 2: the `p` input has a persistent visible label; when its error is shown, the input carries `aria-invalid="true"` and `aria-describedby` pointing at the error element. DESIGN.md has no dedicated form-error section; the in-repo precedent followed is `shared/ui/FormField.tsx` (`errorId`) + `features/panels/ui/editors/FormFieldRow.tsx` (caller-threaded `aria-invalid`/`aria-describedby`).
- Item 3: aggregate-op analyze type for min/max agrees with the runtime type apply produces, proven by the HEL-1310 apply/infer parity test pattern (which must fail on the old behavior).
- Item 4: no duplicate React key warning when several aggregations share an empty alias.

## Premise notes (orchestrator, verified against origin/main e7470bc6)

All four items confirmed present. DESIGN.md has no "form-error pattern" section. `aggResultType` is shared with the `groupby` op (whose Spark path preserves column type) — the min/max fix is scoped to the `aggregate` op only.
