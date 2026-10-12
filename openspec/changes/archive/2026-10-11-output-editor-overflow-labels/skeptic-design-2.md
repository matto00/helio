## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 5b99a846b83f23d983aadc315139c94f31901497 (planning artifacts untracked in the change dir). Static review only.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/output-editor-overflow-labels/HEL-1464`.
- **Seven dangling labels (AC2):** I wrote my own sweep. For every literal `htmlFor="x"` in `frontend/src/**/*.tsx`, it looks for `id="x"` or `id: "x"` in any .ts/.tsx file. It prints exactly seven DANGLING ids: add-root-source, divider-orientation, form-editor-dataset, image-fit, pipeline-source, schedule-kind, source-method. That matches ticket.md and design.md.
- **The seven sites, read directly:**
  - Each one is a `<label htmlFor=literal>` next to a shared `Select` with no `id`.
  - None of the seven files imports `useId` yet.
  - D4's claim holds: each existing `ariaLabel` contains its label text (case-insensitive). Data source, Divider orientation, Bound dataset, Image fit, Schedule kind, Method.
- **D3a (round-1 note, now planned):**
  - AddRootModal.tsx:88-98 and CreatePipelineModal.tsx:177-193 both render the label unconditionally. Both render the Select only when `!noSourcesYet`.
  - `htmlFor={noSourcesYet ? undefined : id}` is correct and minimal.
  - The other five sites render label and Select together, so they need no conditional.
- **D5 color-by:**
  - `ChartDisplayFields.tsx:266/271` has the label "Color by field" and `ariaLabel="Scatter color-by field"`.
  - "Scatter color by field" contains "Color by field" case-insensitively.
  - A grep of `frontend/src` and `e2e` for the old name finds exactly the three consumers D5 lists: test :80, labels test :175, snapshot :312. There is no e2e consumer.
- **D5a "Bins":**
  - `HistogramBinCountField.tsx:41-54` has the label "Bins" (literal id that matches) and `aria-label="Bin count"`. Confirmed as a violation.
  - A grep for "Bin count" finds exactly the consumers D5a names: `OutputEditorSheet.heatmapHistogram.test.tsx` 189/207/222/237/251 and `e2e/hel1311-heatmap-histogram-charts.spec.ts:500`. No snapshot contains it.
  - "Histogram bins" contains "Bins" and follows the existing `ChartSlotFields` "Histogram field" prefix pattern.
  - The control is `type="number"`, so the spec scenario's "spinbutton" role is right.
- **Independent label-in-name audit of every associated Output-editor label:** this checks whether the D5a premise that only two pairs fail is true.
  - I paired each `<label htmlFor>`/`FormField` label in `pipelines/ui/outputEditor/*` and in the panels editors it imports with its control's name:
    - ChartDisplayFields, TableDisplayFields, MetricValueEditor, ChartAggregationFields, BoundOrLiteralField: Annotation, Orientation/Bar orientation, Stacking/Bar stacking, Point size field/Scatter point size field, Cell density, Field/Value field, Reduce/Reduce function, Group by/Group by field, Value field/Aggregation value field, Function/Aggregation function.
    - OutputEditorSheet: Name (no aria-label), Step/Target step, Kind/Output kind.
    - OutputKindFields and OutputKindConfigCard: Chart type, Format x2, slot `${label} field`.
    - ChartSlotFields: `${label} field`, Field/Histogram field.
    - ConditionalFormatsField: `Rule n column/condition/value/from/to/colour/applies to/label`.
  - Every pair passes except color-by and Bins.
  - ChartCompareField's "Compare" is an unassociated `<span>` with a matching aria-label, so it is out of the requirement's scope.
  - Conclusion: after the planned fixes, the new general 2.5.3 requirement will be true. The round-1 REFUTE is resolved soundly, not just reworded.
- **D1 overflow mechanism (`TableDisplayFields.css`):**
  - All the shrink rules sit only inside `@media (max-width: 768px)`.
  - Above 768px, the `__column-list` grid track is auto, and the `__column-key` `nowrap` min-content sets its floor.
  - D1 hoists only `min-width: 0` and the `minmax(0, 1fr)` list track. The density-row stack, wrap, and 44px line stay gated, which is consistent with DESIGN.md §3/§4.
  - Measuring before fixing an out-of-file ancestor is the right law-conformant approach.
- **1024px width (round-1 note):**
  - Above 768px the row does not wrap. The 140px format wrapper and the move group are `flex-shrink: 0`, so the name span is the only element that can shrink. That makes 1024 the riskiest desktop width for HEL-469.
  - It is now in AC1, in the spec scenario "at 1100px and 1024px … keeps a non-zero width", and in D7's non-zero column-key measurement. That covers the risk.
- **D2 `title`:** DESIGN.md:433-440 makes native `title` the tooltip pattern. There is no shared tooltip component. A `title` on the span does not change the checkbox's name, which comes from the span's text content.
- **D6 red-first:**
  - Before the fix, `label.htmlFor` is a non-empty literal and `getElementById` returns null, so the test is red.
  - The 2.5.3 assertions are red before the fix: "Scatter color-by field" does not contain "Color by field", and "Bin count" does not contain "Bins".
  - The reason given for going through the `<label>` element (`getByLabelText` also matches `aria-label`) is correct.
- **Spec deltas:**
  - The ADDED requirement names don't collide with the existing `openspec/specs/pipeline-output-sheet/spec.md` names (":178 associated with their controls", ":192 … on a narrow viewport").
  - `labelled-select-controls` is a new capability.
  - Coverage: AC1's 375 no-regression is covered by the existing :192 requirement plus D7. AC1's 768 is covered by D7 evidence.
- **AC to task coverage:**
  - AC1 → 1.1–1.3, 2.5
  - AC2 → 1.4–1.6, 2.1, 2.3, 2.4
  - AC3 → 1.7, 1.8, 2.2
  - AC4 → C2, 2.5
  - No AC is uncovered, and I found no scope drift. Non-goals are explicit (HEL-1500 item 4).
- **Placeholders/contradictions:**
  - There are no TODO/TBD markers.
  - D2's "use the tooltip component if DESIGN.md names one" is already settled: it doesn't, so use `title`.
  - D4's "CreatePipelineModal's ariaLabel is verified by the executor" is already settled: it is "Data source".

### Verdict: CONFIRM

### Non-blocking notes

- **D3a has no test of its own.** Add a small assertion to task 2.1: in the `noSourcesYet` state of AddRootModal and CreatePipelineModal, the "Data source" label has no `for` attribute. The literal-sweep requirement cannot catch a dynamic dangling `for`, so without this test D3a has no acceptance signal.
- **D6 instance-uniqueness is "where two can mount".** For the two modals, that may need two portal-rendered instances. If any component is skipped, record which one and why in the evidence, rather than leaving the omission silent. Assert that both ids are non-empty, not only that they differ.
- **`useId()` placement.** Each hook must sit above any early return (rules-of-hooks). The lint gate will catch a violation; just don't resolve it with an `eslint-disable` (C2).
- **HEL-1305 collision.** HEL-1305 may still touch `ChartDisplayFields.tsx`. Re-sync with origin/main before the PR, as design.md already notes.
