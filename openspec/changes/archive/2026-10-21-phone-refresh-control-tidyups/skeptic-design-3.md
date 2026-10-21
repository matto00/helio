## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD edd3a028fa070f126d36993eba7fb8afa27c7d37 (= origin/main; change dir untracked). Artifacts: ticket.md, proposal.md, design.md, tasks.md, specs/mobile-dashboard-pull-refresh/spec.md, plus skeptic-design-1.md and skeptic-design-2.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/phone-refresh-control-tidyups/HEL-1681`.

- **Round-2 CR1, block axis: resolved.**
  - D3 now anchors the expander's top to the top of `.panel-list`'s padding (y = 0), so it spans y = 0..44.
  - Geometry re-derived from the tree:
    - The line is `PanelList`'s first child on the phone (`PanelList.tsx:313-316`), under `.panel-list { overflow: hidden }` (`PanelList.css:8`).
    - The phone padding is `var(--space-5) var(--space-3)` (`PanelList.css:108`).
    - The line is `height: calc(var(--text-xs) * 1.6)` with `margin: 0 0 var(--space-2)` (`DashboardMetaRow.css` `.dashboard-refresh-line`).
    - That puts the line at y = 20..39.2 and the chip row at y = 47.2.
  - The 44px box therefore fits inside `.panel-list` with 3.2px to spare.
  - The chip expanders are `top: 50%; height: 44px; translateY(-50%)` inside a 44px row with `overflow-y: hidden` (`DashboardChipRow.css`). So the chips' hit band starts at y = 47.2 and cannot overlap the new box.
  - The command bar does not overlay `.panel-list`'s top: `App.css:16` confines scrolling to `.app-content` below a bar that never moves. Task 2.4's corner probes would catch it anyway.
  - The root-font-size dependence is recorded as a CSS-comment obligation.

- **Round-2 CR1, inline axis: resolved.**
  - The expander is `right: 0` and 44px wide, so it grows toward the start only.
  - `.dashboard-refresh-line` is a block-level flex row at full content width. With the fact span set to `flex: 1`, the button sits flush at content-right = viewport − 12px, and the box spans [vw − 56, vw − 12], inside `.panel-list`.

- **Task 2.4: resolved.** It now uses `elementFromPoint` against the expander's real box at 375 and 430:
  - four inside corners and the centre hit the button;
  - a point 1px below the box misses it;
  - the chip's centre and a point 1px inside the chip's tap top still hit the chip;
  - the box lies inside `.panel-list`'s rect.

  The escalate-don't-shrink floor is kept in D3, in the Risks section and as standing constraint C1.

- **Round-2 notes adopted:** D3 seeds `MobilePanelStack`'s `busy` from `registry.busy`, and the font-size assumption is recorded.

- **Fresh pass over the whole plan:**
  - **D1:** `PanelList` still has a single JSX return (`:297`). Today the stack creates its registry at `MobilePanelStack.tsx:169` and disposes it at `:181`. D1 moves both to the provider, with a fallback for when no provider exists. The DOM-less provider wraps the whole `<section>`, so `.panel-list__zoom-container` keeps its position in the tree, and task 2.2 adds the node-identity check.
  - **D3 slot reservation:** `DashboardRefreshLine.tsx` reserves the slot for every pipeline-fed dashboard. Output-bound implies pipeline-fed (round 1 verified the predicate), so the button never arrives in a line that did not already exist. A `<button>` inside the `<p>` is valid phrasing content.
  - **D4:** `usePullToRefresh` attaches its touch listeners to the scroller (`usePullToRefresh.ts:246-249`). Engagement is gated on `busyRef`, so the spec's "a pull during a busy round starts nothing" is already true.
  - **No gaps:** there are no TODO/TBD placeholders, no contradictions between proposal, design, tasks and spec, and no scope drift. Every AC item (1 red-first e2e; 2-4 fixed or measured; 5 triaged) maps to a task with a stated acceptance signal.
  - **Contract:** no API or schema change, so no contract delta is needed. The spec delta adds requirements without contradicting the existing `mobile-dashboard-pull-refresh` spec.

### Verdict: CONFIRM

### Non-blocking notes

- **D3 wording.**
  - D3 says "`<the phone top padding token>`". It is `var(--space-5)`, so name it in the CSS.
  - D3 says the offset is "relative to the line". The `::after`'s containing block is the button (`position: relative`). This is equivalent only because the button fills the line's full height, so keep it that way. Otherwise anchor the box to the line.
- **Overlap with the fact text.** The 44px box overlaps about 24.8px of the end of the fact text. That text has only a hover `title` on its `<time>`, which is not interactive, so this is acceptable. Mention it in the PR's UI decisions.
- **Reversible UI choices for the PR's "UI decisions taken overnight" list:** the `RotateCw`/`Check` glyphs, the trailing placement, and suppressing the indicator during a button round (D4). Nothing here needs owner escalation.
