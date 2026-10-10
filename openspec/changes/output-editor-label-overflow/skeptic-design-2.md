## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 2ce4a46706d0642fbfb82c2257b13403d920f19a (== origin/main). No code changes yet; the change dir is untracked.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/output-editor-label-overflow/HEL-1432`.
- **Round-1 CR1 (a proof that couldn't fail for 4 targets): resolved.** D7 now proves the association through the `<label>`
  element: `document.getElementById(label.htmlFor)` must be the expected combobox. It also states why `getByLabelText` alone is
  not enough (it also matches `aria-label`). Task 2.5 now requires red for ALL 16 targets. On the pre-fix tree no element carries
  these ids (`Select.tsx` has no `id` prop; the only ids it emits are `listboxId` and `${baseId}-option-N`, lines 203 and 228), so
  every per-label assertion fails pre-fix as required.
- **Round-1 CR2 (render variants): resolved.** Tasks 2.3a–f map every id to a render. I checked each against the live code:
  - `ChartAggregationFields` renders for every non-scatter chart type (`OutputKindFields.tsx:103-120`), so "chart (line)"
    reaches agg-group-by, agg-field and agg-fn.
  - bar-orientation and bar-stacking only render when `chartType === "bar"` (`ChartDisplayFields.tsx:166-192`).
  - scatter-size-field and scatter-color-field only render when `chartType === "scatter"` (`ChartDisplayFields.tsx:241-263`).
  - Collection slots value/label/unit are at `OutputKindConfigCard.tsx:142-144`; timeline slots time/event are at `:167-168`.
    Both go through `SimpleMappingFields` (`OutputKindFields.tsx:331`).
  - Each render runs the no-duplicate-id assertion.
- **Round-1 CR3 (768 contradiction, fix location locked in advance): resolved.** D6 now says 768 is inside the mobile branch. At
  768, "no regression" means no overflow and the HEL-469/HEL-813 invariants hold; 1100 and 1440 must be unchanged before and after.
  This matches ticket AC 4 and tasks 1.6/1.7. D6 and task 1.6 now put the fix wherever the measured root cause is, under C3.
- **Round-1 notes:** the vertical/horizontal non-overlap of the 44px `::after` expanders is now binding in D6. The
  label-in-name mismatch ("Color by field" vs "Scatter color-by field") is recorded as a follow-up in D3. D4's rationale is
  partly corrected (see notes).
- **Independent whole-design pass:**
  - D1/C2 (`id={undefined}` renders no attribute) is sound.
  - The HEL-1430 characterization snapshot contains no DOM ids (`grep -c "id="` gives 0) and keys controls by accessible name.
    Adding trigger ids therefore can't churn it, while D3 (keep `aria-label`s) is still guarded.
  - Edit-mode Kind stays the only disabled-with-hint case; D5 leaves the `ariaDescribedBy` ternary alone.
  - The spec delta covers both AC families.
  - The ACs trace to tasks: AC1 to 1.1/2.1; AC2 to 1.2/2.2/2.3a/2.5; AC3 to 2.2/2.3a; AC4 (extension) to 1.3/1.4/2.3b–f;
    AC5 (layout) to 1.5–1.7; AC6 (lint) to 2.6.
  - I found no placeholders and no TBD/TODO.

### Verdict: CONFIRM

### Non-blocking notes

- D4 still contradicts itself. It says "This matches labelled native controls", then adds a parenthetical saying it is not parity
  with a native select. Risks still says "consistent with native labelled controls". Drop the "matches/consistent with native"
  wording.
- proposal.md "What Changes" still says the overflow fix is in `TableDisplayFields.css`. D6 now says the fix goes where the
  measured cause is. Align the proposal, or read it as "expected".
- Task 2.3c: the scatter size and color fields render only when `isBound` (`fieldOptions.length > 0`,
  `ChartDisplayFields.tsx:242`). The scatter test render needs bound field options. Without them `getByText` throws, so the
  test fails loudly rather than passing vacuously.
- When pairing labels to controls, note that the agg label "Value field" (chart render) has the same text as the metric
  `ariaLabel` "Value field". They never share a render, but a `getByLabelText("Value field")` written by mistake could resolve to
  the wrong control. Use the `selector: "label"` approach throughout, as D7 prescribes.
