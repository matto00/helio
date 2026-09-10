## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read the revised `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/data-grid/spec.md` in the change dir, cold, against my own round-1 findings.
- Ground truth re-checked directly in the worktree, not via the docs:
  - `sed -n '330,365p' frontend/src/shared/ui/DataGrid.css` — confirms `tbody td`
    (`border-bottom: 1px solid`, `max-width: 240px`), `tbody tr:last-child td { border-bottom:
    none }` at 342-344, and the three per-density padding/font-size blocks. D6 describes these
    accurately.
  - `grep -n "aria-\|<table\|role=" frontend/src/shared/ui/DataGrid.tsx` — confirms the table is
    still a bare `<table>` (line 790) with `role="region"` on the scroll div (789) and no
    `aria-rowcount`/`aria-rowindex` anywhere. D5's premise is accurate.
  - `grep -rn "HEL-520" openspec/changes/virtualize-table-rows/` — see CR1: the corrected text
    landed, but two uncorrected instances of the same false citation remain.

**CR1 (HEL-520 false citation)** — partially addressed. `ticket.md:40` and `design.md`'s Context
paragraph are now correct and well-evidenced, and `tasks.md` 2.5 was restated to the real
`<thead>` controls. But two instances of the refuted claim survive; see CR1 below.

**CR2 (pre-measurement fallback)** — partially addressed. D3 is correctly rewritten and new task
1.5 states the bounded-initial-window requirement. But task 1.2 still carries the old instruction
verbatim; see CR2 below.

**CR3 (screen-reader row semantics)** — addressed. D5 is an explicit decision (header-inclusive
`aria-rowcount`, true 1-based `aria-rowindex`, `aria-hidden` spacers, applied identically on the
bypass path); task 1.6 implements it; task 3.1 asserts it; `specs/data-grid/spec.md` gained a
matching requirement + scenario. Traceable end to end. No further action.

**CR4 (spacer geometry)** — addressed. D6 names the exact inherited rules, requires a dedicated
spacer-cell class zeroing padding/border/max-width, omits the trailing spacer at height 0, and
replaces the `:last-child` dependency with an explicit `border-bottom: none` on the true last
data row so the divergence cannot occur mid-scroll. Task 1.4 restates all of it. No further action.

D7 also resolves my round-1 non-blocking scroll-source note correctly (plain `RefObject`, reuse
rather than a second `ref={}`).

### Verdict: REFUTE

The architecture is unchanged from round 1 and I still endorse it. Two of the four required
revisions were applied to one location each but left an uncorrected duplicate elsewhere in the
binding artifacts — in both cases the surviving text is the exact text I refuted, and in CR2's
case it is in `tasks.md`, the document the executor works from.

### Change Requests

1. **The refuted HEL-520 citation survives in two places the corrections did not reach.**
   `grep -rn "HEL-520" openspec/changes/virtualize-table-rows/` shows:
   - `design.md:54` (inside **D2**): "absolutely-positioned rows would break `<tbody>` row
     semantics (screen readers, HEL-520's focus-presence guard)". This is the same nonexistent
     guard the same document declares nonexistent 43 lines earlier — a direct self-contradiction
     in the binding design doc. Delete the clause; D2's choice stands on `table-layout: fixed`
     and sticky-offset flow alone and needs no invented third justification.
   - `proposal.md:19`: "Preserve keyboard scroll, focus, and screen-reader row semantics
     (DESIGN.md §8), including the HEL-520 rendered focus-presence guard." `proposal.md` was not
     revised at all this round. Restate it the way `ticket.md` AC5 and `tasks.md` 2.5 now do
     (header-row `<thead>` controls: resize handle, pin toggle, filter inputs), and — now that D5
     exists — add the `aria-rowcount`/`aria-rowindex`/spacer-exclusion clause so the proposal's
     goal list matches the design and spec it summarizes.

2. **`tasks.md` 1.2 still instructs the exact behavior CR2 refuted, contradicting D3 and new task
   1.5.** Task 1.2 ends: "fall back to unwindowed rendering before first measurement." That is
   verbatim the pre-measurement all-rows fallback D3 was rewritten to remove and that task 1.5 was
   added to replace. An executor working the task list top-to-bottom implements 1.2 (mount all
   5,000 rows pre-measurement), then reads 1.5 telling it not to. Strike the trailing clause from
   1.2 so the measurement instruction stands alone and the pre-measurement render behavior is
   specified in exactly one place (1.5 / D3).

### Non-blocking notes

- D5 puts `aria-rowcount`/`aria-rowindex` on a plain `<table>` with no `role="grid"`. That is
  valid (both attributes are supported on the implicit `table` role), so no change is required —
  but if implementation finds a screen reader ignoring them, the fix is to add `role="grid"`
  deliberately, not to drop the attributes.
- My round-1 notes on `TableRenderer` never passing `density` (synthetic multi-density coverage)
  and on D4's threshold value being an empirical deferral are both now recorded in `design.md`.
  Nothing outstanding.
