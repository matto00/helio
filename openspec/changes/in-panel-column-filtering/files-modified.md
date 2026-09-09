# Files modified — HEL-451 In-panel column filtering

- `frontend/src/shared/ui/DataGrid.tsx` — D10 reframe: introduces `.ui-data-grid__frame`; moves the
  filter toolbar, quick-filter row, and filtered-empty message OUT of the table and ahead of the
  scroll container; deletes `stickyCellMaxWidth` and its measuring effect; per-column filter row
  keeps its single measured sticky offset (now just the header row's height). Also carries the
  original filter predicate wiring, toggle/quick/per-column filter controls, and the D5 empty-state
  slot from before the halt. **Evaluator-1 fix**: the frame now mirrors the `variant` modifier
  (`ui-data-grid__frame--full`) the same way it already mirrors density — the initial pass gave the
  frame no full-variant flex rule at all, which is the D10-3a-named silent-failure mode (frame stays
  content-sized, `.ui-data-grid` never gets a vertical cap, sticky stops engaging, nothing goes red).
- `frontend/src/shared/ui/DataGrid.css` — D10 reframe CSS: `.ui-data-grid__frame` (flex column,
  `min-height: 0`), `.ui-data-grid__frame--full` (**evaluator-1 fix**: `flex: 1; min-height: 0` on
  the frame itself, per D10-3a — missing from the initial pass), `.ui-data-grid--full` changed from
  `height: 100%` to `flex: 1; min-height: 0`, re-homed chrome CSS (`.ui-data-grid__filter-toolbar`,
  `.ui-data-grid__quick-filter-row`, `.ui-data-grid__filtered-empty`) carrying the same
  surface/border/padding recipe as the deleted `<th>`/`<td>` cells, deletion of
  `.ui-data-grid__sticky-cell` and the truncation-group reset selector list, and
  `.ui-data-grid__table tbody:empty` floor-height rule.
- `frontend/src/shared/ui/DataGrid.test.tsx` — retargeted the tests the reframe invalidates
  (sticky-cell wrapper, three-way sticky offsets, colSpan filtered-empty row, viewport-width
  max-width computation, static-source truncation-group-reset guard) to the new structure per
  design D10-9; added the three required replacement guards (no `colSpan` inside `<table>`, no
  inline `maxWidth` anywhere, chrome precedes `.ui-data-grid` in DOM order); fixed two tests whose
  `container.firstChild` assumption broke once the frame became the outer element.
- `frontend/src/features/panels/ui/renderers/LoadedScopeDisclosure.tsx` — D10a: stripped the
  "pending owner confirmation"/"NEVER owner-approved" labelling now that the owner has confirmed
  the disclosure; kept the removal seam itself. Also the file that implements the five-state
  loaded-scope/filter disclosure matrix (design D4/D4b).
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — D10a: same labelling strip at the
  `LoadedScopeDisclosure` call site. Also wires the filter predicate into the existing single
  filter→sort pipeline (design D3), the five-state disclosure booleans
  (`showLoadedScopeNote`/`showLoadMoreBtn`), and debounced filter persistence (design D6).
- `frontend/src/features/panels/ui/renderers/TableRenderer.css` — chrome CSS for the disclosure
  wrapper and the filtered-empty action buttons (Clear filters / Load more).
- `frontend/src/features/panels/ui/renderers/tableFilterPredicate.ts` — the match predicate (D2:
  matches `formatCell`'s rendered text) and tolerant `columnFilters` normalization/read (D1).
- `frontend/src/features/panels/ui/renderers/tableFilterPredicate.test.ts` — Jest coverage for the
  same predicate and normalization/read logic.
- `frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx` — Jest coverage for the filter
  predicate composition, disclosure matrix, and persistence behaviour.
- `frontend/src/features/panels/hooks/usePanelData.ts` — exposes a branch-independent
  `rowsTruncated` (from `paginationEntry.hasMore`) so the disclosure is correct on both the
  pagination and `rawRows` branches (design D4).
- `frontend/src/features/panels/ui/PanelCard.tsx` — wires `rowsTruncated` into `TableRenderer` on
  the dashboard-grid surface.
- `frontend/src/features/panels/ui/PanelCard.test.tsx` — Jest coverage for that wiring.
- `frontend/src/features/panels/ui/PanelContent.tsx` — threads `rowsTruncated` through to
  `TableRenderer` from both call sites.
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` — wires `rowsTruncated` into
  `TableRenderer` on the panel detail modal, which is also the HEL-448 modal re-gate fix
  (invariant 5): the sort qualifier had never rendered there since `adadb5d4`.
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.panelSwitch.test.tsx` — Jest
  coverage for that wiring.
- `frontend/src/features/panels/ui/grid/MobilePanelStack.test.tsx` — coverage for the shared
  `TableRenderer` on the mobile stack surface (skeptic-design-9 non-blocking note 2's verification
  target).
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` — `TableColumnFilters`/
  `columnFilters` added to `TableOutputConfig` (design D1).
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.test.ts` — Jest coverage for
  the same addition.
- `openspec/changes/in-panel-column-filtering/design.md` — the whole D10/D10a reframe design,
  written and confirmed across five design-gate rounds (`skeptic-design-5..9.md`).
- `openspec/changes/in-panel-column-filtering/tasks.md` — added section 8 for the D10 reframe tasks,
  all marked complete.
- `openspec/changes/in-panel-column-filtering/skeptic-design-{5,6,7,8,9}.md` — the design-gate
  rounds that produced and confirmed D10.
- `openspec/changes/in-panel-column-filtering/evaluation-2.md` — cycle-1 post-reframe evaluation
  report (FAIL: one blocking finding, chrome overflow at minimum panel height, plus three
  non-blocking CRs); the source of the measured heights D10-11's threshold derivation is based on.

## Cycle 2 — evaluation-2's Change Requests

- `frontend/src/shared/ui/DataGrid.tsx` — **CR1 (blocking, owner-ruled D10-11)**: filter chrome now
  auto-collapses by default below a measured height threshold, using the EXISTING toggle affordance
  (no new mechanism). `FRAME_FILTER_COLLAPSE_THRESHOLD_PX = 151` (derivation below, CORRECTED in
  cycle 3 — see that section); measured via a `useLayoutEffect` reading `.ui-data-grid__frame`'s own
  `clientHeight` (guarded: `0`/unmeasured is treated as "no information," never as "collapse," so
  jsdom's always-0 `clientHeight` cannot silently flip existing behavior), plus a
  `ResizeObserver`-driven re-check for panels resized after mount (guarded for environments without
  `ResizeObserver`). `userToggledFilterExpansionRef` makes the override apply ONLY to the automatic
  default — an explicit toggle click, either direction, governs from then on ("collapse is a
  default, not a lock," per the ruling).
- `frontend/src/shared/ui/DataGrid.css` — **CR2**: added
  `.ui-data-grid--condensed .ui-data-grid__filter-toolbar`/`.ui-data-grid__quick-filter-row` and the
  `--spacious` twin. Chose "make the selector real" over "correct the comment to say chrome doesn't
  respond": the frame already carries the mirrored modifier class for exactly this purpose (D10-4
  explicitly allows either), `TableRenderer` not currently passing `density` means the cost of
  wiring it is three cheap declarations, and leaving an inert-but-plausible-looking modifier class
  on the frame is exactly the kind of thing a future reader re-discovers as a mystery.
- `frontend/src/shared/ui/DataGrid.test.tsx` — new `describe` block for D10-11 (auto-collapse below
  threshold, allow-expand at/above threshold, never force-EXPAND with no active filter, explicit
  toggle overrides the default permanently); a mutation-failable static-source guard for CR2's real
  density selector.

## Cycle 3 — evaluation's CR1 (BLOCKING): the collapse gate silently suppressed the zero-match explanation

**Cycle 2's mistake, and why it was wrong.** The cycle-2 revision also gated the filtered-empty
message on `filterExpanded`, reasoning that its variable height was what made the threshold
arithmetic close. That broke `TableRenderer.tsx`'s contract that `DataGrid` renders the zero-match
explanation UNCONDITIONALLY whenever `isEmpty` is true (`TableRenderer.tsx`'s `isEmpty`/
`showTruncationWrapper` split trusts `DataGrid` to own every empty state). Net effect: a collapsed
panel with a filter matching nothing rendered NO explanation at all — just the `Filters (n)` badge —
which is precisely "a filter matching nothing renders as a confident wrong answer," the defect this
ticket exists to fix, now guaranteed at exactly the small panel heights auto-collapse targets.

**The fix (option 2 of the three offered): a compact presentation, not a suppressed message.**

- `frontend/src/shared/ui/DataGrid.tsx` — `filteredEmpty` is UNGATED again
  (`rows.length === 0 && filtering`, no `&& filterExpanded`) — it renders in BOTH expansion states.
  A new `filteredEmptyCompact = filteredEmpty && !filterExpanded` controls only the PRESENTATION:
  collapsed renders a `.ui-data-grid__filtered-empty--compact` variant (one-line clamped text via
  CSS `line-clamp`, full text preserved in the `title` attribute, action row inline); expanded
  renders the full, unclamped text exactly as before. `FRAME_FILTER_COLLAPSE_THRESHOLD_PX`'s own doc
  comment is rewritten to state plainly that it governs ONLY the quick/per-column rows now, never
  the message.
- `frontend/src/shared/ui/DataGrid.css` — added `.ui-data-grid__filtered-empty--compact` (tight
  padding, inline flex row) and the `line-clamp` rule on its `.ui-data-grid__empty` child. Does NOT
  reference `TableRenderer`'s `.panel-content__filter-empty-actions` by name (`DataGrid` stays
  presentational, per the file's own doc comment) — uses a generic `> :last-child` selector for the
  action row's `flex-shrink: 0` instead.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — rewrote the `:356-357`-area
  comment (evaluator's explicit ask) to state the ACTUAL, now-restored division of labour: `DataGrid`
  renders the zero-match explanation unconditionally regardless of its own internal expand/collapse
  state; that internal state changes only the explanation's PRESENTATION, never whether it renders.
  Recorded explicitly that an earlier revision broke this, so a future reader does not silently
  reintroduce the same class of regression.
- `frontend/src/shared/ui/DataGrid.test.tsx` — replaced the cycle-2 test that encoded the WRONG
  behaviour (asserting the message was ABSENT when collapsed) with the required mutation-failable
  guard: **with a filter active and zero matches, an explanation is present in BOTH the collapsed
  and expanded states** — asserted by text content and by the compact/full modifier class, not
  merely by presence. Added a companion test for the `title` attribute's accessibility fallback.

### D10-11 threshold derivation, RE-DERIVED for the corrected content

1. **Measured heights** (live, from `evaluation-2.md`, both surfaces — unchanged from cycle 2):
   toolbar 37px (always rendered); quick-filter row 37px (only when the additional rows are
   expanded); column-header row 34.5px (D10-7's confirmed live measurement,
   `getComputedStyle(colTh).top`). The per-column filter row is treated as the same ~34.5px — same
   padding/font-size recipe as the header row — not independently re-measured (coverage limit
   below). The COMPACT filtered-empty message's own height (~44px: one clamped text line plus an
   inline action row, estimated from its CSS recipe, not independently live-measured — a new,
   explicitly-declared coverage limit) is a NEW quantity this re-derivation introduces.
2. **What the threshold now governs.** `FRAME_FILTER_COLLAPSE_THRESHOLD_PX` decides ONLY whether the
   quick-filter row and per-column filter row default to expanded — the filtered-empty message is a
   SEPARATE, unconditional guarantee (cycle 3's fix) that never depends on this constant. The
   expanded-chrome floor is UNCHANGED from cycle 2: toolbar + quick-filter row + header row +
   per-column filter row = 37 + 37 + 34.5 + 34.5 = **143px**, plus the same `--space-2` (8px)
   rounding buffer = **`FRAME_FILTER_COLLAPSE_THRESHOLD_PX = 151`** (the literal value did not need
   to move; what changed is what it means — it no longer implicitly relies on the message being
   absent below it).
3. **The DEFAULT (collapsed) floor, now WITH the compact message included** — this is the number
   that actually matters for "does the smallest permitted panel ever overflow," and it is the
   arithmetic cycle 2 got wrong by omission: toolbar (37) + header row (34.5) + compact filtered-
   empty message (~44) ≈ **115.5px** (cycle 3, no CSS grid floor existed yet at this point — **this
   figure is SUPERSEDED once cycle 4 adds the unconditional `min-height` floor; see "Cycle 6 —
   editorial fix" below for the corrected 160.5px figure and why it changed**), comfortably under
   the app's enforced minimum `.panel-content--table` height (159px, evaluation-2, measured), with
   ~43.5px of margin — not merely non-negative, at THIS point in the ticket's history.
4. **Behaviour at threshold ± 1** (verified by the updated Jest describe block, stubbed
   `clientHeight`, not a live browser — coverage limit below): at 150px (threshold−1) the additional
   rows collapse; the default floor is the 115.5px above (cycle-3-era, superseded — see note 3
   above), well under 150px. At 152px (threshold+1)
   the additional rows are allowed; the 143px chrome-only floor fits with a ~9px margin. In BOTH
   cases the filtered-empty explanation itself is present — compact below the threshold, full above
   it — so the semantic invariant (an explanation exists) holds independent of which side of the
   threshold the panel falls on.
5. **Expressed against the frame's OWN measured height** — unchanged rationale from cycle 2, see
   that section; still not `.panel-content`'s or the panel item's height.
6. **Residual, honestly-stated risk, RESTATED**: the height-only threshold still cannot bound the
   EXPANDED state's full, unclamped message text (up to ~104px in evaluation-2's narrow-panel repro)
   against every possible width/content combination — a user who manually expands in a panel just
   above 151px, with a very long wrapped filter value, could still see that full message press close
   to the fold. This residual risk is UNCHANGED from cycle 2 and remains accepted (D10-11,
   "collapse is a default, not a lock") — it now applies ONLY to the user-overridden expanded state,
   never to the collapsed default, which cycle 3's fix makes unconditionally safe via the bounded
   compact form.

## Cycle 4 — evaluation-3's CR1 (BLOCKING): the threshold omitted the expanded message

**The defect.** Cycle 3's `FRAME_FILTER_COLLAPSE_THRESHOLD_PX = 151` excluded the filtered-empty
message from its floor as "separately bounded" — true only of the COMPACT (44px) form. At/above
151px the app auto-EXPANDS, and the message reverts to its FULL, unclamped form — measured live at
**86px** (evaluation-3.md). Real expanded chrome in the filtered-empty state at the threshold was
therefore `37 + 37 + 86 = 160px`, more than the 151px threshold itself, before the grid had any
room. Reproduced live with no forced styles: a 167px modal frame auto-expanded and crushed
`.ui-data-grid` to 7px — the header row and 61 per-column filter inputs present in the DOM,
invisible inside the sliver. Same shape as D10-3a's withdrawn arithmetic: not a number slightly off,
but the wrong term set summed.

**Owner ruling: BOTH remedies, not either.**

- `frontend/src/shared/ui/DataGrid.tsx` — `FRAME_FILTER_COLLAPSE_THRESHOLD_PX` raised from 151 to
  **237** (now `export`ed for the test guard below), derived against the WORST state it must hold —
  toolbar (37) + quick-filter row (37) + FULL filtered-empty message (86, evaluation-3.md measured)
  + minimum usable grid (69, one header row + one per-column filter input) = 229, + the same
  `--space-2` (8px) rounding buffer used in cycle 3 = 237. Fixes the path where the APP auto-expands.
  Fixed the stale `filteredEmptyCompact` comment in the same pass (it said ~36px, measured 44px —
  evaluation-3.md non-blocking note 1).
- `frontend/src/shared/ui/DataGrid.css` — added a **second, independent** remedy:
  `.ui-data-grid--full`'s `min-height` raised from `0` to **69px**
  (`GRID_MIN_USABLE_HEIGHT_PX`, also exported from DataGrid.tsx and kept in sync by a static-source
  test). Fixes the path where a USER manually overrides the collapsed default in a panel shorter
  than the threshold — D10-11 explicitly sanctions that override, and without this floor the
  identical crushed-grid state is one click away regardless of the raised threshold. When the floor
  pushes chrome past the frame's available height, `.panel-content--table` scrolls — accepted ONLY
  on this user-override path (D10-11), never on a path the app itself chooses. **The two remedies
  are deliberately not merged into one number** — they protect two different actors (the app's
  automatic choice vs. the user's explicit override); D10-12 states explicitly not to "simplify"
  them into one.
- `frontend/src/shared/ui/DataGrid.test.tsx` — updated the threshold boundary tests to use the
  exported constant (`FRAME_FILTER_COLLAPSE_THRESHOLD_PX ± 1`) rather than hardcoded 150/152; added
  three new guards: (a) the threshold arithmetic itself, computed from named sub-heights including
  the full 86px message, must be `>=` the honest floor (mutation-failable — lowering the threshold
  back toward the chrome-only range turns it red); (b) a static-source guard that
  `.ui-data-grid--full`'s CSS carries `min-height: 69px` matching the exported
  `GRID_MIN_USABLE_HEIGHT_PX`; (c) the invariant the evaluator named explicitly — "the table shell
  survives collapse [or override], not just the explanation" — asserting the header row and every
  per-column filter input remain in the DOM when a user overrides collapse in a panel far shorter
  than the threshold. `(c)` is an existence check (jsdom cannot enforce real `min-height` layout);
  `(b)` is the guard that actually enforces the pixel floor, and the two are paired deliberately.
- **Accepted consequence, owner-ruled, not tuned away**: with the raised threshold, the dashboard
  panel's grid-layout size steps mean filters now collapse by default at the enforced minimum AND
  the next size step up, expanding only at the third step.

### Dev-DB cleanup: CLOSED (evaluator confirmed by query, cycle 5)

I searched the shared dev DB (`helio` on `localhost:5432`) for the persisted `columnFilters` value
`zzzznomatchzzzz` and could not find it by exact value or by name (my search used the PANEL's name,
"Projections 2026 table", while the Output itself is named "Projections 2026" — hence the miss). The
evaluator re-queried directly and confirmed the row was already `null`. Nothing owed; no further
action.

## Cycle 5 — evaluator's two corrections (both non-blocking, fixed anyway per instruction)

**1. `GRID_MIN_USABLE_HEIGHT_PX` was a THIRD assumed threshold term — corrected by measurement.**
The evaluator re-derived the 237px threshold from live measurement rather than accepting cycle 4's
arithmetic, and found the per-column filter row is NOT "~34.5px like the header row" (cycle 4's
assumption, reusing the header's own measured height without separately measuring the row that
actually carries `<input>` elements). It measures **45px, live**. So "header + one per-column input"
is 79.5px, not 69px — the same class of error D10-3a and cycle-3's 143px both made: a plausible
number substituted for a measured one.

- `frontend/src/shared/ui/DataGrid.tsx` — `GRID_MIN_USABLE_HEIGHT_PX` corrected 69 → **79.5**
  (34.5px header + 45px per-column row, both now individually cited); `FRAME_FILTER_COLLAPSE
  _THRESHOLD_PX` correspondingly corrected 237 → **247.5** (37 + 37 + 86 + 79.5 = 239.5, + 8px
  buffer). Both doc comments rewritten to state the CORRECT figures rather than leave a derivation
  comment asserting a number now known to be false — this ticket has hit the confidently-false-
  comment problem enough times that leaving one in place after being told it's wrong was not an
  option.
- `frontend/src/shared/ui/DataGrid.css` — `.ui-data-grid--full`'s `min-height` corrected 69px →
  **79.5px**, comment rewritten with the same correction and an explicit note that this was the
  ticket's third assumed-rather-than-measured threshold term.
- `frontend/src/shared/ui/DataGrid.test.tsx` — no test needed new numbers hardcoded (the boundary
  tests already derive from the exported constants), but the arithmetic/CSS guards were re-verified
  against the corrected values (79.5 / 247.5) and, per the evaluator's own methodology, run AGAINST
  the prior (69 / 237, and further back 151) known-wrong values to confirm they go red — see below.
- **No behavioural change on the app-chosen path**: per the evaluator's own measurement, at 237px
  (the pre-correction threshold) the grid already got 77px with the per-column input fully visible
  and 6px spare — the correction fixes the STATED constants and their derivation, not an actual
  live defect at the threshold boundary itself.

**2. The DOM-existence guard measured the wrong property — renamed and rewritten, not deleted.**
`DataGrid.test.tsx`'s guard asserting the header row/per-column inputs "remain in the DOM" on the
override path never would have caught either grid-crush defect: evaluation-3.md measured 61
per-column inputs present in the DOM INSIDE the 7px crushed grid, so DOM presence was never the
failing property — rendered height was. Per the evaluator's explicit instruction, this test is KEPT
(it documents a real, narrower property — the shell markup is never conditionally stripped) but
RENAMED and its comment REWRITTEN so it no longer claims to guard "shell survival": it is now titled
a "STRUCTURAL CHECK (not a layout guard)" with an explicit pointer to the CSS floor guard
(`GRID_MIN_USABLE_HEIGHT_PX`'s static-source assertion) as the actual, load-bearing invariant guard,
now itself explicitly labelled "THE invariant guard for grid-survives-collapse" in its own title and
comment.

**Verification per the evaluator's own instruction ("run each guard against the known-bad state it
claims to exclude")**: both cycle-4 guards (the threshold-arithmetic guard and the CSS floor guard)
were run against the prior values (`GRID_MIN_USABLE_HEIGHT_PX = 69`, `FRAME_FILTER_COLLAPSE
_THRESHOLD_PX = 151`) and confirmed RED before being restored to the corrected values and confirmed
GREEN — not merely asserted to be mutation-failable, actually exercised against the specific
known-bad state cycle 4 shipped.

## CR3 — preview variant call sites: STILL UNMET, second cycle unreached

**Reported as unmet again, not softened.** I still could not reach a running dev server or browser
in this session (no browser/screenshot tool available; only Bash/Read/Edit/Write). The specific
named risk, unchanged from cycle 2: `.ui-data-grid--preview` carries `margin-top: var(--space-3)`;
that margin previously sat on the element that was the direct child of each consumer's container
(`StepCard.tsx:382`, `SourceDetailPanel.tsx:288`, `SqlTab.tsx:223`) and could collapse with an
adjacent margin there. It is now inside a `display: flex` frame (`.ui-data-grid__frame`), where
child margins never collapse. If any of the three call sites relied on that collapse, spacing may
have shifted by up to `--space-3` (8px). Static reading supports layout-neutrality (the frame's base
rule is only `display: flex; flex-direction: column; min-width: 0; min-height: 0`; `--preview` gets
no frame-level flex rule; `max-height: 320px` stays correctly on the scroll container) but static
reading is not the same as verified, and this report does not conflate the two. Per the evaluator's
own instruction this cycle, this is expected to be filed as a follow-up rather than carried a third
cycle in this ticket.

## CR2 non-blocking note (evaluation-3.md #2) — `--condensed` identical to `--normal` on chrome, by design

`--condensed`'s chrome rule (`padding: var(--space-1) var(--space-2)`) computes identically to the
base `.ui-data-grid__filter-toolbar`/`.ui-data-grid__quick-filter-row` rule, which already uses
those same values — so `--condensed` is indistinguishable from `--normal` on the chrome, while
`--spacious` visibly differs (confirming the selector reaches, CR2's substance). No action taken per
the evaluator's own framing ("no action unless you think the identical case should differ") — chrome
effectively has two density steps (normal/condensed vs. spacious) rather than three, which is stated
here as a decision rather than left as an unexplained asymmetry.

## CR4 — focus ring (HEL-1046): resolved by rebasing, no code change needed

Rebased this branch onto `origin/main` (`736a8cbb`, which includes HEL-1046's
`--app-focus-ring-color`) — a clean rebase, no conflicts. `.ui-data-grid__filter-input:focus-visible`
and `.ui-data-grid__resize-handle:focus-visible` already route through the centralized
`outline: var(--app-focus-ring)` token (never a bordered focus state, never a hardcoded color), so
once rebased onto HEL-1046 they automatically pick up the new contrast-derived colour with zero
changes required here. Verified: `grep -n focus DataGrid.css` shows only these two `outline:
var(--app-focus-ring)` declarations.

## Manifest note: package.json/package-lock.json were staged, then reverted, not declared

The squash guard correctly flagged `package.json`, `package-lock.json`, `frontend/package.json`,
and `frontend/package-lock.json` as undeclared. My first instinct — add them to this manifest as
"rebase drift" — was wrong: they were `overrides` version-pin DOWNGRADES (`js-yaml` and `sharp`
security pins moved to older, looser ranges), most likely from an `npm install` regenerating the
lockfiles against a pre-rebase base with the branch's own versions winning. Declaring them would
have converted a caught regression into an approved one — the guard was doing exactly its job. All
four are restored to `origin/main`'s exact content (`git checkout origin/main -- package.json
package-lock.json frontend/package.json frontend/package-lock.json`, verified zero-diff against
`origin/main` afterward) and are correctly UNDECLARED here — this change does not touch dependencies.

## Tooling finding: the stray uncommitted write to the main checkout

I reviewed every tool call in this session that touched `DataGrid.test.tsx`. Every `Edit`/`Write`
call used an absolute path under the worktree
(`/home/matt/Development/helio/.claude/worktrees/feature/in-panel-column-filtering/HEL-451/...`).
Every `Bash` invocation that wrote via a `python3` heredoc against a relative path
(`frontend/src/shared/ui/DataGrid.test.tsx`) was preceded by `cd
/home/matt/Development/helio/.claude/worktrees/.../HEL-451` **within that same Bash call** — the
mode this environment's tools require, since cwd resets between separate Bash invocations. I could
not find a call in my own transcript that resolves a relative path against the repo root instead of
the worktree. I cannot rule out an earlier, now-superseded turn outside what I can inspect, or a
mechanism outside my own tool calls (e.g. a hook, a different agent, or an editor/IDE auto-save) —
but I did not find the mechanism myself, and I am stating that plainly rather than guessing at a
cause I cannot verify.

## Cycle 6 — final-gate editorial fix: the collapsed-floor figure was stale

**Final gate: CONFIRM.** The skeptic re-derived all four threshold terms from its own live
measurements (toolbar 37, quick-filter 37, header 34.5, per-column row 45, message 86), confirming
both cycle-5 corrections (79.5 / 247.5), and swept the transition live: 247 collapses, 248 expands
with grid 87.95px and the per-column input fully inside the grid box; the override path pins at
exactly 79.5px on both surfaces, with the input confirmed reachable via `elementFromPoint` after the
sanctioned scroll (not merely present in the DOM — the property the cycle-4 structural check could
never have proven, per its own honest relabeling in cycle 5).

**The fix.** `frontend/src/shared/ui/DataGrid.tsx`'s `filteredEmptyCompact` comment stated the
collapsed floor as toolbar + header row + compact message ≈ 115.5px. That arithmetic never accounted
for `.ui-data-grid--full`'s `min-height` floor (D10-12, cycle 4) being UNCONDITIONAL — it applies
regardless of collapsed/expanded state, so the grid's own floor is 79.5px even while collapsed
(when the per-column row itself never renders), not the header row's bare 34.5px. Corrected: toolbar
(37) + compact message (44) + the grid's own unconditional floor (79.5) = **160.5px**. This is
~1.5px over the app's enforced minimum `.panel-content--table` height (159px, evaluation-2) — the
skeptic measured the live consequence as a small (~10px) scroll of `.panel-content--table` at that
exact minimum, with nothing user-facing hidden: the CSS floor doing exactly its job, not a
regression. The historical cycle-3 derivation of 115.5px above (written before the CSS floor
existed) is left in place as a historical record, annotated as superseded rather than silently
edited, per this ticket's own established practice of correcting rather than deleting a wrong figure.

**The guard-limitation note, made explicit (skeptic final-gate note).** Folded into both
`FRAME_FILTER_COLLAPSE_THRESHOLD_PX`'s and `GRID_MIN_USABLE_HEIGHT_PX`'s own doc comments in
DataGrid.tsx: the test suite's guards catch an INCOHERENT edit (lowering one constant while the
other stays at its corrected value — the arithmetic guard and the CSS-floor guard both go red). They
do NOT catch a COHERENT wrong pair — cycle 4 shipped `69` / `237`, a self-consistent but
INSUFFICIENT combination (CSS in sync with the threshold's own stated derivation, both computed from
an unmeasured term), and the ENTIRE suite stayed green against it, because every guard here checks
internal consistency between the constants and the CSS, never geometric sufficiency, which jsdom
cannot compute. Only a live sweep, in a real browser, at the actual boundary, on both surfaces, can
confirm sufficiency. This is now stated in-tree, not only in a gate report, so the next person who
touches either constant knows a green test run proves consistency, never correctness.

## Coverage limits (updated cycle 5)

- **Not yet independently re-swept at the CORRECTED boundary (247.5 / 79.5).** The evaluator
  live-verified BOTH cycle-4 remedies at the PRIOR values (threshold 237, floor 69) on both surfaces
  and both themes — PASS: the 7px crush repro collapsed instead of expanding, the app-chosen sweep
  transitioned cleanly with no unfittable state, the user-override path pinned at the floor with all
  61 per-column inputs present (93% visible, hit-testable, functional — substantively met even
  though the floor term itself was later found to be 10.5px short). That same live session is also
  the source of the corrected 45px per-column-row measurement (evaluation-4.md) driving cycle 5's
  247.5/79.5 correction, and the evaluator stated explicitly that "the app-chosen path needs no
  behavioural change" at the new figures. A fresh live sweep at exactly 247.5/79.5 has not been
  independently repeated by the executor (no browser tool in this session) — flagged so it is
  confirmed rather than assumed transitively.
- RESOLVED, no longer a limit: the compact filtered-empty message's height was confirmed live at
  **exactly 44px** (evaluation-3.md) — the CSS-derived estimate was correct.
- RESOLVED, no longer a limit: the per-column filter row's height is now live-measured at **45px**
  (evaluation-4.md), superseding the cycle-4 assumption that it shared the header row's ~34.5px.
- Density (`condensed`/`spacious`) on the panel surface remains untested-but-unreachable in the live
  app — `TableRenderer` never sets a `density` prop, so the full variant always resolves to
  `"normal"`; CR2's new selector/guard is real but has no live consumer yet.
- Single unbroken long token wrapping is covered by a static CSS guard (`overflow-wrap: anywhere`
  on `.ui-data-grid__filtered-empty`) only, not by real rendered content.
- `usePanelData`'s `String(v)` on the `rawRows` branch (object columns render/match as
  `"[object Object]"`) is untouched — owned by HEL-1033.
