# HEL-1605: Overview row-Delete confirm: wrong-row double-click on fresh rows, keyboard reveal under BottomNav, no pointer reveal

## Description

Three defects remain in the overview-row Delete confirm on Data Pipelines and Data Sources, which HEL-1574 introduced.
The HEL-1574 cycle-8 evaluator found them on head 24d446d5c, and the owner merged with this follow-up to run before
the release.

### 1. A double-click can open the confirm for a different row (fresh rows, narrow widths)

Opening the confirm re-renders the table. That recomputes `formatRelativeTime` on every row
(`SourceListTable.tsx:180`, `PipelineListTable.tsx:192,216`). At narrow widths the Updated column wraps. When a label
changes length ("just now" -> "3 seconds ago", or a minute boundary passing) the rows get taller, the clicked row is
pushed down under the pointer between the two presses, and Chrome's scroll anchoring adjusts `scrollTop`.
Repro (375px, /sources, fresh rows, real dblclick on the 16th row): first press hit "Delete P Row 06", second hit
"Delete P Row 08", the confirm opened for Row 08; rows moved 126-153px; scrollTop 404 -> 503; 2/2 at 375, also at 820
with the list at 400. Settled lists failed 0/45. Nothing is deleted without an explicit Confirm.
Suggested fix (a claim, not binding): a shared `useNow(60_000)` passed into `formatRelativeTime`, or a `nowrap` Updated
cell with a min-width.

### 2. At 375px the keyboard reveal puts the confirm under the BottomNav

The keyboard path scrolls the confirm to y 638-700; the floating BottomNav starts at y 632.
`scrollIntoView({ block: "nearest" })` does not account for the nav. Suggested fix: a phone-width
`scroll-padding-bottom` on `.app-content` equal to the BottomNav reserve.

### 3. A pointer Delete on a bottom row shows nothing

Since the cycle-8 `preventScroll` change, a pointer activation never reveals the confirm. Suggested fix: reveal after
the double-click window (e.g. a 500ms timer), cancelled if a second click arrives.

## Acceptance Criteria

- At 375px and at 820px with the list at 400, double-clicking a row's Delete on freshly created rows ("just now"
  labels), on both pages, leaves both presses on that row's Delete, opens exactly one confirm naming that row, and
  moves the row's top by less than 2px. The e2e test must not wait for the labels to settle before the double-click.
- Keyboard and pointer reveals at 375 leave the confirm's bottom at or above the BottomNav's top. An e2e test asserts
  this.
- A pointer Delete on a bottom row brings the confirm into view after the double-click window.
- (Driver/owner ruling `fixme-test-1605`) The `test.fixme` 375px double-click test in
  `e2e/hel1574-shell-rail.spec.ts` is re-enabled and passes on CI (which always seeds fresh rows).

## Binding owner rulings (HEL-1574) that must not regress

- Delete only on overview rows, never on detail pages (2026-10-14).
- The confirm opens as a row inserted directly under the clicked row.
- Delete button: secondary style at rest, danger on hover; 44px touch expander at phone widths.
- Focus returns after Cancel / Confirm / refused delete.
- `handleRowClick` ignores the actions cell and `event.detail > 1` (HEL-1604).

## Evidence

- `.concertino/runs/HEL-1574/evidence/openspec/changes/archive/2026-10-14-shell-rail-context-list/evaluation-8.md`
- `.concertino/runs/HEL-1574/evidence/eval-evidence-c8/` (probe script + screenshots)

origin_kind: followup
origin_ticket: HEL-1574
