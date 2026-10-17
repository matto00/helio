## Context

See proposal.md (Why). Measured chain today at 375px (left edge to markdown text): `.panel-list` phone padding
`--space-5` 20px + `.mobile-panel-stack` padding `--space-3` 12px + card border 1px + `.panel-grid-card` padding
`clamp(--space-3, 2vw, --space-5)` 12px + `.markdown-panel` padding `--space-3` 12px = 57px (DESIGN.md §12 agrees).
`PanelGrid` switches to `MobilePanelStack` below a 768px *container* width; `mobilePanelHeights.ts` hardcodes the
stack chrome (`STACK_CONTAINER_PADDING_PX`, `STACK_CARD_PADDING_PX`) for stack content-width/height resolution. The zoom widget is
`position: fixed`, hidden <=430px but floating above the nav in 431–768px. The phone command bar already has the
dashboard-name button (opens `MobileNavSheet`) and a "Dashboard actions" kebab. `recentHistoryStore` (HEL-503) holds
recently visited dashboards in localStorage. Concurrent: HEL-1578 (routes `/home` → Home, dashboard view →
`/dashboards`, `isDestinationActive`), HEL-1576 (parked; `useDashboardMeta` for the "refreshed" line), HEL-1572
(density tokens).

## Goals / Non-Goals

**Goals:** Phase A — gutters, chip row, zoom widget off the phone shell, bottom clearance, all independent of the
pending tab-set ruling. Phase B (after the ruling) — glass nav v2 and the refreshed line.
**Non-Goals:** swipe (HEL-556), any new preference field, desktop gutters (HEL-1576), changing saved layouts or saved
zoom values, serif title.

## Decisions

**D1. One gutter owner on the phone stack: `.panel-list`.** All D1 rules apply only inside the existing
`@media (max-width: 768px)` phone blocks (stack rules may also be scoped to `.mobile-panel-stack`, which only renders
there). On the phone shell `.panel-list` keeps owning the edge
inset but at `var(--space-3)` (12px, §12) inline instead of `--space-5`; the stack's own inline padding becomes 0, its
gap `calc(var(--space-3) - 2px)` (10px, a §3 optical tweak <=4px from a token), and the stacked card padding
`calc(var(--space-3) + 2px)` (14px, same rule). Keeping the inset on `.panel-list` (skeptic r1 CR1/CR2) means (a) the
`PanelGrid` container is still < 768px at a 768px viewport (744px), so the phone shell never gets the desktop grid
even with overlay scrollbars, and (b) every other `.panel-list` child (StatusMessage, FirstRunDropZone,
OnboardingChecklist, CrossFilterIndicator, empty states) sits 12px from the edge too. Markdown (and any other
plain-text panel body with its own horizontal inset inside the card) drops that inset inside the stack only. Result:
12 + 1 + 14 + 0 = 27px <= 28px, confirmed from rendered pixels (`getBoundingClientRect` of a text Range after
`document.fonts.ready`). The desktop grid is untouched. `mobilePanelHeights` stack-chrome constants (used by
`resolveStackContentWidth`/height policy) are re-derived from the new values, tests recounted not loosened. A test pins
that the stack, not the grid, renders at a 768px viewport with zero-width scrollbars (a unit test with a mocked
container width of 768 - 24, or Playwright `isMobile` emulation, since headless Chromium has classic scrollbars).

**D2. Zoom on the phone shell.** `PanelList` does not render the zoom widget when `useIsPhoneShell()` is true (DOM
absent, not just hidden; the CSS hide stays as a backstop), and the stack renders at an effective zoom of 1.0 there. The ctrl/meta-wheel zoom handler is also inert on the phone
shell, so nothing writes a saved level from a phone.
The saved per-dashboard level is not written or cleared. Why not "move into overflow": phones have no ctrl-wheel/pinch
path to the grid's zoom, the stack is single-column, and a saved desktop 50% made phone text unreadable with no
visible reset. Reversible; listed in the PR.

**D3. Chip row placement and behaviour.** A new `DashboardChipRow` (features/dashboards/ui) is the first child of
`.panel-list` on the phone shell (Phase B: second, after the D11 refresh line), outside `.panel-list__zoom-container`, in normal flow — not sticky, so nothing but
the glass nav floats over content (AC 4) and it is route-correct by construction (only the dashboard view mounts
`PanelList`). It sits below whatever renders above `PanelList` (e.g. `FirstRunRefineBar`). The row bleeds to the
screen edges (`margin-inline: calc(-1 * var(--space-3))`) with `padding-inline` and `scroll-padding-inline` of
`var(--space-3)`, so chips start 12px from the edge and scroll edge to edge. Order (from `state.dashboards.items`,
never the panels list): dashboards from `loadRecentHistory()` (kind `dashboard`, still present), then the rest in
`state.dashboards.items` order, capped at 12. The order is a **session snapshot held at module scope** (taken the first
time the row renders after load, keyed by the signed-in user id so a different user never inherits it, and
exposed with a test-only reset helper), so neither a tap nor the `PanelList` remount that a
`/home` -> `/dashboards/<id>` navigation causes reshuffles the row; new dashboards append at the end; if the current
dashboard falls outside the cap it takes the last slot (intended: the one exception to stability); with no dashboard
selected no chip is active. Tap (skeptic r1 CR3) = `dispatch(setSelectedDashboardId(id))`
**and** `navigate(/dashboards/<id>)` (skipped when already at that URL), so a tap always switches even when the sheet
changed the selection without changing the URL. A "More" chip is not added; the name button's sheet stays the full
switcher.

**D4. Chip visuals and the active chip.** Pill chips, sans (§3 type scale), outlined `--app-border-subtle` inactive;
active filled with inverted ink (`--app-text` fill, `--app-surface` text), matching the board without spending the
accent (§0 accent discipline). `aria-current="true"` on the active chip. Contrast of every chip label >=4.5:1 measured
in both themes. Visual height 32px with the `tapTarget.css` `::after` pattern for a 44px hit area; row gap and
vertical padding chosen so the expanders tile without overlap (the HEL-774/HEL-813 rule).

**D5. Active chip in view.** On mount and when the current dashboard changes, set the row's own `scrollLeft` so the
active chip is fully visible (with one gutter of breathing room) — never `element.scrollIntoView`, which would also
scroll the page vertically. Instant on load; on change use `behavior: "smooth"` unless reduced motion is in force.

**D6. Header.** Phase A keeps the existing name button + kebab (they already satisfy "name as a button plus
overflow"). The mono "refreshed" line waits on escalation question 2 (recommended: wire HEL-1576's `useDashboardMeta`
once it merges). No logo or title restyle in this ticket.

**D7. Bottom clearance.** Keep the single `--bottom-nav-height` clearance on `.app-content`; add no second floating
element. Verified by an e2e that scrolls to the end and asserts the last card's bottom <= the nav's top at 375px.

**Phase B (finalised 2026-10-16 on the owner's recorded answers, escalation `HEL-1583-1792056262977-6fc1da`:
`assistant-to-header`, `wire-after-1576`; re-gated by a fresh design skeptic).**

Precondition: Phase B is built on HEL-1578's routes (`/home` = the Home page, `/dashboards` and `/dashboards/:id` =
the dashboard view, `homeAlias` marked current on `/home`, the shared `isDestinationActive` in
`shared/chrome/navDestinations.ts`) and on HEL-1576's `useDashboardMeta`. Merge origin/main into the branch first. If
HEL-1578 has not merged when Phase B starts, stop and report rather than re-implementing its route move (the driver
rule: whoever merges second integrates; never duplicate route constants). If HEL-1573 (motion primitives, PR #1050)
has merged, use its role tokens / primitives for D9 (see there); if not, use the existing motion tokens and note it.

**D8. Phone tab set: Home, Dashboards, Data, Pipelines, Me (owner answer `assistant-to-header`).**
- Phone only. The desktop rail and `useNavDestinations` (rail) are unchanged: Connectors, Assistant and the
  owner-only Usage keep their rail entries. The phone list is a separate, explicit derivation in `navDestinations.ts`
  (`phoneNavTabs`, built from `homeAlias` and the existing `sections`/`navDestinations` entries, not new route
  literals). It is never a parallel registry.
- **Home** is `homeAlias` (`/home`). **Dashboards** is the existing `/dashboards` destination. **Pipelines** is the
  existing `/pipelines` destination.
- **Data** opens `/sources` and is current on `/sources*` **and** `/connectors*`. On the phone shell both pages
  show a two-link sub-row, "Sources | Connectors" (`DataSectionTabs`, real `<Link>`s with `aria-current="page"`,
  44px hit areas, the chip-row pill styling from D4 reused rather than restyled). This is what makes Connectors
  reachable. It is not shown above 768px.
- **Me** is a `<button>` tab (not a route) that opens the existing `UserMenu` menu: Settings, Usage (owners only),
  Getting started, Sign out. Reuse `UserMenu` with a trigger variant (e.g. a `renderTrigger`/`variant="tab"` prop) so
  the menu, its keyboard handling and its owner gating stay in one component. Me is shown as current on `/settings*`
  and `/admin/usage*`. The popover opens upward from the nav and sits above it in z-order. The phone CommandBar no
  longer renders the avatar `UserMenu` (Me replaces it). The desktop rail's avatar is unchanged.
- **Assistant** leaves the phone nav. The header's existing "Open assistant" button (`CommandBar`, unconditional
  except on `/chat`) stays the entry point, and the quick launcher's existing "browse" link reaches `/chat`. On
  `/chat` itself the existing phone "New chat" control stays. Tier scoping (skeptic r3 #5): the quick launcher's
  "Browse all conversations" link renders only for non-free tiers. A free-tier user's `/chat` shows the same
  request-access state that the quick launcher's `ActiveConversationPanel` already shows them. So for a free-tier
  user the Assistant destination is the overlay itself, reached in one tap, and no new `/chat` link is added for
  them. The no-trapped-route claim is therefore: every top-level destination whose content the user's tier can use
  is reachable within two taps. It is tested for both a free and a beta user.
- Me tab semantics: a `<button aria-haspopup="menu" aria-expanded>`. Its active state is `aria-current="true"` on
  the button (never `"page"`: it is not a link) plus the same active class. `NavDestination` gains an optional
  `kind: "menu"` variant, modelled as a discriminated union (`{kind: "route", to, ...} | {kind: "menu", ...}`) so no
  placeholder `to` exists. The Me menu popover is portalled to `document.body` (the existing `usePortalPopover`), so
  it never renders inside the nav's `backdrop-filter`/`z-index: 5` stacking context. The phone labels "Data" and
  "Pipelines" (registry labels "Data Sources"/"Data Pipelines") are overrides that live in `phoneNavTabs` only; the
  registry, breadcrumb and rail keep their labels. Phone-width e2e specs that click the header
  "User menu" are moved to the Me tab in the same change.
- Active state: extend HEL-1578's `isDestinationActive` with an optional `activePrefixes` field on `NavDestination`
  (Data: `/connectors`; Me: `/settings`, `/admin/usage`). Exactly one tab is current on every authenticated route that
  belongs to one of them, and none on routes that belong to none (e.g. `/chat`, review routes).

**D9. Expanding labelled active tab (revised after skeptic r3 #2/#3).**
- Every tab renders icon + label inside the existing `.bottom-nav__lozenge` carrier. The label is in the DOM on every
  tab but collapsed (`max-width: 0`, `opacity: 0`) and `aria-hidden` on inactive tabs. The accessible name stays the
  tab's `aria-label`, so a collapsed label adds nothing to it.
- Sizing (revised after skeptic r4 #2): widths are driven by content only. Every tab is `flex: 0 1 auto` with
  `min-width: 44px`, and the bar spreads the tabs with `justify-content: space-evenly`. No tab ever changes
  `flex-basis` or `flex-grow` on activation; the only property that changes size is the label's `max-width` (0 to a
  cap of `calc(var(--space-6) * 4)`) and the lozenge's inline padding (`--space-2` to `--space-3`), both on the
  same token timing. The `BottomNav.css.test.ts` pin "transition on background only" is replaced deliberately. The
  width transition is therefore one continuous interpolation, and the
  outgoing tab's lozenge shrinks with its own label instead of spilling. The label is `min-width: 0`,
  `overflow: hidden`, `white-space: nowrap` and `text-overflow: ellipsis`. The lozenge is bounded too
  (`.bottom-nav__lozenge { min-width: 0; max-width: 100% }`, skeptic r5 CR1). Without that, the tab's column flexbox
  with `align-items: center` would keep the pill at its full content width and spill it into the neighbouring tabs.
  The active tab can shrink to its 44px floor, so at 320px a long label truncates inside its own tab. Expected at
  320px: a 278px content box minus four 44px inactive tabs leaves about 102px for the active tab. After the tab's
  2px inline padding each side, the 24px lozenge padding, the 22px icon and the `--space-1` gap, that is about 48px
  of label. "Dashboards" truncates there; "Pipelines" may. This is measured,
  not assumed, with Dashboards and then Pipelines active.
- Label type: `--font-sans`, `--text-xs` (12px), `--weight-semibold`. It is normal-size text, so the floor is
  4.5:1.
- Lozenge geometry: inactive lozenges use `--space-2` inline padding (38px wide inside the 44px floor). The active
  lozenge uses `--space-3` inline padding plus icon, gap and label. The hit area is the whole tab, at least 44x44,
  with no overlaps.
- Replaced invariant: HEL-774's "every tab's lozenge carries identical geometry" (`BottomNav.css.test.ts`, the
  `.bottom-nav__lozenge` padding pin) cannot hold once the active lozenge grows. It is replaced, not dropped. The new
  pins are: identical block padding (`--space-1`) and radius on every lozenge in every state; an icon glyph that
  keeps its 22px box and vertical position on activation (asserted in e2e from rendered boxes); and growth only
  along the inline axis, via the label.
- Label colour: `--app-text` (full ink), pinned by a CSS test. The accent stays on the active icon alone, unchanged
  from the HEL-774 rule, so the label's 4.5:1 floor is independent of the accent preset.
- Motion: the HEL-1573 role token for a layout/size change if #1050 has merged, else `--motion-duration-standard` /
  `--motion-ease-out`. It is instant under the existing gating pattern (`:root:not([data-motion])` inside
  `prefers-reduced-motion: reduce`, and `:root[data-motion="off"]`), extending the existing lozenge rule. It is
  pure CSS, with no JS primitive: the expansion is per-tab, not a travelling indicator. This is reversible and
  listed in the PR. It is covered by the existing reduced-motion requirement, so no new requirement is added.

**D10. Active lozenge treatment and contrast (revised after skeptic r4 #1; owner answer `opaque-pill-text-ring`,
escalation `HEL-1583-1792194842888-26a3dd`, recorded 2026-10-16).** Computed from `theme.css` values by the r4 skeptic, and to be confirmed from rendered pixels:
- Today's active lozenge (22% accent wash, no border since commit #460) measures 1.04–1.40:1 at its edge against the
  capsule. That already fails the HEL-774 >=3:1 lozenge-edge floor in the canonical spec and DESIGN.md §3; no e2e
  measures it today.
- A visible `--app-text` label on that wash computes to 3.30:1 for dark theme over a white backdrop, which fails
  4.5:1.
- A 1px `--app-border-strong` ring computes to 1.16–2.31:1, so it fails too. DESIGN.md §3 already requires a
  full-strength `--app-text` hairline for this reason.
- **Treatment (owner's answer `opaque-pill-text-ring`):** the capsule stays translucent glass, unchanged: the
  `backdrop-filter`, the 55% tint and the `--app-border-strong` capsule border all stay. Only the active pill
  (`.bottom-nav__tab--active .bottom-nav__lozenge`) becomes an opaque `--app-surface-strong` fill with a 1px
  `--app-text` ring. The ring is an `inset` box-shadow or a border paired with matching transparent geometry on
  inactive lozenges, so the pill's box never shifts on activation. The active icon keeps its accent colour; the label
  is `--app-text`. Inactive lozenges stay transparent, with no fill and no ring. Expected, computed by the r4
  skeptic: edge 3.44–16.89:1 and label 13.6–16.7:1. The executor measures these from rendered pixels (C1). **If any
  backdrop falls below 3:1 edge or 4.5:1 label, the executor reports it with the numbers and does not adjust the
  treatment silently.** A shortfall is surfaced to the owner, never fixed in-loop.
- Every number is re-measured from rendered pixels (C1) at 320/375/768 in both themes over the
  backdrops the spec names: glyphs >=3:1, lozenge edge >=3:1 on a straight segment, label >=4.5:1. The
  `BottomNav.css.test.ts` pins change deliberately (the "no border" / "tinted highlight fill" pins are
  replaced by pins for the opaque fill and the `--app-text` ring, never loosened). DESIGN.md §3 (carve-out text) and §12 (phone nav: five tabs, expanding label) are
  updated to match. `hel1574-shell-rail` and any e2e that counts six or seven phone tabs are updated. A new e2e
  measures the lozenge edge, which closes the gap that let #460 drift.
- **Accent-text contract (HEL-1048); owner answer `keep-022-superset` (escalation HEL-1583-1792195675424-f23c83):** removing the 22% accent wash orphans
  `ACCENT_TEXT_INLINE_TINT_STRENGTHS = [0.22, 0.2]` in `appearance.ts`. It also breaks
  `accentTextSourceSyncGuard.css.test.ts` (lines 83–99, which parse the tint out of `BottomNav.css`) and leaves
  DESIGN.md lines 937 and 1553 stale. Resolution: 0.22 stays in `ACCENT_TEXT_INLINE_TINT_STRENGTHS`, so
  `--app-accent-text` is byte-identical app-wide, including theme.css's pinned fallback `#fa8737`. The guard's
  direction changes to "every inline accent tint used in CSS is in the scored set", which still fails if a CSS tint
  is added without being scored. A scored strength with no CSS user is allowed only if it is named as a retained
  historical strength, which 0.22 is. That makes the scored set a superset: more conservative, never looser
  (consistent with C3). DESIGN.md lines 937 and 1553 are updated to say 0.22 is retained historically and no longer
  painted by the bottom nav.

**D11. Phone "refreshed" line (owner answer `wire-after-1576`; placement revised after skeptic r3 #4).** On the phone
shell's authenticated dashboard view, a mono caption line is the first child of `.panel-list`, directly above the D3
chip row, in normal flow. This matches the board, which shows the line under the title block and above the chips.
The 56px phone command bar (`--app-command-bar-height`, read through `--app-top-chrome-height`) is not changed. The
text is exactly what the desktop meta row's refresh fact reads ("refreshed 9h ago" / "last run failed 9h ago" / "not
refreshed yet"; nothing for `unknown`), including the desktop's failed-run danger dot. The text and dot come from one
helper extracted from `DashboardMetaFacts.tsx` and used by both surfaces. The source is `useDashboardMeta` with the
same inputs `DashboardMetaRow` uses (no second hook or formatter). The line is not mounted on the public
shared-dashboard route. It exposes `<time dateTime>` and a full-date `title`. It sits 12px from the edge like the
other `.panel-list` children.

## Risks / Trade-offs

- [HEL-1578 merges first and moves routes] → chips use `/dashboards/:id`; Phase B merges origin/main before nav work.
- [HEL-1572 density changes spacing tokens] → D1 rules are stack-scoped and use tokens, so density can override.
- [e2e specs select `.mobile-panel-stack__item` / measure stack geometry] → keep class names; run the full e2e suite.
- [HEL-1578 also edits `PanelList.tsx`] → expect a small import-level conflict; resolve by merging origin/main.
- [Saved zoom ignored on phones may surprise] → it was unreachable there; saved value preserved for desktop.

## Planner Notes

- Self-approved: D1–D7 (local, reversible; listed in the PR under "UI decisions taken overnight (reversible)").
- The opaque active pill (D10) is the owner's answer `opaque-pill-text-ring`, not a self-approved fallback.
- Escalated and answered by the owner (chat, recorded 2026-10-15T17:06Z): Q1 `assistant-to-header`, Q2
  `wire-after-1576`. Phase B (D8-D11) self-approves the remaining local, reversible calls: the `UserMenu` trigger
  variant, the Data sub-row, and the CSS-only expansion.
- Existing `dashboard-chrome-zoom-widget` text says `position: absolute` while the CSS is `fixed`; pre-existing drift,
  not changed here beyond the phone scenario.
