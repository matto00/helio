# Evaluation Report — Cycle 1 (evaluation-1.md)

HEAD `5745f68f`; diffed against `a6bde0d3` (`origin/main`).
Dev servers: DEV_PORT=5176 / BACKEND_PORT=8086 (not recorded in `workflow-state.md`; assigned
to avoid the ports other live lanes hold).

## Phase 1: Spec Review — FAIL

Mostly sound. The design's four-consumer coherence (D6) is implemented as designed and I
confirmed it live, not only in unit tests (see Phase 3). Findings:

1. **Task 4.1a is marked `[x]` but is violated.** It requires locale/TZ pinning in
   "any `TableRenderer`/`DataGrid` test that asserts rendered cell text for a formatted
   column", not the formatter unit tests alone. `TableRenderer.test.tsx`'s new block pins
   neither. Measured, not inferred — see Change Request 1.
2. Tasks 5.2 / 5.3 are correctly left `[ ]` and were not fabricated. Both are now run (Phase 3)
   and 5.2 **fails**.
3. Everything else in §1–§4, §6–§8 matches what was implemented. Spot-checked and confirmed:
   - `columnFormats` is a flat sibling on `TableOutputConfig`, **not** added to
     `OutputService.scala:272`'s `mergeableSubObjects` (still the same four chart keys), so
     `{}` is a whole-key replace. Verified live end-to-end (Phase 3).
   - `TableRenderer.tsx:127-130`'s stale HEL-448 comment (task 3.2b) and
     `tableFilterPredicate.ts:5-9`'s match-source contract (task 3.5) are both rewritten and
     now describe what the code actually does.
   - `sortColumns` is untouched; `formattedColumns` is a separate array consumed only by
     `DataGrid`'s `columns` prop.
   - The "applies in exports" drop and the HEL-451-supersedes-the-deferral correction are
     reflected consistently in ticket/proposal/tasks/design.

## Phase 2: Code Review — FAIL

Gates re-run by me in `WORKTREE_PATH`, not taken from the executor's report:

| gate | result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm --prefix frontend test` | PASS — 294 suites / 3097 tests (matches the claim) |

Backend untouched (`git diff --name-only` has no `backend/**`), so `sbt test` is N/A.

### Guard mutations — re-run by me, both genuinely failable

- **Sort guard (task 3.2).** Re-pointed the call site `TableRenderer.tsx:297`
  `getValue: (row) => getSortValue(row[col.key])` at the resolved per-column formatter.
  RED: 2 tests, including *"3.2 PROOF/GUARD: a currency column sorts numerically (raw), not
  by its formatted text"*. Restored; worktree verified clean.
- **Filter guard (task 3.5a).** Reverted `cellMatches` to bare `formatCell(value)`.
  RED in **both** directions: the formatted-term test and the raw-term test. Restored.

So the executor's two mutation claims are confirmed by my own run, not accepted on report.

### Blocking finding

**Locale fragility in `TableRenderer.test.tsx` (task 4.1a).** `columnFormatting.test.ts` pins
correctly (explicit `locale`/`timeZone` args). `TableRenderer.test.tsx` does not: production
`resolveColumnFormatter(spec)` is called with no `intl`, so every rendered-text assertion
inherits the host locale.

Measured, not argued:

```
$ LANG=de-DE npx jest --config jest.config.cjs --testPathPatterns="TableRenderer|columnFormatting"
Tests: 5 failed, 76 passed, 81 total
```

`columnFormatting.test.ts` passes; all 5 failures are in the new HEL-469 block, and they
include **both of the ticket's central guards**:

- `task 2 AC: a column set to currency renders $1,234.56-style values`
- `3.2 PROOF/GUARD: a currency column sorts numerically (raw), not by its formatted text`
- `formatting a column does not change the row order of an already-sorted column`
- `3.5 PROOF/GUARD: a currency-formatted column's filter matches the FORMATTED text, not the raw value`
- `a malformed/unrecognised columnFormats entry is ignored, rendering that column unformatted`

Rendered cell text under `LANG=de-DE` is `1.234,56 $`, not `$1,234.56`. This is exactly the
"defect wearing a green check" `workflow-state.md` and design D4 name, sitting on the guards
built to prevent the ticket's other defect.

### Non-blocking code observations

- `useOutputColumnFormats.ts` rebuilds `columnFormats` from `selections` as `{ type }` only,
  and seeds `selections` from `spec.type` only. A persisted spec carrying `decimals`,
  `currency` or `datePattern` (which `readColumnFormats` reads and the formatter honours) is
  **destroyed** by any unrelated Save of that Output — not merely un-editable. This is
  adjacent to, but distinct from, the already-escalated "UI exposes format TYPE only" gap
  (that one is "cannot set"; this one is "silently discards"). Recorded for the owner's
  in-flight decision; **not** a change request here.
- `DataGrid.tsx:728` now always builds a `style` object for the `th` (`{...width, ...align}`),
  where it previously passed `undefined` when there was no width. Verified harmless: an
  unformatted column's `th` still renders `style="width: 160px;"` and its `td` renders no
  `style` attribute at all (measured live), so the DOM is unchanged for existing consumers.
- `useOutputColumnFormats` seeds via a lazy `useState` with no re-seed path, unlike its
  sibling `useOutputTableColumns` (which carries a `builtKey` rebuild). Checked and **not** a
  defect: `PipelineDetailPage.tsx:315` mounts the sheet conditionally (`{outputSheet && …}`)
  and `usePipelineDetailPage.ts:565` captures the `output` object at open time, so the seed is
  always present on first render. Noted only so a future reader does not re-derive it.

Everything else in the code-review checklist passes: the shared resolver (D6b) is genuinely
one function used by both consumers, `readColumnFormats` is tolerant and never throws,
`formatColumnValue` has a real `try/catch` fallback (exercised by a malformed currency code),
no `any`, no dead code, no scope creep into `MetricRenderer`/`chartAppearance`/`usePanelData`,
and no special case for `"[object Object]"`.

## Phase 3: UI Review — FAIL

**Content self-authentication (task 5.3), before any observation.**
`resolveColumnFormatter` has 0 occurrences on `a6bde0d3`. `GET localhost:5176/src/features/panels/ui/renderers/columnFormatting.ts`
returns this worktree's module (HEL-469 header comment + the resolver); the same path on
another live lane's port (5174) returns **404**. The port is serving this branch.

### What passes — measured, both themes

**Rendered geometry, header + cell together (task 5.2/design D3a).** With
`columnFormats` persisted on a real Output (`player_id` → currency USD, `last_modified` →
number/2dp, `category` → text), measured on the live grid:

| column | th computed | td computed | header right gap | cell right gap |
| --- | --- | --- | --- | --- |
| `player_id` (currency) | `right` | `right` | 12.0px | 12.0px |
| `last_modified` (number) | `right` | `right` | 12.0px | 9.1px* |
| `category` (text) | `left` | `start` | — | — |
| `company` (no spec) | `left` | `start` | — | — |

\* width-constrained/ellipsed, not misaligned.

Header and cell agree on every formatted column — the specific defect this task exists to hunt
(right-aligned cells under a left-aligned header) does **not** occur. Attribute-level check:
an unformatted column's `td` has no `style` attribute and its `th` keeps only `width: 160px;`,
so an unformatted column is byte-identically unchanged. Confirmed in light and dark
(`hel469-align-dark.png`, `hel469-align-light.png`) — parity holds; alignment is a layout
property and is theme-independent.

**Four-consumer coherence, live (design D6).** On 200 real rows:
- **sort raw** — clicking `player_id` ascending gives `$96.00, $421.00, $1,373.00, …,
  $13,417.00`; `sortedNumerically = true`. A lexical sort would have put `$1,373.00` first.
- **filter formatted** — term `1,373` matches exactly 1 row, rendering `$1,373.00`;
  term `1373` (present only in the raw value) matches **0**. Both directions hold live.
- **persist / clear (D3b)** — `PATCH { config: { columnFormats: {} } }` returned
  `columnFormats: {}` with `columnFilters`/`columnSort` intact (shallow merge preserved
  siblings; `{}` replaced the map wholesale rather than deep-merging). After reload the column
  renders `96` / `1788853863699` with no `style` attribute. Clearing works end-to-end.

**`rawRows` boundary (D5)** — the panel-detail modal renders formatted values correctly from
the already-stringified rows, as designed.

**Console** — 0 errors on port 5176 across every flow. (The shared browser's console history
contains errors from other lanes' ports — 5880/5883/5942/5948/6478/6480 — none from this one.)

### Blocking finding — the new control collapses the existing column list

Opening the Output editor for a table Output (`Edit Projections 2026` →
`CONFIGURATION` → `Columns`), the new format `Select` starves the row it was inserted into.
Measured on the live DOM:

```
.table-display-fields__column-key  ("category")  getBoundingClientRect().width = 0
                                                 scrollWidth = 57, clientWidth = 0
.table-display-fields__column-visibility (label) getBoundingClientRect().width = 0
[aria-label="Format category"]                   getBoundingClientRect().width = 434
```

**Every column's name and its visibility checkbox are clipped to zero width.** The list is a
stack of identical unlabelled "None" dropdowns — the user cannot see which column a format
applies to, and cannot click the visibility checkbox at all. Screenshot:
`hel469-editor-format-control-light.png`.

Root cause is layout, and it is fully consistent with the diff: `.table-display-fields__column-row`
is `display: flex` (`TableDisplayFields.css:45-52`) and `.table-display-fields__column-visibility`
carries `flex: 1; min-width: 0` (`:58-65`), so it is the only shrinkable item; the new `Select`
was added as a flex sibling with **no** layout rule of its own — `git diff --stat -- '*.css'`
for this change is **empty**, no CSS was added at all — and the shared `Select` trigger
expands to fill, taking 434px and driving the label to 0.

This is precisely what tasks 5.2/5.3 exist to catch and is invisible to every source-text
check: the DOM-level `th.style.textAlign`/`td.style.textAlign` assertions in
`TableRenderer.test.tsx` are real assertions but they say nothing about this surface, and
`TableDisplayFields.test.tsx` only added default props.

Accessibility/keyboard themselves are fine: the control is the shared `Select`
(`role="combobox"`, `aria-haspopup="listbox"`, accessible name `Format <column>`), so the
screen-reader path is correct — it is the visual layout that regresses.

Breakpoints: not swept, because the defect above reproduces at the default 1600×1000 viewport
and any narrower width can only make it worse. Re-sweep 1440/1100/768/0 once it is fixed.

## Overall: FAIL

## Change Requests

1. **Pin locale (and timezone where dates are asserted) in `TableRenderer.test.tsx`'s HEL-469
   block — task 4.1a, currently marked done but violated.**
   `frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx:759-966`. Five tests,
   including the 3.2 sort guard and the 3.5 filter guard, assert `"$1,234.56"` / `"$9.99"` and
   go red under `LANG=de-DE` (reproduce with
   `LANG=de-DE npx jest --config jest.config.cjs --testPathPatterns="TableRenderer"`).
   Production intentionally passes no locale (design D4/task 4.2 — **do not** change
   `columnFormatting.ts` or `TableRenderer.tsx` to force one), so the pin must be applied at
   the test boundary: give `TableRenderer` (or the resolver it builds) a test-only way to
   receive the same `FormatIntlOptions` `columnFormatting.test.ts` already uses, and state the
   chosen locale/TZ in the file as task 4.0 requires. Whatever mechanism you choose, the
   acceptance evidence is that the command above passes, not that it passes on this machine's
   `en-US`.

2. **Stop the new format `Select` from collapsing the column name and visibility checkbox —
   task 5.2.** `frontend/src/features/panels/ui/editors/TableDisplayFields.tsx:122-129` inserts
   the `Select` into the `display: flex` row defined at `TableDisplayFields.css:45-52`, with no
   accompanying CSS, so `.table-display-fields__column-visibility`
   (`flex: 1; min-width: 0`, `:58-65`) shrinks to 0px while the `Select` takes 434px. Give the
   format control a bounded width (e.g. a `flex-shrink: 0` + fixed/`max-width` rule in
   `TableDisplayFields.css`, alongside the existing `.table-display-fields__column-move`
   `flex-shrink: 0` at `:137-141`) so the column key remains legible and the checkbox remains
   clickable at every supported width. Follow DESIGN.md's `--space-*` scale for the gap rather
   than a literal.
   **Verification must be rendered geometry, not a test:** re-open the editor and confirm
   `.table-display-fields__column-key` has a non-zero `getBoundingClientRect().width` and its
   text is not ellipsed away, in light and dark, at 1440/1100/768/0 — and only then check
   tasks 5.2/5.3 off.

3. **Do not check tasks 5.2/5.3 until 1 and 2 are both measured.** Leaving them unchecked in
   cycle 1 was the right call; the correct close-out is a measurement, not a claim.

## Non-blocking Suggestions

- A right-aligned column whose value overruns its 160px width ellipses the **tail**, so the
  low-order digits the right-alignment exists to line up are the ones lost (visible on
  `last_modified` in `hel469-align-dark.png`: `1,788,853,863,699….`). Pre-existing truncation
  behaviour interacting with new alignment, cosmetic, and column width is user-resizable — but
  worth a look if a follow-up touches this area.
- `useOutputColumnFormats.ts` discarding `decimals`/`currency`/`datePattern` on Save (see
  Phase 2) is worth folding into whatever the owner decides on the escalated UI-scope
  question, since a fix there naturally covers it.

## Disclosure — shared dev-DB writes

All against Output `hel904-orphan-output-05d5dbab-6942-44d7-80d4-be17510515bb`
("Projections 2026", pipeline `proj-2026-flat`) on the shared dev database:

1. `PATCH config.columnFormats` set to
   `{player_id: currency/USD, last_modified: number/2, category: text}` — for the geometry and
   coherence measurements.
2. **Reverted** with `PATCH config.columnFormats = {}` (verified: reload renders unformatted).
3. Side effect not reverted: clicking the `player_id` header to test live sort persisted
   `config.columnSort = {key: "player_id", direction: "asc"}` on that Output. It had no
   `columnSort` before. Harmless on a test fixture, disclosed for completeness.

Evidence (in the main checkout, survives Phase 4):
`/home/matt/Development/helio/.concertino/runs/HEL-469/evidence/`
— `hel469-align-dark.png`, `hel469-align-light.png`,
`hel469-editor-format-control-light.png`, `hel469-table-formatting-light.png`.
