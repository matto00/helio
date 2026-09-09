# Evaluation Report — Cycle 2 (evaluation-3.md)

HEAD evaluated: `838ed229`, rebased onto `origin/main` (`736a8cbb`). Dev server content-authenticated
before measuring: served `DataGrid.tsx` contains `FRAME_FILTER_COLLAPSE_THRESHOLD_PX` /
`filteredEmptyCompact` (7 hits), served `DataGrid.css` contains `filtered-empty--compact` — so the
server is provably running THIS commit.

### Phase 1: Spec Review — PASS

D10-11 is implemented as ruled: auto-collapse is a default overridable by an explicit toggle
(`userToggledFilterExpansionRef`), the `Filters (n)` badge keeps the count while collapsed, and the
zero-match explanation is ungated (`filteredEmpty` at `:526`) with collapse varying presentation only
(`filteredEmptyCompact` at `:540`). Your pre-emptive catch on the `filterExpanded` gating was
correct and the fix is right. Threshold derivation is stated rather than asserted. `tasks.md` clean.

### Phase 2: Code Review — PASS

Gates re-run by me in the worktree (not trusted from the handoff): `npm run lint` clean,
`npm run typecheck` clean, `npm run format:check` clean, `npm --prefix frontend test`
**293 suites / 3042 tests passed**. Root `npm test` deliberately not used as evidence.

**The new regression guard at `DataGrid.test.tsx:861` is real.** I reintroduced the exact defect you
caught — `const filteredEmpty = rows.length === 0 && filtering && filterExpanded` — and it goes RED
(2 failures, incl. `:909`). Worktree restored clean afterwards (`git status` empty).

### Phase 3: UI Review — FAIL

**Cycle-1 blocking finding is FIXED.** Dashboard panel at the enforced minimum (item 262px → frame
`clientHeight` **143px** < 151), persisted no-match filter, no user toggle — the app auto-collapses:

| | cycle 1 | cycle 2 |
| --- | --- | --- |
| `.panel-content--table` scroll | 186 > 159 → **required** | 159 = 159 → **none** |
| `.ui-data-grid` height | **0px** | **62px**, header row present |
| filtered-empty message | 211→315 vs fold 288, **clipped** | 174→218, **fully visible** |
| "Clear filters" | cut in half | fully visible, inline |

The no-scroll invariant holds and D10-8 is satisfied. Auto-expand on growth also works (dragged back
up: frame 563 → expanded), so the `ResizeObserver` re-check is live in both directions.

**Compact message measured: exactly 44px.** The constant's `~44px` figure is right; the *other*
comment (`filteredEmptyCompact`, `:540`) says `~36px` — see note 1. The clamp holds the block at 44px
even when I injected the long truncated-variant text, and the panel still needed no scroll.

**Clamped text is readable, not clipped to uselessness.** With the long variant injected as a DOM
probe (labelled as such — this was not app-produced state, since this Output is no longer truncated),
the visible line reads *"No rows match your filter in the 200 rows loaded so far.…"* — the entire
load-bearing sentence survives; only the secondary "load more to widen the search" hint is clamped
away, and the action button is visible inline beside it. Screenshot:
`eval3-compact-clamp-longtext-probe.png`. Good outcome.

**Sticky re-confirmed fresh (not inherited).** Modal, post-collapse-machinery and post-rebase:
header `th` top 198 → 198, per-column filter `th` 232.5 → 232.5, first body cell 232.5 → −222.5 at
`scrollTop` 500. Both pin.

**CR2 landed, partially.** `--spacious` now visibly reaches the toolbar (padding `4px 8px` → `12px
16px`, height 37 → 53px), so the modifier is no longer inert. `--condensed` is indistinguishable
from `--normal` — see note 2.

**Focus ring (HEL-1046) routes through the centralized token.** `.ui-data-grid__filter-input:focus-visible`
and `.ui-data-grid__resize-handle:focus-visible` both use `outline: var(--app-focus-ring)`, computing
to `rgb(168, 129, 6) solid 2px` from `--app-focus-ring-color: #a88106`. No border change on focus —
no bordered focus state added; no HEL-1050 offender introduced.

**CR3 (preview variant) — still UNMET, reported as unmet, not closed.** I again could not reach
`StepCard.tsx:382` (no grid after expanding a step or running Dry run on `proj-2026-flat`),
`SourceDetailPanel.tsx:288` (no `.ui-data-grid` on CSV/REST/wide-table source detail pages), or
`SqlTab.tsx:223`. The `--preview` `margin-top` collapse question is therefore unverified.

Console: 0 errors. Breakpoints 1440/1100/768/420: no chrome overflow, no document overflow-x.

### Overall: FAIL

One blocking finding. It is a genuine defect, not a loop-continuation — it is precisely the case
D10-11's own requirement 3 demanded be demonstrated non-broken.

---

### Change Requests

**1. [BLOCKING] The threshold admits an expanded regime it cannot hold. At and just above
`FRAME_FILTER_COLLAPSE_THRESHOLD_PX`, the grid is squeezed to ~0px again — D10-11 requirement 3 is
violated at exactly the boundary it names as "the one most likely to be wrong".**

Boundary sweep on the dashboard panel (frame height forced to isolate the transition; the switch
point itself is exactly as specified — collapse below 151, expand at ≥ 151):

| frame height | expanded | compact | chrome total | grid height | frame overflows |
| --- | --- | --- | --- | --- | --- |
| 149 | no | yes | 81px | 68px | no |
| 150 | no | yes | 81px | 69px | no |
| **151** | **yes** | no | **160px** | **0px** | **yes** |
| **152** | **yes** | no | **160px** | **0px** | **yes** |
| 160 | yes | no | 160px | **0px** | no |

**Reproduced in the real app with no forced styles and no user override** — panel detail modal at
viewport 1100×325, persisted no-match filter, the app's own automatic decision:

- frame `clientHeight` **167px** → ≥ 151 → auto-expanded
- chrome = toolbar 37 + quick-filter 37 + full message 86 = **160px**
- `.ui-data-grid` = **7px**
- header row and **61 per-column filter inputs** present in the DOM but inside a 7px scroll container

Screenshot: `eval3-boundary-band-modal-grid-7px.png` — the entire table shell renders as a grey
sliver. This is D10-8 defeated again ("the header and per-column inputs never vanish"), in the
regime the threshold explicitly chose.

**Root cause is precise and is in the derivation, not the code.** The 143px floor is
`37 + 37 + 34.5 + 34.5` — toolbar, quick-filter row, column header, per-column filter row. It
**excludes the filtered-empty message**, justified in the constant's doc comment as "handled as its
own, separately-bounded guarantee". That justification is true only of the *compact* message (44px,
bounded by `line-clamp`). In the **expanded** state the message is the full wrapped block — measured
86px — so the real expanded chrome in the filtered-empty state is `37 + 37 + 86 = 160px`, which is
**greater than the 151px threshold**. The threshold therefore permits expansion in roughly
`[151, 160 + minimum-usable-grid)` where the chrome provably does not fit.

This is the same shape of error as D10-3a's withdrawn arithmetic: a floor computed from a subset of
the elements that are actually present in the state being bounded. The number is not slightly off;
the wrong term set was summed.

Requested:

- Derive the threshold against the chrome that is actually present in the **worst** state it
  governs — the expanded filtered-empty state — i.e. include the full message's measured height
  (86px at typical panel widths, more when narrow), plus a minimum grid height that keeps the header
  row **and** one per-column filter input usable (~69px measured at the collapsed end, so ~34.5 + 34.5).
  That lands the honest expanded floor near `37 + 37 + 86 + 69 ≈ 229px`, not 151px. State the
  derivation, do not pick a literal that makes this one repro pass.
- Note the consequence before implementing: a threshold near 229px means the *dashboard panel*
  frame at the enforced minimum (143px) and the next step up (213px) both collapse, and only the
  third step (283px) expands. That may be the correct answer, but it is a visible behaviour change
  worth stating in design.md rather than discovering after the fact.
- Alternatively, bound the expanded message the same way the compact one is bounded (e.g. cap its
  height and let it scroll internally), which would make the existing 143px-based floor honest.
  Either is defensible; the current combination is not.
- Re-verify by sweeping frame heights across the transition on **both** surfaces and showing
  `.ui-data-grid` height > 0 and no frame overflow at every height in the expanded regime.

**Add a guard for this.** The `:861` guard checks only that the *message* survives collapse. Nothing
fails when the *grid* is crushed to 0px — which is how both this and the cycle-1 finding shipped
green. A guard asserting a nonzero grid height (or, in jsdom terms, that the expanded chrome floor
does not exceed the stubbed frame height) is what would have caught this.

### Non-blocking Notes

1. **Two inconsistent estimates for the same measurement.** `FRAME_FILTER_COLLAPSE_THRESHOLD_PX`'s
   doc says the compact message is `~44` and floors at `~115.5px`; `filteredEmptyCompact`'s comment
   at `:540` says `~36px` and floors at `~107.5px`. Measured live: **44px**. The constant is right,
   `:540` is stale. Fix `:540` when addressing CR1 so the two derivations do not disagree in-tree.

2. **`--condensed` does not visibly differ from `--normal` on the chrome.** Both compute to
   `padding: 4px 8px` / 37px, because the base `.ui-data-grid__filter-toolbar` rule already uses
   `var(--space-1) var(--space-2)` — the exact values the `--condensed` rule re-states. Table cells
   have three distinct densities; chrome effectively has two. Not user-visible today (`TableRenderer`
   never passes `density`), and `--spacious` proves the selector reaches, so CR2's substance landed.
   Worth a one-line decision: either give the chrome a roomier `--normal` or state that chrome has
   two density steps by design.

3. **The user-override path at minimum panel height is still the clipped state** — frame 143px, user
   explicitly expands, chrome 160px, grid 0px, panel scrolls. I am recording this as compliant, not
   as a finding: D10-11 rules explicitly that "collapse is a default, not a lock" and that a user who
   expands in a short panel gets "whatever scrolling that implies". Noting it only so it is not
   re-found later and mistaken for a regression. CR1 is a different thing — there the *app* chooses
   the broken state with no user involvement.

4. **Dev-DB side effects, disclosed on the same standard as last cycle:** on `SKF2-82col` I resized
   the `Projections 2026 table` panel repeatedly (it now sits at the enforced minimum, 262px) and
   left a persisted `columnFilters` value of `zzzznomatchzzzz` on its Output from the repro. Both are
   trivially clearable; say the word if you want them reverted rather than left.

5. That Output is **no longer truncated** (200 rows, no `hasMore`), unlike cycle 1 — which is why the
   long-message clamp had to be probed by DOM injection rather than produced naturally. Shared dev DB;
   flagged so the method is visible rather than implied.
