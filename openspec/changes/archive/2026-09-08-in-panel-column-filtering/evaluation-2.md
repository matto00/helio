# Evaluation Report — Cycle 1 post-reframe (evaluation-2.md)

HEAD evaluated: `0f5ffd0a`. Dev server **content-authenticated** before any measurement:
`curl http://localhost:5883/src/shared/ui/DataGrid.tsx` → 2 occurrences of `ui-data-grid__frame`,
`DataGrid.css` → 1. `ui-data-grid__frame` has 0 occurrences on `main`, so the server is provably
serving THIS worktree, not another lane's.

All geometry below is **measured live in a real browser** (the coverage gap the executor declared
honestly rather than faking). Both themes, both surfaces.

---

### Phase 1: Spec Review — PASS

- Every D10-1…D10-10 decision is implemented as written. `tasks.md` has 0 unchecked items and
  section 8 matches what shipped.
- D10-5 success criterion holds: `stickyCellMaxWidth` gone, zero inline `maxWidth`, zero `colSpan`
  inside `<table>` (measured live on an 82-column Output: `table [colspan]` count = 0 on both
  surfaces).
- D10a labelling strip is complete. The two surviving matches for "provisional"/"trivially
  removable" are the removal-seam description (kept deliberately) and a sentence that explicitly
  says the disclosure is *not* provisional. Correct.
- Invariants 1–4 verified in source: minimal patch `{ config: { columnFilters } }`
  (`TableRenderer.tsx:157`) with no `output.config` spread; `canWrite` pre-check; user-edit-only
  (persist fires from `handleFilterChange`, never an effect); debounce **flushes** on unmount via an
  independent timer/ref pair (`:290-300`). Predicate is `formatCell(value)`
  (`tableFilterPredicate.ts:13`), the exported renderer. Supersession renders exactly ONE message —
  confirmed live: in the filtered-empty state `.panel-content__disclosure` is absent and the
  filtered-empty message alone carries the loaded-scope text.
- No scope creep observed in the diff.

### Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH`, not trusted from the handoff:

| gate | result |
| --- | --- |
| `npm run lint` | clean, 0 warnings |
| `npm run typecheck` | clean |
| `npm run format:check` | clean |
| `npm --prefix frontend test` | **292 suites / 3020 tests passed** |

(Root `npm test` deliberately not used as evidence — it is `jest --passWithNoTests && npm --prefix
frontend test`, and the root arm turns silence into a pass.)

**D10-9 guards are real, shown failing under mutation by me:**

| mutation | result |
| --- | --- |
| `ui-data-grid__frame--${variant}` → `frame--nope-${variant}` | RED at `DataGrid.test.tsx:924` |
| delete the `.ui-data-grid__frame--full` CSS rule | RED at `DataGrid.test.tsx:927` |
| `setColumnsRowTop(headerHeight)` → `setColumnsRowTop(0)` | RED at `DataGrid.test.tsx:858` (the `:840` successor) |

The evaluator-1 silent-failure mode (`flex: 1` missing on the frame) is now guarded on **both** the
TSX and CSS side. Worktree restored clean after every mutation (`git status` empty).

Code quality: comments are load-bearing and accurate except CR2 below. No dead code, no untyped
escape hatches, no leftover TODOs.

### Phase 3: UI Review — FAIL

**1. Sticky engages — D10-7 CONFIRMED LIVE, `columnsRowTop` is consumed.** Dashboard panel, filters
expanded, grid `scrollHeight` 7079 / `clientHeight` 154:

| `scrollTop` | grid top | header `th` top | per-column filter `th` top | first body cell top |
| --- | --- | --- | --- | --- |
| 0 | 211 | 211 | 245.5 | 290.5 |
| 300 | 211 | **211** | **245.5** | −9.5 |
| 1000 | 211 | **211** | **245.5** | −709.5 |

Both rows pin while the body scrolls away. `getComputedStyle(colTh).top` = `34.5px`, exactly the
measured header height — the number `columnsRowTop` produces is the number the browser uses. Same
result in the panel detail modal (header pinned at 198, filter row at 232.5, body at −222.5).
`columnsRowTop` stays.

**2. Frame chrome below the fold — BLOCKING, see CR1.** Fine at the default panel size, broken at
the app's real minimum.

**3. The three original defects are structurally gone.** 82-column Output, table 12,000px wide,
frame 501px. Sweeping `scrollLeft` 0 → 900 → 6000 → 11499, the toolbar and quick-filter row do not
move by a single pixel (`toolbarLeft` 297 / `toolbarRight` 798 at every position); `Filters (n)` and
"Clear all" stay visible throughout; the quick-filter input is **485px, not 12,136px**; the
filtered-empty message wraps to 104px over multiple lines and is fully readable. Immune by
structure, not by fix.

**4. Chrome visual treatment survived re-homing (D10-4).** Toolbar and quick-filter row both carry
`background: var(--app-surface-soft)`, `border-bottom: 1px solid var(--app-border-subtle)`,
`padding: var(--space-1) var(--space-2)`, `flex-shrink: 0`. Judged against the running app in both
themes: it reads as integrated chrome continuous with the table header, not as bare controls on a
bare background. Screenshots: `eval2-panel-light.png` (dark), `eval2-panel-light-filtered-empty.png`
(light).

**5. Density does NOT reach the chrome — see CR2.**

**6. Empty `<tbody>` (D10-6) is fine.** Renders 40px (`tbody:empty { display: block; min-height:
var(--space-8) }`), no 0px sliver, header border not left dangling — visible in
`eval2-panel-light-filtered-empty.png`.

**7. Drag-resize works and truncation is undamaged.** Column drag on the modal grid: header width
160 → 280px. `table-layout: fixed` retained; data cells still `white-space: nowrap` /
`overflow: hidden` / `text-overflow: ellipsis`. Invariant 7 holds.

**8. Preview variant — NOT LIVE-VERIFIED, see CR3.**

**HEL-448 modal re-gate (invariant 5) — CONFIRMED LIVE.** `Sort covers only the loaded rows.`
renders in the panel detail modal on this branch. This is the fix to shipped behaviour that exists
only here.

**Console:** 0 errors across every flow exercised.
**Breakpoints:** 1440 / 1100 / 768 / 420 — no chrome overflow, no document overflow-x, no layout
breakage at any width.

### Overall: FAIL

---

### Change Requests

**1. [BLOCKING] The filtered-empty message overflows `.panel-content--table` at the minimum panel
height, clipping its action buttons and collapsing the table shell to 0px.**

This violates D10-2/D10-3a's own invariant verbatim: *"neither frame chrome nor the disclosure may
require scrolling `.panel-content--table` to become visible."*

Reproduced by a **real, app-driven** react-grid-layout resize (not a synthetic height override —
that was my first attempt and I discarded it): drag the panel's resize handle down to its minimum,
apply a quick filter matching nothing, filters expanded.

| measurement | value |
| --- | --- |
| `.react-grid-item` height at the enforced minimum | 262px |
| `.panel-content--table` `clientHeight` | **159px** |
| `.panel-content--table` `scrollHeight` | **186px** → requires scrolling |
| toolbar | 137→174 visible |
| quick-filter row | 174→211 visible |
| filtered-empty message | 211→**315**, fold at **288** → **27px clipped** |
| `.ui-data-grid` (table shell) | height **0px** |

Consequences, visible in `.concertino/runs/HEL-451/evidence/eval2-minheight-filtered-empty-CLIPPED.png`:

- "Clear filters" and "Load more" are **cut horizontally through their middle** by the panel fold.
- The entire table shell — the column header row AND the per-column filter inputs — is 0px tall and
  therefore invisible. **This defeats D10-8**, whose stated purpose is that the shell must render so
  the user is not trapped with no way to see or edit the filter term that produced the empty result.
- It gets worse as the panel narrows: at a 306px-wide frame the message wraps to more lines, so the
  overflow grows.

Mitigating (state honestly, do not treat as a fix): `.panel-content--table` is `overflow-y: auto`,
so the content is reachable by scrolling, and the toolbar's "Clear all" stays visible, so the user
is not *unrecoverably* trapped. The panel nonetheless reads as broken, and it is broken in exactly
the state this ticket calls sharpest — a filter matching nothing.

Root cause, and where the design went wrong: D10-3a dismissed this as "no defect was constructible
at an achievable panel size (`itemHeights.min: 4` × `rowHeight: 52` leaves ~200px against ~140px of
chrome)". That arithmetic is wrong in both terms. The panel item's minimum is 262px, but the card's
own title bar and footer consume ~103px of it, leaving **159px** of `.panel-content`, not ~200px;
and the chrome stack in this state is toolbar 37 + quick-filter 37 + message 104 = **178px**, not
~140px. Combined with `flex-shrink: 0` on the chrome (correct in itself), the frame's content floor
exceeds the space available, so the overflow lands on `.panel-content--table` and the grid is
squeezed to zero.

Please pick a remedy and state it in design.md rather than tuning numbers until the screenshot looks
right — the tuning-per-round loop is what halted this ticket once already. Candidate directions:

- Give `.ui-data-grid` a `min-height` floor so the shell can never reach 0px, and let the
  filtered-empty message itself scroll/shrink instead of the shell (i.e. the message, not the shell,
  is the thing that yields under pressure).
- Or make the filtered-empty message compact in the height-constrained case (single line + the two
  buttons), keeping the full wording for the surfaces that have room.
- Or accept `.panel-content--table` scrolling for this one state and say so explicitly, which means
  amending D10-2's invariant — but note that hiding the partiality message below the fold is the
  precise defect this ticket exists to fix, so this direction needs the owner, not the executor.

Re-verify with the same live measurement afterwards: at the enforced minimum panel height, in both
themes, `scrollHeight <= clientHeight` on `.panel-content--table` and `.ui-data-grid` height > 0.

**2. The frame's mirrored density modifier is inert, and the comment asserting otherwise is false.**

`DataGrid.tsx:396-399` mirrors `ui-data-grid--${resolvedDensity}` onto the frame, and the comment
above it claims this "keeps the chrome responding to density exactly as it did before the reframe."
Measured: it does not. Toggling the frame between `--normal` / `--condensed` / `--spacious` in the
live DOM changes nothing — toolbar padding stays `4px 8px` and height stays 37px in all three.

The cause is that `DataGrid.css` contains only two density rules, both scoped to table cells:
`.ui-data-grid--condensed .ui-data-grid__table th, td` (`:186-187`) and the `--spacious` twin
(`:198-199`). Nothing selects `.ui-data-grid--condensed .ui-data-grid__filter-toolbar`. Pre-reframe
the chrome *was* `<th>` inside `.ui-data-grid__table`, so it did respond; the reframe lost that, which
is exactly the hazard D10-4 raised.

No user-visible impact today — `TableRenderer` never passes `density`, so the only surface where
chrome exists always resolves to `"normal"` — which is why this is CR2 and not blocking. But a
comment that confidently states the opposite of the measured behaviour is the documentation trap
this project has been bitten by repeatedly. Either:

- add frame-level density rules (`.ui-data-grid--condensed .ui-data-grid__filter-toolbar` etc.,
  in `--space-*` tokens), or
- drop the mirror and replace the comment with D10-4's explicit alternative: state plainly that the
  chrome does **not** respond to density and why that is acceptable.

Do not leave the mirror plus the false claim.

**3. Preview variant layout-neutrality was not verified live (D10-3 requires "verified, not
assumed").**

I could not reach any of the three `variant="preview"` call sites in the running app within this
review: `SourceDetailPanel.tsx:288` (no `.ui-data-grid` rendered on source detail pages for CSV,
REST or wide-table sources), `StepCard.tsx:382` (no grid after expanding a step or running Dry run
on `proj-2026-flat`), `SqlTab.tsx:223` (not reached). Static reading is reassuring —
`.ui-data-grid__frame` base is only `display: flex; flex-direction: column; min-width: 0;
min-height: 0`, `--preview` gets no frame-level flex rule, and `max-height: 320px` correctly stays
on the scroll container.

One concrete thing to check rather than assume: `.ui-data-grid--preview` carries
`margin-top: var(--space-3)`. That margin previously sat on the element that was the direct child of
the consumer's container; it is now inside a `display: flex` frame, where child margins never
collapse. If any preview call site relied on that margin collapsing with an adjacent margin, spacing
will have shifted by up to `--space-3`. Please verify each of the three call sites renders at
identical position and size to `main`, and record the measurement.

### Non-blocking Suggestions

- The `tbody:empty` floor uses `display: block` on a `<tbody>`. It is correctly scoped to the empty
  case only and I measured no effect on populated tables, but a `height` on a `<tr>`-less `tbody`
  (or a zero-height spacer row) would avoid changing the element's display type inside a table box
  altogether. Cosmetic; no defect observed.
- While measuring I resized the `SKF2-82col` panel on the shared dev database (402px → 262px →
  restored to 472px). Layout is persisted, so that dashboard's panel is now slightly taller than it
  was. Test-residue dashboard; flagging for transparency, no action needed.
