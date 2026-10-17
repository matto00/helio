# HEL-1583: Mobile dashboard + glass nav v2: tight gutters, dashboard chips, 5 expanding tabs

## Description

Mobile gutters are too large: page padding, card padding and markdown padding stack until body text sits ~57px from
each edge on a 375px screen. Switching dashboards on a phone means a dropdown. The glass bottom nav is loved and
stays, but has 6 icon-only tabs and room to improve.

Parent epic: HEL-1570 (v0.9 re-design). Blocked by HEL-1571 (DESIGN.md v3, merged). Related: HEL-1578, HEL-1574,
HEL-556 (swipe, stretch), HEL-774 (glass nav carve-out).

## What

* **Gutters:** 10–12px page edge, ~10px between panels, ~14px panel padding. Remove nested padding in markdown/text
  panels.
* **Header:** the dashboard name as a button (opens the switcher) plus overflow, with a mono "refreshed 9h ago" line.
* **Dashboard chips:** a horizontally scrollable chip row of pinned/recent dashboards under the header, with the
  active chip filled. Consider swipe between dashboards (HEL-556) as a stretch.
* **Glass nav v2:** 5 tabs (Dashboards, Data, Pipelines, Assistant, Me). Connectors folds into Data and Usage into
  Me. The **active tab expands into a pill showing its label** (animated with the motion primitives). Keep the HEL-774
  material and the >=3:1 contrast floors, re-measured.
* The zoom widget no longer floats over content (move it into the overflow menu, or hide it on phones).
* Reference: "Dashboard — mobile" (row 2) and the glass nav in "Motion study" on the epic's canvas
  (`.concertino/design/HEL-1570/`, mockup only; the board's serif title is NOT adopted, sans only).

## Acceptance criteria

- [ ] At 375px, text in a markdown panel starts <= 28px from the screen edge
- [ ] Chips switch dashboards in one tap, and the active chip is visible on load (scrolled into view)
- [ ] The glass nav has 5 tabs, the active one shows its label, Connectors and Usage remain reachable, and the HEL-774
  contrast floors re-measure >= 3:1 from rendered pixels in both themes
- [ ] Nothing floats over panel content except the glass nav, and content has bottom clearance for it

## Binding owner rulings and inputs (precedence: ACs + owner rulings, then DESIGN.md v3, then HANDOFF.md, then boards)

- The glass BottomNav stays; improve it, never remove it (HEL-1570 fixed constraint).
- Home is in the phone BottomNav (owner ruling 2026-10-14, relayed in HEL-1574).
- `keep-six-1583-decides`: this ticket chooses the final phone tab set (today 6 tabs, 7 for owners; overflow at 320px
  for owners). The ticket's 5-tab list predates Home. The final set is navigation other tickets build on, so it is
  escalated to the owner (pending), not decided overnight.
- HEL-1578 (concurrent) makes Home a real page at /home and moves the dashboard view to /dashboards (`home-at-home`).
- DESIGN.md v3 §12 Mobile and the HEL-774 contrast floor (expanded label: 4.5:1 from rendered pixels, or an opaque
  lozenge).
