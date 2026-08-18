## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-review — no reliance on round 1's specific findings assumed; ground truth re-derived
from scratch, then cross-checked against skeptic-final-1.md's own claims.

### What I verified (with evidence)

**Ground truth read fresh:**
- `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `files-modified.md` (incl. its Cycle 2 and
  Cycle 3 sections), `evaluation-1.md`, `evaluation-2.md`, `skeptic-final-1.md` — all read in
  full, treated as claims to verify, not fact.
- `git log --oneline` confirms commit `902e7e08` ("Hide redundant Disabled schedule badge in row
  layout (cycle 3)") is the top commit, addressing skeptic-final-1.md's sole change request.
- `git show 902e7e08` (full diff) read directly: `PipelineDetailHeader.css` (badge → `display:
  none` in the base row-layout rule, restored to `display: inline` inside the existing
  `@media (max-width: 1100px)` block) and `PipelineDetailHeader.tsx` (`title="Disabled"` added to
  the badge `<span>`) — matches the commit message and files-modified.md's Cycle 3 narrative
  exactly, byte for byte.
- Read `PipelineDetailHeader.css` and `PipelineDetailHeader.tsx` in full (current state, not just
  the diff) to understand the whole schedule field group's shrink-priority scheme.
- Confirmed the "Disabled" text badge (and the Toggle+badge pairing generally) is a byte-identical
  port from `main`'s retired `PipelineScheduleBar.tsx`/`.css` — not new UI, and on `main` this bar
  had its own full-width row (not squeezed into a 3-column header), so this exact width-crowding
  class of defect did not exist pre-ticket. Confirmed `Toggle.tsx`/`Toggle.css`: native `<input
  type="checkbox" role="switch">` with `checked` bound reactively and a color/position-changing
  track+thumb — enabled/disabled state is conveyed both visually (color + thumb position) and to
  assistive tech (native `aria-checked` from the checkbox's `checked` property), independent of
  the "Disabled" text badge.

**Servers:** `start-servers.sh`/`assert-phase.sh servers` → `PASS servers` (backend/frontend
reused, already healthy). The `emit-event.sh: No such file or directory` warnings are the same
disclosed, non-blocking, pre-existing environmental gap skeptic-final-1.md already noted (stale
branch point missing several `scripts/concertino/*` files present on `main`) — confirmed present
in this worktree via `ls scripts/concertino/`.

**Live re-verification of skeptic-final-1.md's fix (CR1), fixture pipeline "Profit (migrated)"
`/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485`, interval+disabled schedule state (as found):**
- **1440px**: `.pipeline-detail-header__schedule-disabled-badge` → `{width: 0, scrollWidth: 0,
  display: "none"}` — not rendered, nothing to truncate. `__schedule-expression` → `{width: 70,
  scrollWidth: 70}`, full "Every 1m". Screenshot confirms: clean row, no "Dis…" fragment anywhere,
  Toggle visibly in the off/muted position conveying disabled state on its own. **CR1 genuinely
  fixed.**
- **1100px (canonical, stacked layout)**: badge `{width: 65.2, scrollWidth: 63, display: "block"}`
  — fully visible ("DISABLED"), matches files-modified.md's claimed numbers exactly. `__source-name`/
  `__type-name` also full width = scrollWidth. Screenshot confirms clean 3-row stack.
  768px/430px: same, screenshots clean, no regression from round 1's confirmed-good state.
- **430px regression check**: re-measured all six action-button heights
  (`edit-btn`×3/`run-btn`/`share-btn`/`history-btn`/`preview-btn`/`dry-run-btn`) — every one still
  exactly 44px (HEL-687 floor intact, unaffected by a header-only CSS change).
- **1101px (disclosed residual, non-canonical)**: re-measured — initially my own
  `getBoundingClientRect()` read suggested `__schedule-expression` was fully visible (width ==
  scrollWidth == 70), which looked like an *improvement* over files-modified.md's claim that this
  residual is "unchanged from cycle 2." I did not stop at that single reading (an anomalous result
  contradicting the report is a re-run/re-derive trigger, not a verdict) — computed the group's
  actual visible (unclipped) portion via child-vs-ancestor rect intersection instead of raw
  `getBoundingClientRect().width` (the same false-positive trap evaluation-2.md's own report
  documents for the badge/button "overlap" check), and confirmed only ~6px of the 70px-wide
  expression element is actually painted before the `overflow: hidden` ancestor clips it —
  screenshot confirms it renders as a bare "E" sliver, matching files-modified.md's claim.
  **No discrepancy; my first reading was mismeasured, not the report.**

**New live testing beyond what any prior review round covered — other schedule states, per this
round's brief:**
- **No-schedule state** ("Popover Test Pipeline"): "No schedule set" renders fully legible at
  1440px, no truncation (screenshot). Matches round 1's finding for this same fixture.
- **Enabled-schedule state with a computed next run** (toggled "Profit (migrated)"'s schedule on
  live via the UI switch, screenshot + measured, then toggled back off to restore the pipeline to
  its original disabled state used by all three prior review rounds — confirmed restored via a
  fresh page reload showing the "Disabled" badge again post-restore) — **found a new, real,
  reproducible defect, detailed below.**

### New finding: `.pipeline-detail-header__schedule-next-run` ellipsis-truncates to near-nothing
at 1440px when a schedule is enabled with a computed next run

None of `evaluation-1.md`, `evaluation-2.md`, or `skeptic-final-1.md` ever rendered
`__schedule-next-run` — it is only rendered `{schedule.enabled && nextRun !== null}`
(`PipelineDetailHeader.tsx:141-143`), and every review round's fixture pipeline was in the
**disabled** schedule state throughout, so this element was never actually painted or measured by
any of the three prior review passes despite being explicitly discussed and re-prioritized in the
cycle-2 CSS comments ("a legitimate, lower-priority shrink target... ellipsis-truncates before
`__schedule-expression` does" — `PipelineDetailHeader.css:132-138`).

Toggling the fixture pipeline's schedule to **enabled** (a real interval schedule, "Every 1m")
computes and renders `next run <formatted date>`. At **1440px** (DESIGN.md §4's widest canonical
breakpoint):

- `width: 41.36px` vs `scrollWidth: 165px` (text: `"next run Aug 17, 2026, 7:15 PM"`) —
  reproduced identically on a second, fresh page load (`width: 41.36px`, `scrollWidth: 165px`,
  same date recomputed) after toggling the schedule back on again — not measurement noise.
- Screenshot (`.pipeline-detail-header` locator, 1440px, light theme) confirms visually: the text
  renders as **"next r…"** — the entire date/time (the only place this information appears
  anywhere on the page) is hidden.
- Confirmed this is layout-range-specific, not universal: at **1100px** (stacked layout, same
  enabled schedule), `next-run` renders at `width: 164.56px ≈ scrollWidth: 165px` — fully legible,
  no truncation. The defect is confined to the row-layout width range, same as CR1 was.
- Confirmed this is a genuine *new* regression versus `main`, not carried-over pre-existing debt:
  `main`'s retired `PipelineScheduleBar.css` styled `.pipeline-detail-page__schedule-next-run`
  with only `white-space: nowrap` — **no `overflow: hidden`, no `text-overflow: ellipsis`, no
  `min-width` floor** — because the old bar was a full-width row with ample space; this text never
  truncated on `main`. The redesign's 3-column header is what first creates the space pressure,
  and cycle 2's fix (which added `overflow: hidden`/`text-overflow: ellipsis`/`min-width: 24px` to
  demote this element to a "lower-priority shrink target," `PipelineDetailHeader.css:139-146`) is
  what turns that pressure into a truncation defect — the same causal chain as CR1
  (`__schedule-disabled-badge`) and evaluation-1.md's original CR2 (`__schedule-expression`), just
  on a third sibling in the same field group that happened to never get exercised by any fixture
  used so far.
- Unlike the "Disabled" badge (redundant with the Toggle's own visual/AT-exposed state, which is
  why hiding it was a legitimate fix), the next-run date has **no redundant equivalent anywhere
  else on the page** — hiding it outright would be a real information loss, not a legitimate
  "already conveyed elsewhere" trade-off. This needs a different treatment than CR1's (e.g. a
  shorter date format, a `title` tooltip fallback carrying the full text, or revisiting the
  group's shrink-priority/min-width scheme), not a copy of the badge's `display: none` fix.

This is the same failure category (short/informational header text ellipsis-truncated below its
full content at 1440px, DESIGN.md's widest canonical breakpoint) that has now been treated as
blocking twice already in this ticket's own review history (evaluation-1.md's CR2 for
`__schedule-expression`; skeptic-final-1.md's CR1 for `__schedule-disabled-badge`) — both times
on the exact same field group. Accepting it a third time, on a sibling element carrying strictly
more (non-redundant) information, would be a materially inconsistent bar, for a schedule state
(enabled, with a computed next run) that is arguably the *more* common real-world case than the
disabled fixture every review round has exclusively tested against.

### Acceptance criteria — re-traced

- **AC1** (one header, one footer, ≤1 info bar above step list) — met, confirmed structurally and
  visually, unaffected by cycle 3's header-only change.
- **AC2** (all actions reachable, no loss of function) — action reachability confirmed via live
  accessibility snapshot at 1440px: `button "Edit source"`, `button "Edit type"`, `button "Edit
  schedule"`, `switch "Enable schedule"`/`"Disable schedule"`, `button "Share"`, `button "Open run
  history"`, `button "Preview"`, `button "Dry run"`, `button "Run pipeline"`, `button "Edit
  pipeline name"` — all present with pre-existing accessible names, all clickable/functional
  (exercised the schedule toggle live, twice). Hiding the redundant "Disabled" text badge does
  **not** violate this AC (state remains knowable via the Toggle's own visual+AT-exposed state,
  and this was never listed as a distinct "action"). However, the new next-run truncation finding
  above is arguably an AC2 information-loss regression in its own right (the next-run time becomes
  visually unrecoverable, not merely relocated) — not literally an "action" per the AC's own
  wording, but the same substance evaluation-1.md's and skeptic-final-1.md's own change requests
  were built on.
- **AC3** (works cleanly at 430px) — re-confirmed: all six action buttons still exactly 44px tall;
  header/footer both stack correctly; no regression from cycle 3's change (header-only, and this
  media range is unaffected by the badge's `display` toggle either way).

### Fresh gates re-run myself

- `npm run lint` (frontend) → 0 warnings/errors, reproduced fresh.
- `npx jest --testPathPatterns="PipelineDetailPage|PipelineDetailHeader|PipelineDetailFooter"` →
  **3 suites / 129 tests passed**, including the HEL-687 `PipelineDetailPage.css.test.ts` guard —
  unchanged from round 1's reproduction.
- Console: 0 errors/0 warnings across every viewport/theme/schedule-state combination tested
  (one pre-existing, expected 404 on `GET .../schedule` for the no-schedule fixture, matching
  `main`'s behavior for that same "schedule not yet set" case — not a regression).

### Verdict: REFUTE

Skeptic-final-1.md's sole change request (1440px "Disabled" badge truncation) is genuinely fixed,
verified independently with fresh measurements and screenshots, and does not reintroduce or
regress any of round 1's other confirmed-good findings (1100px invisibility/overlap, 430px mobile
floor, accessible names, dark theme). But this round's independent testing of a schedule state
none of the three prior review passes ever exercised — an **enabled** schedule with a computed
next run, arguably the more representative real-world case — surfaces a new, real, reproducible
instance of the exact same failure category already treated as blocking twice in this ticket's
history, on a third sibling element in the same field group. This is not a repeat of an
already-adjudicated issue; it is a fresh defect this round's ground-truth testing was specifically
scoped to surface, and it meets the same bar this ticket's own review history has already set.

### Change Requests

1. **`frontend/src/features/pipelines/ui/PipelineDetailHeader.css`
   (`.pipeline-detail-header__schedule-next-run`, currently lines 139-146)** — at 1440px
   (DESIGN.md §4's widest canonical breakpoint), when a schedule is enabled and has a computed
   next run, this element renders the text `next run <date>` at `width: 41.36px` against a
   `scrollWidth: 165px` — ellipsis-truncated to "next r…", hiding the entire date/time (confirmed
   reproducibly across two fresh page loads with two different computed dates). Unlike the
   "Disabled" badge, this text has no redundant equivalent elsewhere on the page, so `display:
   none` is not an available fix here without a real loss of information — needs a treatment that
   keeps the information visible/recoverable, e.g.: a more compact date format that fits the
   group's real available width at 1440px (measure first: confirm what width budget is actually
   left after the Toggle + `__schedule-expression`'s own floor), a `title="<full formatted
   date>"` hover/keyboard fallback (mirroring the approach just used for the "Disabled" badge,
   though note this alone doesn't fix the *visual* truncation, only recoverability), or revisiting
   this field group's shrink-priority scheme now that a third element (not just the two already
   fixed) is known to compete for the same ~161px box at 1440px. Re-verify at exactly 1440px with
   an **enabled** schedule that has a real computed `nextRunAt` (the fixture pipeline used
   throughout this ticket's review history, `/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485`,
   works — toggle its schedule on, confirm `next-run`'s `scrollWidth` fits within its rendered
   `width` with no ellipsis engaged, then toggle back off to restore its disabled fixture state)
   that `scrollWidth` no longer exceeds `width` for this element. Also spot-check the `nextRun ===
   null` ("no next run yet") branch at 1440px while in this area, since it renders through the
   same element/CSS rule (shorter text, likely fine, but not yet independently measured by any
   review round).

### Non-blocking notes

- Carried-over literal px spacing values (`gap: 12px`, `padding: 10px 20px`, `padding: 2px 6px`)
  — still non-blocking, unchanged since round 1, byte-identical carryovers from the retired bar
  components.
- The disclosed ~1101–1330px tight-clipping window for `__schedule-expression` (outside DESIGN.md
  §4's four canonical breakpoints) — re-confirmed present and unchanged by cycle 3's edit (still
  degrades to a legible-but-tight sliver, never overlapping/garbled). Agree with evaluation-2.md's
  and skeptic-final-1.md's judgment that this is acceptable given the ticket's "no visual redesign
  beyond consolidation" non-goal and that it falls outside the canonical breakpoint set DESIGN.md's
  mechanical rule binds.
- Dark theme parity spot-checked at 1440px (disabled-schedule fixture state) — clean, no
  regression, badge correctly absent, "Every 1m" full width.
- Toggling the fixture pipeline's schedule on (to test the enabled state) caused its real 1-minute
  interval schedule to fire once during testing (run history count went from 7 to 9, "Last run:
  1 minute ago" observed) before I toggled it back off — a benign, expected side effect of
  exercising a real interval schedule against the shared dev DB, not a defect; disclosed for the
  record. The pipeline's schedule was confirmed restored to its original disabled state (verified
  via a fresh page reload showing the "Disabled" badge) before ending this review.
- Structural/code quality (labelForKind relocation, footer absorption, spec deltas, test porting,
  the cycle 3 fix's own reasoning and code comments) remains clean and well-documented — no further
  concerns there.
