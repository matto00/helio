## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 5b99a846b83f23d983aadc315139c94f31901497 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/output-editor-overflow-labels/HEL-1464`.
- **Seven dangling labels (AC2 premise):** I ran my own sweep over `frontend/src` (every literal `htmlFor="x"` with no `id="x"` / `id: "x"` anywhere). It found exactly seven:
  add-root-source, divider-orientation, form-editor-dataset, image-fit, pipeline-source, schedule-kind, source-method.
  That matches ticket.md and design.md, and the file:line citations are right (AddRootModal.tsx:88, DividerEditor.tsx:90, FormEditor.tsx:196, ImageEditor.tsx:157, CreatePipelineModal.tsx:177, PipelineScheduleDialog.tsx:280, RestApiForm.tsx:78).
- **No selector consumers of the literals:** I grepped `frontend/` and `e2e/` for each literal. The only hits are the label sites themselves, plus unrelated `"pipeline-source"` strings in `unresolvedConnectorRefs` and `InlineConnectorSetup.test` (a connector-ref key, not a DOM id). So D3's swap to `useId()` breaks nothing.
- **D4 (existing ariaLabels already contain their label text):** I read each site and confirmed it: "Data source" x2, "Divider orientation" ⊃ "Orientation", "Bound dataset" ⊃ "Dataset", "Image fit", "Schedule kind", "Method". CreatePipelineModal's is "Data source", so the deferred "executor verifies" is already settled.
- **`Select` `id` support:** `shared/ui/Select.tsx:39` has `id?: string`, applied at :165 on the trigger. The one-line fixes are viable.
- **D5 color-by:** confirmed at `ChartDisplayFields.tsx:266-271`. "color by field" is not a substring of "scatter color-by field". "Scatter color by field" fixes it case-insensitively. The three consumers listed are exact and complete: `ChartDisplayFields.test.tsx:80`, `OutputEditorSheet.labels.test.tsx:175`, `__snapshots__/OutputEditorSheet.openingState.test.tsx.snap:312`.
- **D1 overflow mechanism:** read `TableDisplayFields.css`. All the shrink rules (`min-width: 0` on row/container/column-row, and the `minmax(0, 1fr)` list track) sit only inside `@media (max-width: 768px)`. At desktop the list track is `auto` and the column-key's nowrap min-content floors it, which is consistent with the ticket's measurements. D1's measure-first contingency for ancestors outside this file is appropriate.
- **D2 `title`:** DESIGN.md:433-440 sets native `title` as the tooltip pattern. There is no shared tooltip component in `shared/ui`, so `title` is correct.
- **D6 red-first:** the reasoning is correct. `getByLabelText` also matches `aria-label`, so it would pass before the fix for "Data source" / "Image fit" / "Schedule kind" / "Method". Querying through the `<label>` element and calling `getElementById(htmlFor)` returns null before the fix, so the test is red as intended.
- **Spec deltas:** the ADDED requirement names do not collide with the existing `openspec/specs/pipeline-output-sheet/spec.md` requirements ("...on a narrow viewport" at :192, "...associated with their controls" at :178). `labelled-select-controls` is a new capability with no existing spec.
- **2.5.3 sweep of every Output-editor label/control pair** (labels test pairs, plus ChartSlotFields, OutputKindFields, OutputKindConfigCard, OutputEditorSheet, ConditionalFormatsField, HistogramBinCountField). Two pairs fail containment: the planned color-by pair, and **one the plan does not mention** (see CR 1).

### Verdict: REFUTE

### Change Requests

1. **The new 2.5.3 requirement would be false when this ships: "Bins" / "Bin count".**
   - The requirement in `specs/pipeline-output-sheet/spec.md` is general: "A visible Output-editor field label associated with a control SHALL have its text contained in that control's accessible name".
   - `frontend/src/features/pipelines/ui/outputEditor/HistogramBinCountField.tsx:41-54` violates it. The label "Bins" (`htmlFor="output-histogram-bins"`, matching `id`) sits on a TextField with `aria-label="Bin count"`, and "bins" is not a substring of "bin count". This field is rendered in the Output editor via `OutputKindFields.tsx`.
   - The premise validation missed this: it checked only the color-by pair and its sibling.
   - Resolve the contradiction with one of these two options. Record the choice in design.md either way.
     - (a) **Preferred: include the fix.** It is the same defect class, about one line. Rename the accessible name so it contains "Bins" (e.g. "Histogram bins"), or drop the `aria-label` so the associated label names it. Update the five `{ name: "Bin count" }` queries in `OutputEditorSheet.heatmapHistogram.test.tsx` (189, 207, 222, 237, 251) deliberately. Add a red-first 2.5.3 assertion for it next to task 2.2, and add a task line.
     - (b) **Narrow the requirement.** Limit it to the scatter color-by control, and file a Follow-up ticket for "Bins" with a relatedTo link back to HEL-1464.
   - As written, the plan ships a spec requirement that the shipped code contradicts.

### Non-blocking notes

- **D3, `noSourcesYet` branch:** in AddRootModal and CreatePipelineModal the label still renders while the `Select` does not. After the change, the label's `htmlFor` points at an id with no element, which is the ticket's own "label points at nothing" defect, just not detectable by a literal sweep. `htmlFor={noSourcesYet ? undefined : id}` is a cheap fix. Deferring it is defensible, but say so in the PR body rather than only in design.md.
- **D1/D7, widths between 769 and 1099px:** with `min-width: 0` now unconditional and the desktop row unwrapped (140px format wrapper plus move group, neither shrinkable), the name span is the only thing that can shrink. At a viewport just above 768px with a narrow card, it could approach 0px, which is the HEL-469 failure mode. Add one intermediate width (e.g. 800 or 1024) to D7's non-zero column-key measurement.
- **Spec wording:** the proposal lists `pipeline-output-sheet` under "Modified Capabilities", but the delta uses `## ADDED Requirements`. That is fine, since adding requirements modifies the capability. Just make sure archive sync treats them as additions.
- **HEL-1305 collision:** HEL-1305 may touch `ChartDisplayFields.tsx`. Re-sync with origin/main before the PR, as design.md already notes.
