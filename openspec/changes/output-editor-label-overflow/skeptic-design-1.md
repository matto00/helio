## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 2ce4a46706d0642fbfb82c2257b13403d920f19a (== origin/main; change dir untracked, no code changes yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/output-editor-label-overflow/HEL-1432`.
- **Select takes no id (root cause of part 1):** `frontend/src/shared/ui/Select.tsx` `SelectProps` has no `id`; the trigger
  `<button role="combobox">` (line ~159) gets no id. Listbox/option ids come from `useId()` (`${baseId}-listbox`,
  `${baseId}-option-N`), so D1's "caller id on the trigger only, cannot collide" holds.
- **Dangling-target count (23 / 16 / 7):** I ran my own scan (every `htmlFor` literal or template prefix in `frontend/src/**/*.tsx`
  with no matching `id=`). Result: exactly 23 dangling targets. The 16 Output-editor ones and the 7 other-surface ones match ticket.md
  exactly (add-root-source, divider-orientation, form-editor-dataset, image-fit, pipeline-source, schedule-kind, source-method).
- **Sole-caller claim:** `TableDisplayFields`, `ChartDisplayFields`, `ChartAggregationFields` and `MetricValueEditor` each have
  exactly one non-test importer, `features/pipelines/ui/outputEditor/OutputKindFields.tsx`. Confirmed.
- **Scope judgment:** widening from Kind/Step to all 16 is the right call. It is the same defect on the same surface with the same
  one-prop fix, and the components have no other callers. Deferring the 7 elsewhere is reasonable.
- **Accessible names unchanged (D3):** `aria-label` takes precedence over `<label>` in name computation. The HEL-1430
  characterization snapshot (`__snapshots__/OutputEditorSheet.openingState.test.tsx.snap`) keys controls by accessible
  name (`combobox name="Output kind"` etc.), so it already guards against D3 regressing. Good.
- **HEL-1388 lock:** `OutputEditorSheet.tsx:321-336`: `disabled={!isCreate}`, `ariaDescribedBy={isCreate ? undefined : kindHintId}`.
  D5 leaves this alone. Step renders only `isCreate` (line 307), which matches the AC's "Step in create mode".
- **Overflow constraints:** `TableDisplayFields.css` has the HEL-469 140px non-shrinking format wrapper and the HEL-813 `--space-4`
  move gap with an `::after` 44px expander, as the design describes. `@media (max-width: 768px), (pointer: coarse)` is
  already the file's own mobile pattern. (Minor: the established query is in `app/App.css`, not `App.css`. The move group has
  2 buttons unless there are more than 8 columns, not "four 28px".)
- **Label-text vs aria-label collision check:** pairing every in-scope `<label>` text against its Select's `ariaLabel` gives:
  - "Chart type" / ariaLabel "Chart type" (`OutputKindFields.tsx:93-97`): **identical**
  - "Format" / ariaLabel "Format" (metric, `OutputKindFields.tsx:232-236`): **identical**
  - "Format" / ariaLabel "Format" (collection, `OutputKindConfigCard.tsx:151-155`): **identical**
  - "Cell density" / ariaLabel "Cell density" (`TableDisplayFields.tsx:93-97`): **identical**
  - All other pairs differ ("Kind"/"Output kind", "Step"/"Target step", "Orientation"/"Bar orientation", ...).

### Verdict: REFUTE

The design is sound and the scope is right. Its test plan, however, prescribes a proof that cannot fail for 4 of the 16
in-scope targets. That is a defect in the acceptance signal and is cheap to fix now.

### Change Requests

1. **Task 2.3's proof does not catch the defect for 4 targets (tasks.md 2.3, 2.5; design.md D7).** Testing Library's
   `getByLabelText(text)` also matches an element's `aria-label`. For "Chart type", both "Format" labels and "Cell density",
   the label text equals the Select's `ariaLabel` exactly. So `getByLabelText(...)` already resolves on the pre-fix tree, and
   task 2.5's required red can't happen for those targets. Either the executor sees an unexplained green, or the suite
   "passes" without proving anything. Revise 2.3 and 2.5 to assert the association through the `<label>` element itself for
   every in-scope target. For example: find the `<label>` by text with `selector: "label"`, then assert
   `document.getElementById(label.htmlFor)` (or `label.control`) is the expected combobox. That fails pre-fix for all 16
   (no element carries the id). Keep `getByLabelText` for Kind/Step as the ticket asks; it is red for those. State in 2.5
   that red is required for all 16 ids, not only Kind/Step.
2. **Task 2.3's coverage is ambiguous about the render variants needed to reach all 16 ids.** "chart, metric, collection, table
   kinds" leaves out `timeline` (`output-slot-time`, `output-slot-event`). "Chart" doesn't say that `bar-orientation`/`bar-stacking`
   need `chartType: bar` and `scatter-size-field`/`scatter-color-field` need `chartType: scatter`. Enumerate the 16 ids in 2.3,
   each mapped to the kind/chart-type render that shows it (chart line plus bar plus scatter, metric, collection, timeline, table).
   Also run the no-duplicate-id assertion in each of those renders.
3. **The 768px wording contradicts itself (design.md D6, ticket AC, tasks 1.6/1.7).** D6 scopes the fix to
   `@media (max-width: 768px)`, which includes a 768px viewport. The AC and task 1.7 say "no layout regression at 768". The wrapped
   mobile row will apply at 768, so a literal "no change at 768" check fails by design, and an executor could read it either way.
   Pick one and write it down. Either (a) 768 is inside the mobile branch, and "no regression" there means no overflow and the
   HEL-469/HEL-813 invariants hold, not "unchanged". Or (b) choose a narrower query so 768 is literally unchanged. In the same
   revision, D6 locks the fix to `TableDisplayFields.css` before the root cause is measured. Add that if measurement puts the
   cause elsewhere (e.g. the Configuration card or sheet padding/min-width in `OutputEditorSheet.css`), the fix goes where the
   root cause is, under the same C3 constraints. Otherwise the measure-first step can't change the plan.

### Non-blocking notes

- **D4 (label click opens the listbox):** acceptable. A `<button>` is labelable, label activation dispatches `click`, and both
  `openPanel()`'s `disabled` guard and the native disabled button make the edit-mode case a no-op. The rationale "matches
  labelled native controls" is inaccurate, though. Clicking the label of a native `<select>` focuses it but does not open it.
  Reword the rationale. The behaviour itself is fine.
- **D3's "each aria-label contains its visible label text" is false for one pair.** The label is "Color by field" but the
  aria-label is "Scatter color-by field" (`ChartDisplayFields.tsx:263-267`). This is pre-existing (WCAG 2.5.3 label-in-name) and
  out of scope under the "don't change aria-labels" non-goal. Worth adding to the follow-up ticket.
- **C3 and HEL-813:** once the column row wraps, check that the move buttons' 44px `::after` expanders don't overlap the format
  Select vertically, as well as horizontally.
