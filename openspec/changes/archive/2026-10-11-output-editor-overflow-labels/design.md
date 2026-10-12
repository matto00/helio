## Context

HEL-1432 (2951d0b8, archive `openspec/changes/archive/2026-10-09-output-editor-label-overflow/`) added `id?: string`
to `frontend/src/shared/ui/Select.tsx` (applied to the combobox trigger only) and wired the Output-editor labels.
Its overflow fix lives in `frontend/src/features/panels/ui/editors/TableDisplayFields.css` inside
`@media (max-width: 768px)`: `min-width: 0` on `__row`, `__column-list-container`, `__column-row`, a
`minmax(0, 1fr)` track on `__column-list`, plus the phone wrap layout (`flex-wrap`, `__column-visibility` `flex: 1 1
100%`, 44px `__column-move` line). At >768px none of the shrink rules apply, so the list's auto grid track floors at
the longest row's min-content and `.table-display-fields__column-key` (`white-space: nowrap`, ellipsis) never gets to
ellipsize — the ticket measured 23–229px overflow at 1100/1440. `__column-key` has no `title`.

Seven literal `htmlFor` targets have no element id (whole-tree sweep at 5b99a846b; see ticket.md): AddRootModal.tsx:88,
DividerEditor.tsx:90, FormEditor.tsx:196, ImageEditor.tsx:157, CreatePipelineModal.tsx:177,
PipelineScheduleDialog.tsx:280, RestApiForm.tsx:78. Each label sits beside a shared `Select` that has an `ariaLabel`.
HEL-1465 (LookupConfig) and HEL-1489 (WindowConfig) established `useId()`-derived ids over hardcoded literals.

`ChartDisplayFields.tsx:266-271`: label "Color by field" (`htmlFor="scatter-color-field"`) on a Select whose
`ariaLabel="Scatter color-by field"`; `aria-label` wins name computation, and "Color by field" is not a substring of
it (the hyphen) — WCAG 2.5.3 fails. Consumers: `ChartDisplayFields.test.tsx:80`, `OutputEditorSheet.labels.test.tsx:175`,
`__snapshots__/OutputEditorSheet.openingState.test.tsx.snap:312`.

## Goals / Non-Goals

**Goals:** table options inside the card at every width with no sheet horizontal scroll; the seven labels associated
via `useId()`; "Color by field" contained in its accessible name; red-first tests; running-app evidence.

**Non-Goals:** HEL-1500 item 4 (reference-mark rows); renaming accessible names that already contain their label text;
changing the ≤768px wrapped layout; a permanent source-text guard for literal `htmlFor` (text-matching guards are not
rendered evidence — the sweep is recorded once as evidence instead).

## Decisions

**D1 — Shrink rules become unconditional; the phone wrap stays width-gated.** Move `min-width: 0` (`__row`,
`__column-list-container`, `__column-row`) and `grid-template-columns: minmax(0, 1fr)` (`__column-list`) out of the
media query into the base rules. Keep the wrap/stack/44px-line rules inside `@media (max-width: 768px)` (DESIGN.md
§3/§4: layout gates on width, tap-target rules on the touch gate). Measurement-led per the systematic-debugging law:
before editing, measure at 1100 and 1440 (both themes) which element's right edge exceeds the card content box and
its computed `min-width`; if an ancestor outside this file (e.g. the Configuration card or `OutputEditorSheet.css`
grid item, or the density row's `1fr 1fr` → `minmax(0, 1fr) minmax(0, 1fr)`) is part of the cause, fix it there,
token-only. Desktop row shape is otherwise unchanged (name ellipsizes; format wrapper stays 140px, HEL-469; move gap
stays `--space-4`, HEL-813). Alternative rejected: wrapping long names onto multiple lines at desktop — changes the row
shape and grows each row; ellipsis + title is the established pattern here.

**D2 — Full name via `title`.** `<span className="table-display-fields__column-key" title={column.key}>`. The
checkbox's accessible name already includes the full text (span text content), so screen readers lose nothing; `title`
gives pointer users the full name. Alternative: the shared tooltip component — use it instead only if DESIGN.md names
one as the standard for truncated text (executor checks and records which applies).

**D3 — `useId()` ids for the seven sites.** In each component: `const <name>Id = useId();`, `htmlFor={<name>Id}` and
`<Select id={<name>Id} …>`. The literal ids disappear. Before removing, grep `frontend/`, `e2e/` and CSS for each
literal as a selector (`#add-root-source`, `[for=…]`, `getElementById("…")`) and update any consumer. Where a label is
rendered even when its Select is not, see D3a.

**D4 — Keep the seven existing `ariaLabel`s.** Each already contains its label's text (Data source; Divider
orientation ⊃ Orientation; Bound dataset ⊃ Dataset; Image fit; Schedule kind; Method; CreatePipelineModal's is
verified by the executor). Changing them would churn names for no 2.5.3 gain.

**D5 — Color-by name becomes "Scatter color by field".** Drops the hyphen so the visible "Color by field" is contained
(case-insensitive), consistent with its sibling "Scatter point size field". Update the three consumers deliberately
(test expectation and snapshot line), never loosen a matcher. Alternative: "Color by field" exactly — rejected for
inconsistency with the sibling and loss of the chart-type disambiguation the sibling relies on.

**D5a — Audit every Output-editor label for 2.5.3; fix "Bins" (design-gate REFUTE 1).** The new spec requirement
covers every associated Output-editor label, so the executor audits each one under `pipelines/ui/outputEditor/` and the
four `panels/ui/editors/*` components it renders (label text vs computed accessible name) and records the table as
evidence. Known violation: `HistogramBinCountField.tsx:41-54` label "Bins" vs `aria-label="Bin count"` → change the
`aria-label` to "Histogram bins" (contains "Bins", consistent with the "Scatter …" prefix pattern). Deliberately update
the five `{ name: "Bin count" }` queries in `OutputEditorSheet.heatmapHistogram.test.tsx` and
`e2e/hel1311-heatmap-histogram-charts.spec.ts:500`. Any further violation the audit finds is fixed the same way
(make the name contain the label text, minimal churn) and listed in the evidence; if one needs a visible-text change
instead, stop and report it rather than deciding.

**D3a — No dangling `for` in the no-sources branch.** AddRootModal/CreatePipelineModal render the "Data source" label
even when `noSourcesYet` hides the Select; use `htmlFor={noSourcesYet ? undefined : id}` so no state points at nothing.

**D6 — Red-first tests through the label element.** `getByLabelText` also matches `aria-label`, so for labels whose
text equals the `ariaLabel` (Data source, Image fit, Schedule kind, Method) it is green pre-fix. Each test therefore
finds the `<label>` (`getByText(text, { selector: "label" })`), asserts `label.htmlFor` is non-empty and
`document.getElementById(label.htmlFor)` is the combobox found by role + accessible name; it also keeps
`getByLabelText` as the ticket asks. One instance-uniqueness test per component where two can mount (render two,
assert ids differ). A 2.5.3 test per fixed control (color-by, Bins) asserts the accessible name contains the label text. Red is
measured on the WHOLE pre-fix tree (all non-test sources at the base SHA, new tests present).

**D7 — Running-app evidence.** Before/after at 375/768/1024/1100/1440, light and dark, with a 49-char and an 86-char column
name: card content-box right vs each control's right, sheet `scrollWidth` vs `clientWidth`, column-key width > 0, move
buttons' 44px expanders not overlapping the format select (≤768), title present. Keyboard: Tab reaches each of the
seven comboboxes and the color-by combobox; clicking each label opens/focuses its control; accessible names read from
the accessibility tree. Self-registered throwaway `@example.test` user (id recorded up front; verify logged-in
identity before every probe; never the owner's account); fixtures deleted by exact id. Evidence goes to
`/home/matt/Development/helio/.concertino/runs/HEL-1464/evidence/`; move any `.playwright-mcp/` files there.

## Risks / Trade-offs

- Unconditional `min-width: 0` lets the row shrink; a 0px name is the HEL-469 failure mode — guarded by D7's
  non-zero column-key width measurement at every width.
- HEL-1305 (charts lane) may touch `ChartDisplayFields.tsx`; re-sync with origin/main before PR.

## Planner Notes

- Self-approved: D5/D5a name choices; `title` over a tooltip unless DESIGN.md says otherwise (D2); no source-text guard.
- Premise re-derived from main at 5b99a846b: the seven sites are unchanged; no new literal dangling labels; HEL-1307/
  1311 Output-editor labels have matching template-literal ids.
