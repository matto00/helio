## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit `d1fc4fc1dc52a886e0bb87cd0e4327ae18179b86` on `feature/form-field-type-builder/HEL-1084`,
diffed against `origin/main` at `ab4cad578d05576beb3a19ef7244799db6953172` (resolved fresh via
`resolve-review-base.sh`, exit checked).

### What I verified (with evidence)

- **AC1, write API (D1(a)-(e), C2):** read `FormSchemaConsistency.scala` and the `PanelService.scala`
  diff directly. `rejectInconsistentForm` is wired into both `buildForCreate` (post-`validateConfig`)
  and `update` via `effectiveFormConfig` (the EFFECTIVE post-patch config, not the incoming patch alone
  — matches D1's explicit "a `dataSourceId`-only PATCH would skip re-validating the existing fields"
  concern). `FormPanelRoundTripSpec.scala` has a dedicated pinned test for exactly this case ("reject a
  PATCH that re-binds dataSourceId only to a dataset lacking an existing field — panel unchanged") plus
  csv-kind rejection, undeclared-field, unfit-control, bad-options (array/typed/non-empty), and
  bad-initialValue cases, each asserting the message names the offending field/value.
- **D2 fitness-matrix single source of truth:** confirmed `controlFitnessDriftGuard.test.ts` parses the
  real `FormPanel.scala` `FittingControls` literal by regex (not a hand-copied twin) and diffs it
  against `CONTROL_FITNESS`. I ran the test green, then mutated `FormPanel.scala`
  (`BooleanType -> Vector("checkbox", "select", "text")`) and re-ran — it failed with the exact
  expected diff, then reverted via `git checkout --`. The guard is real, not vacuous.
- **Focus-on-Remove fix (cycle-1 evaluation defect, cycle-2 fix):** read `useFormEditorState.ts`
  (`rowIds`/`rowKeys`, position-independent identity) and `FormEditor.tsx`'s `pendingFocusRowIndex`
  effect. Independently reproduced the exact original defect scenario live in the browser (not jsdom):
  started servers on this run's ports (6516/9423), confirmed via `readlink /proc/<pid>/cwd` that both
  the reused Vite (PID 1779583) and backend (PID 1779198) processes resolve to this worktree, opened
  the "Skeptic Form" panel's builder, added a field (focus landed on `Field for id`, confirming
  Add-focus), then removed the LAST row of the resulting 2-field list. `document.activeElement` landed
  on the remaining row's `Field for Note` select — not `document.body`. This matches evaluation-2.md's
  claim and independently confirms the fix holds under a fresh measurement.
- **Server/session hygiene:** confirmed both server PIDs' cwd resolve to this worktree; `location.href`
  was `http://localhost:6516/` throughout. The browser session is shared across prior review runs (many
  stray dashboards in the sidebar, matching the known parallel-Playwright hazard) — worked entirely
  within a dashboard clearly scoped to this ticket ("Skeptic AC Probe HEL-1083" containing "Skeptic
  Form"/"Focus Test 2" panels, evidently prior-review residue but isolated from my own probe).
- **Light/dark:** toggled `data-theme` to `light` and screenshotted the open builder — correct contrast,
  no broken layout, tokens applied.
- **Regression-check on schema/round-trip tests:** read `FormPanelRoundTripSpec.scala` in full — 20
  pinned scenarios spanning create, PATCH re-read (through real `rowToDomain`, not the in-memory create
  echo), export/import, and the agent (`apply-proposal`) path including a cross-owner-rejection case.

### Defect found — AC5 / design.md D7 error association, measured live (not jsdom)

Design.md D7 states: *"per-field issues through `FormField`'s `error` (`role="alert"`) plus
`aria-invalid`/`aria-describedby` on the control."* AC5 (derived) requires: *"validation errors are
associated with their field and announced (`role="alert"` / `aria-describedby`), not only colored."*

Live reproduction: switched the "Skeptic Form" panel's bound dataset to one lacking the existing `note`
field. The issue surfaced correctly as text (`role="alert"` paragraph: `'note' is not declared by the
bound dataset`, plus the summary alert) — but inspecting the actual DOM
(`document.querySelector('[aria-label="Field for Note"]').closest(...)`) shows:

```html
<div class="ui-form-field">
  <label class="ui-form-field__label">Field for Note</label>
  <div class="ui-select">
    <button type="button" role="combobox" ... aria-label="Field for Note"> ... </button>
  </div>
  <p class="ui-form-field__error" role="alert">'note' is not declared by the bound dataset</p>
</div>
```

The `<p role="alert">` carries **no `id`**, and the combobox trigger button carries **neither
`aria-invalid="true"` nor `aria-describedby`** pointing at it. Confirmed programmatically:
`document.querySelectorAll('[aria-invalid="true"]')` returns an empty NodeList anywhere in the open
builder, and `[aria-label^="Field for"]`'s `aria-describedby` attribute is `null`.

Root cause: the shared `frontend/src/shared/ui/FormField.tsx` component (pre-existing, untouched by
this diff — confirmed via `git diff ab4cad57...HEAD -- frontend/src/shared/ui/FormField.tsx` returning
empty) renders the error `<p>` with `role="alert"` but never assigns it an `id`, and never asks the
caller to wire `aria-invalid`/`aria-describedby` onto the control. `FormFieldRow.tsx` (this ticket's own
new file) passes `error={error}` into every `<FormField>` call site but adds no `aria-invalid`/
`aria-describedby` itself either — confirmed by grep across `FormFieldRow.tsx` (0 hits for either
attribute name). Grepping the two new frontend test files for these attribute names also returns zero
hits — this was never asserted anywhere, live or in jsdom.

**Why this matters, concretely:** `role="alert"` is a *live-region* announcement — it fires once, at
the moment the error node is inserted into the DOM (e.g., right after the dataset switch). It does
**not** create a durable programmatic association with the specific control. A screen-reader user who
tabs directly to the `Field for Note` combobox — without having been present for (or having correctly
parsed) that one-time live-region announcement — gets no indication via that control's accessible
state that it is invalid or why. This is exactly the "not only colored" bar AC5 sets, just for a
missing *programmatic* signal rather than a missing *visual* one; the ticket's own D7 promises the
`aria-invalid`/`aria-describedby` half specifically, and it is absent. Both evaluation-1.md and
evaluation-2.md's Phase 3 checks verified the error text/role="alert" *presence* live but never checked
the specific `aria-invalid`/`aria-describedby` wiring the design doc committed to — this is the gap a
cold, adversarial pass is for.

### Verdict: REFUTE

### Change Requests

1. **`frontend/src/features/panels/ui/editors/FormFieldRow.tsx`** (and/or
   `frontend/src/shared/ui/FormField.tsx` if the fix belongs in the shared component): wire
   `aria-invalid="true"` and `aria-describedby` pointing at the error paragraph's `id` onto the
   `sourceField` select trigger (and any other control `FormField` wraps that can carry a per-field
   error) whenever `error` is non-null. `FormField.tsx` needs to generate/accept a stable `id` for its
   error `<p>` (e.g., via a `useId()`-derived id or an accepted `errorId` prop) and expose it so
   `FormFieldRow.tsx` can thread it onto the control it wraps — the current `FormField` API has no way
   for a caller to do this correctly today. Add a computed-accessible-state assertion (e.g.
   `expect(control).toHaveAttribute("aria-invalid", "true")` /
   `toHaveAccessibleDescription(...)`) to `FormFieldRow.test.tsx` so this doesn't silently regress —
   per MISTAKES.md, a presence assertion is not sufficient; assert the actual computed state.
   Screenshot evidence at
   `/home/matt/Development/helio/.concertino/runs/HEL-1084/evidence/openspec/changes/form-field-type-builder/evidence/skeptic-a11y-note-error.png`.

### Non-blocking notes

- `evaluation-2.md` is present but untracked (`git status --short` shows `?? .../evaluation-2.md`) —
  worth committing alongside the fix so the review trail is reproducible from a clean checkout; not
  blocking since `evaluation-1.md` (tracked) and the diff themselves are sufficient to verify cycle 2's
  fix independently, which I did.
- The rest of the ticket is strong: the write-API consistency check, the drift-guarded fitness matrix,
  the picker's two-step Form flow, and the focus-on-Remove fix are all real, correctly-scoped, and
  independently reproduced. The one gap is narrow and localized to error-control association.
