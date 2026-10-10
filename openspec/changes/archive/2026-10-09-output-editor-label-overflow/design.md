## Context

`frontend/src/shared/ui/Select.tsx` renders a `<button role="combobox">` trigger plus a portal listbox. It accepts
`ariaLabel`/`ariaDescribedBy`/`ariaInvalid`/`ariaRequired` but no `id`, so every `<label htmlFor="x">` placed beside a
`Select` points at nothing. A planning-time scan (`htmlFor` literals with no matching `id=` in `frontend/src`) found 23
dangling targets; 16 render inside the Output editor sheet (enumerated in ticket.md), all on `Select`. Since HEL-1430,
the editor is split across `outputEditor/OutputEditorSheet.tsx` (Name/Step/Kind), `OutputKindConfigCard.tsx`,
`OutputKindFields.tsx`, and four `panels/ui/editors/*` components (`TableDisplayFields`, `ChartDisplayFields`,
`ChartAggregationFields`, `MetricValueEditor`), each of which has exactly one non-test caller: `OutputKindFields.tsx`.
HEL-1388 gave the locked Kind control `ariaDescribedBy={kindHintId}` in edit mode; that must keep working.

Overflow: a table Output's Configuration card renders `TableDisplayFields`. Its CSS (`TableDisplayFields.css`) has a
`1fr 1fr` grid density row and a flex column row = visibility label (`flex:1; min-width:0`) + format wrapper
(`width:140px; flex-shrink:0`, HEL-469) + move group (28px icon buttons — 2, or 4 when a table has more than 8 columns —
`gap: var(--space-4)`, HEL-813, `flex-shrink:0`). Fixed non-shrinking widths alone are ~300px+ before row/list/card/sheet padding; hypothesis only —
root cause must be confirmed by measurement in the running app (systematic-debugging law).

## Goals / Non-Goals

**Goals:** `Select` `id` pass-through; every dangling label inside the Output editor associated; table options fit the
card at 375px in both themes with no regression at 768/1100/1440.

**Non-Goals:** the 7 dangling targets on other surfaces; changing any `aria-label`/accessible name; making Cell density
functional for Outputs; redesigning the column row.

## Decisions

**D1 — `id?: string` on `Select`, applied only to the trigger button.** `<button id={id} ...>`; when `id` is
`undefined` React renders no attribute, so all ~85 other call sites are byte-identical in the DOM. The listbox/option ids
stay derived from `useId()` (`${baseId}-listbox`, `${baseId}-option-N`) — unchanged and cannot collide with caller ids.
Alternative rejected: always emitting `id={baseId}` would add a new id to every caller (ticket: "nothing gets a
duplicate or changed id").

**D2 — Reuse the existing `htmlFor` literals as the ids.** No label text or `htmlFor` changes; each component passes
the id its label already names. `output-slot-${slot.key}` is passed as the same template literal. Uniqueness: one
editor sheet is mounted at a time and each component renders once per sheet; verified by a test asserting no duplicate
`id` in the rendered sheet for each kind exercised. These panels/ui/editors components have a single caller today; if
a second caller ever mounts one twice, hardcoded ids would collide — noted as a risk, not engineered for now (YAGNI).

**D3 — Keep every existing `ariaLabel`.** `aria-label` wins over `<label>` in accessible-name computation, so screen
reader names are unchanged (guarded by the HEL-1430 `OutputEditorSheet.openingState` snapshot, which keys controls by
accessible name); the association adds label-click activation and label-element resolution. One pre-existing
label-in-name mismatch ("Color by field" vs aria-label "Scatter color-by field") is out of scope → follow-up.

**D4 — Label click opens the listbox.** A `<button>` is a labelable element; clicking its `<label>` dispatches a click to
it, which toggles the Select open (disabled → no-op). This enlarges the hit target; accepted. (A native `<select>`'s label only focuses it, so this is a difference from native, not parity; it
mirrors labelled buttons/checkboxes.) Covered by a test (clicking the "Kind" label in create mode opens the listbox; in edit mode it
does nothing).

**D5 — Locked Kind keeps `aria-describedby`.** Kind gets `id="output-kind"` in both modes; `ariaDescribedBy` logic is
untouched. Test asserts `getByLabelText("Kind")` is disabled and its accessible description is the hint.

**D6 — Overflow fix is measurement-led and CSS-only, placed where the root cause is.** First measure in the running
app at 375px (both themes): the Configuration card's content-box right edge vs. each row's/control's
`getBoundingClientRect().right`, and identify the widest offending element and why it can't shrink. The fix goes where
the measured cause lives — expected `TableDisplayFields.css`, but if the cause is the card/sheet (e.g. padding or a
min-width in `OutputEditorSheet.css`), it goes there, under the same C3 constraints. The wrap/stack rules are phone-shaped LAYOUT, so
they are gated on viewport width ONLY — `@media (max-width: 768px)` — not on the combined touch gate
`@media (max-width: 768px), (pointer: coarse)` (DESIGN.md §3 "Gate on the input device, not the viewport" and §4: the
touch gate belongs on tap-target rules only; a coarse-pointer iPad Pro at 1100px+ has desktop room and must get the
desktop layout). The 44px move-group `min-height` is part of the wrapped layout and goes with it. 768px is INSIDE that branch: there "no regression" means no overflow and the HEL-469 /
HEL-813 invariants hold (a changed row shape is expected); at 1100 and 1440 the layout must be unchanged (before/after
measurement). Likely shape (to be confirmed): let the column row wrap so the format select and move group sit beneath the
column name, and collapse the density row to one column. Binding: HEL-469 (column name/checkbox never 0px), HEL-813
(move gap stays `--space-4`, ≥ 44px tap target), and after wrapping, the move buttons' 44px `::after` expanders must not
overlap the format Select vertically or horizontally.

**D7 — Evidence.** Association is proved through the `<label>` element itself, not `getByLabelText` alone:
`getByLabelText` also matches `aria-label`, and for "Chart type", both "Format"s and "Cell density" the label text equals
the Select's `ariaLabel`, so it already resolves pre-fix. For each in-scope id: find the `<label>` (by text with
`selector: "label"`, or by `htmlFor`), assert `document.getElementById(label.htmlFor)` is the expected combobox (found by
role + accessible name). `getByLabelText("Kind")`/`("Step")` are kept as the ticket asks (they are red pre-fix). Red-first tests are measured red on the WHOLE pre-fix tree (all non-test sources at the base SHA,
new tests present), never by dropping one old file into the fixed tree. Layout before/after measurements and screenshots
(375 light/dark; 768/1100/1440) go to `/home/matt/Development/helio/.concertino/runs/HEL-1432/evidence/`, never the
worktree root. Dev-DB fixtures use a throwaway user; every created id is recorded and deleted only by exact id.

## Risks / Trade-offs

- Hardcoded ids in shared editor components (D2) collide if ever mounted twice — mitigated by the no-duplicate-id test.
- Label-click now opens the dropdown (D4) — a small behaviour change (a native `<select>`'s label only focuses it).
- A breakpoint-scoped wrap changes the mobile row shape; desktop untouched, verified at 768/1100/1440.

## Planner Notes

- Self-approved scope extension: 14 additional dangling labels on the same surface (same defect, one prop each).
  Remaining 7 on other surfaces → follow-up ticket.
- No `.husky/**` or gate-chain change; no gate-chain checklist needed.
- No API/schema change; no spec change to `Select` beyond the editor-level requirement.
