## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Scope: Phase B (design.md D8–D11), tasks.md §3, specs/mobile-bottom-nav/spec.md, specs/mobile-dashboard-meta-line/spec.md.
Reviewed worktree HEAD d9ab82edd696f9c171632c477cc7d236ef42d91b. The Phase B artifacts are uncommitted edits in the working tree.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/mobile-dashboard-glass-nav/HEL-1583`.
- **Owner answers are recorded.** `events.jsonl` line 39 is `escalation.answered`, with `sub_answers ["assistant-to-header","wire-after-1576"]` and `answer_source human`.
- **Merge state.** After `git fetch`, origin/main is 19 commits ahead. HEL-1576, 1572 and 1575 are merged. HEL-1578 and HEL-1573 are **not** merged. The D8 precondition ("stop and report if 1578 has not merged") still covers this.
- **r3 CR1 (breakpoint wording): resolved.** The MODIFIED block now says "in the phone layout" and "above the phone layout". This matches HEL-1578's canonical `openspec/specs/mobile-bottom-nav/spec.md` (worktree at 0638caea1) and `BottomNav.css`'s `@media (max-width: 768px)`. The MODIFIED and REMOVED headers match HEL-1578's canonical headers exactly.
- **r3 CR5 (free tier): resolved, checked against code.**
  - origin/main `QuickLauncherOverlay.tsx` l.90 renders "Browse all conversations" only when `!isFreeTier`.
  - `ActiveConversationPanel.tsx` l.102 renders `TierRequestAccessCopy` for free tier, and `ChatPage.tsx` renders that same panel. So the overlay does show what `/chat` shows.
  - `CommandBar.tsx` l.235 renders "Open assistant" on every route except `/chat*`.
  - The scoped claim is true, and task 3.5 tests both the free and the beta path.
- **r3 CR4 (refresh-line placement): resolved.**
  - D11 places the line in `.panel-list` flow, and the command bar seam is unchanged.
  - The spec pins it: "command bar keeps its existing height", "sits above the chips, 12px from the edge".
  - `useDashboardMeta(dashboardId, panels)` and the inline refresh text and dot in `DashboardMetaFacts.tsx` (l.40–70) exist on origin/main, so the helper extraction is real.
  - `PanelList` mounts only on authenticated routes (`AppRoutes.tsx`), so the public route never gets the line.
- **r3 CR2 (label colour): the colour half is resolved; the lozenge-edge half is NOT.** See CR1 below.
- **r3 CR3 (sizing): partially resolved.** The even rhythm and content-sized pill are specified. The 320px case is now infeasible, and the "never switches flex-basis" claim is false. See CR2 below.
- **D8 premises.**
  - HEL-1578's `NavDestination` and `isDestinationActive` (`navDestinations.ts`) can take an optional `activePrefixes`.
  - `UserMenu` (origin/main) has Settings, an owner-only Usage item, Getting started, Sign out, `aria-haspopup="menu"`, and a `placement` prop that a tab variant can extend.
  - The phone avatar is at `CommandBar.tsx` l.259.
- **Contrast arithmetic** (token-composited model; uniform backdrops, so blur is the identity). I composited `--app-surface` at 55% over each backdrop to get the capsule, then computed WCAG ratios from theme.css values (dark `--app-surface #1a1816`, `--app-surface-strong #262320`, `--app-text #f2efe9`, `--app-border-strong rgba(242,239,233,.18)`, accent `#f97316`; light `#fdfcfa`/`#ffffff`/`#211d19`/`rgba(33,29,25,.2)`/`#ea580c`). The script is in session scratch; the numbers are below so anyone can re-derive them.

  | case | label on today's 22% accent wash | wash edge vs capsule | border-strong ring vs capsule (on opaque fill / on capsule) | `--app-text` ring vs capsule |
  |---|---|---|---|---|
  | dark, theme-matched | 11.51 | 1.40 | 2.02 / 1.65 | 16.09 |
  | dark over white | **3.30** | 1.04 | 2.31 / 1.30 | 3.44 |
  | dark over black | 12.32 | 1.37 | 2.12 / 1.60 | 16.89 |
  | dark over accent | 5.37 | 1.28 | 1.16 / 1.50 | 6.88 |
  | light, theme-matched | 12.07 | 1.30 | 1.42 / 1.51 | 15.70 |
  | light over white | 12.59 | 1.31 | 1.49 / 1.51 | 16.51 |
  | light over black | 4.61 | 1.06 | 2.26 / 1.35 | 4.89 |
  | light over accent | 7.92 | 1.17 | 1.19 / 1.45 | 9.28 |

- **Flex geometry at 320px** (theme.css: `--bottom-nav-inset` 12px, capsule border 1px, `.bottom-nav` padding `--space-2`, tab padding `0 2px`, `--space-1/3/6` = 4/12/24px, icon 22px). The capsule content box is 320 − 24 − 2 − 16 = 278px. Four inactive tabs at the 44px floor take 176px, which leaves 102px for the active tab. The active tab is 2 + 12 + 22 + 4 + label + 12 + 2 = 54px plus the label, so the label gets 48px. The label cap is `calc(var(--space-6) * 4)` = 96px.

### Verdict: REFUTE

Two defects remain, and each would leave the implementer unable to satisfy a scenario this delta itself asserts. C3 forbids loosening, so the implementer would have no legal way out.

### Change Requests

1. **D10's opaque-lozenge fallback cannot pass its own 3:1 edge scenario, and the decision tree has no branch for the edge failing.**
   - **The fallback ring fails.** D10's ring is 1px `--app-border-strong`. By the token arithmetic above, that ring measures 1.16–2.31:1 against the capsule in every case. Over the theme-matched backdrop it is 1.42–2.02:1. The new scenario "An opaque fallback lozenge keeps a visible edge (≥3:1)" is therefore unmeetable.
   - **The fallback contradicts the binding standard.** DESIGN.md §3 (l.218–228, binding) says the lozenge hairline must be full-strength `var(--app-text)`, because "a color-mix-weakened border falls below the floor and any fill drawn from the neutral surface ramp converges". `--app-border-strong` is exactly such a weakened border. The opaque `--app-surface-strong` fill is 1.01–1.07:1 against the capsule in light theme, so it is exactly such a fill.
   - **The fallback is not conditional.** The label on today's 22% accent wash computes to 3.30:1 in dark theme over white (and 4.61 light-over-black, with no margin). The label's 4.5:1 floor fails there, so the fallback will be taken.
   - **Today's active lozenge already fails the edge floor.** The current 22% accent wash with no border (the code since #460, which replaced HEL-774's `--app-text` hairline; the CSS test pins "tinted highlight fill with no border") computes to 1.04–1.40:1 edge against the capsule. D10 promises only to "re-measure" that edge and says nothing about the outcome when it fails. Nothing in e2e/ measures it today (`grep -ri lozenge e2e` returns no hits).
   - **Required:**
     - Decide the active lozenge up front, not conditionally, with a treatment whose arithmetic clears both floors in every listed case. For example, an opaque `--app-surface-strong` fill plus a 1px `var(--app-text)` ring, per DESIGN.md §3. That ring computes to 3.44–16.89:1 edge, and the label on the opaque fill to 13.6/16.7:1.
     - State the expected numbers in design.md. Keep the rendered-pixel measurement as confirmation.
     - Update the `BottomNav.css.test.ts` "no border" pin and DESIGN.md §3/§12 to the chosen treatment, so the doc and the code stop disagreeing.
     - If the owner-loved "accent wash" look must survive, say how, for example a wash composited over the opaque base and inside the `--app-text` ring. Do not leave it as an unmeasured carry-over.

2. **D9 sizing overflows the capsule at 320px, and its no-flex-basis-switch claim is false.**
   - **Overflow at 320px.** The active tab is `flex: 0 0 auto`, which means `flex-shrink: 0`. Its label's `max-width` cap (96px) is wider than the room available at 320px (48px, derived above). "Dashboards" (about 65px at 12px sans) and "Pipelines" (about 52px) are both under the cap, so `text-overflow: ellipsis` never engages: the label box is its natural width. Nothing can shrink, because the inactive tabs are already at their 44px floor and the active tab has shrink 0. The row therefore overflows the capsule by roughly 4–18px. This breaks the ADDED scenario "Five tabs with the expanded label fit at the narrowest supported width … never … overflowing the capsule".
     - **Required:** make the active tab shrinkable with its own floor (for example `flex: 0 1 auto; min-width: 44px`), and give the lozenge and label `min-width: 0; overflow: hidden; white-space: nowrap`, so the ellipsis actually triggers.
     - **Required:** add to task 3.5 an e2e at 320px, with Dashboards and then Pipelines active, asserting the label's right edge is ≤ the capsule's content right edge and `scrollWidth > clientWidth` on the truncated label.
   - **The flex-basis claim is false.** "`flex-basis` never switches between a length and `auto`" is not true: activation moves a tab from `flex: 1 1 0` to `flex: 0 0 auto`, a 0 ↔ auto basis switch and a 1 ↔ 0 grow switch, neither of which is in the transition list.
     - At 375px, the newly active tab snaps from its share (about 66px) to 54px before its label grows.
     - The outgoing tab snaps to a share narrower than its still-expanded label for the 280ms collapse (its 44px `min-width` replaces the auto minimum), so its lozenge spills out of its tab mid-transition.
     - **Required:** state the actual per-frame behaviour and accept it explicitly. Or pick a scheme where every tab's width is purely content-driven (for example all tabs `flex: 0 1 auto` with a 44px `min-width` and the container's `justify-content` distributing the space), so only `max-width` and `opacity` change on activation.
   - **The geometry pin is silently loosened.** Changing inactive lozenge padding to `--space-2` while the active one keeps `--space-3` removes the HEL-774 pin "every tab's lozenge carries identical geometry, so the icon never shifts" (`BottomNav.css.test.ts` l.149). Under C3 that pin cannot quietly disappear. Name its replacement invariant: for example, the icon box stays 22×22 in every state, and the padding change is either inside the transition list or accepted as instant.
   - **Label size and weight are unspecified.** The 320px fit and the 4.5:1 normal-text floor both depend on the label's type token and weight. Name them (for example `--text-xs`, weight N).

### Non-blocking notes

- **D3 vs D11 ordering.** D3 (Phase A) still says `DashboardChipRow` is "the first child of `.panel-list`", while D11 makes the refresh line the first child. Amend D3's sentence so the two do not disagree.
- **Me popover inside the nav.** `.bottom-nav` has `backdrop-filter` (a containing block for `position: fixed` descendants) and `z-index: 5` (a stacking context). A `UserMenu` popover rendered inside it is capped at z 5 relative to the page and positioned relative to the nav. D8 says the popover "sits above it in z-order", so state whether it is portalled and which `--z-popover` it uses.
- **`NavDestination.to` is required today.** "optional `kind: "menu"` (no `to` is used)" still forces a `to` value. Say whether Me gets a dummy `to` or the type becomes a discriminated union.
- **Phone short labels.** The phone labels "Data" and "Pipelines" differ from the registry labels "Data Sources" and "Data Pipelines". Say that the overrides live in `phoneNavTabs` only, and that the rail's accessible names are unchanged.
- **Stale Purpose line.** The canonical spec's Purpose line still says "(<768px)". Deltas do not touch it, but the at-768 bar contradicts it, so consider fixing it at archive time.
- **Reduced-motion coverage.** The new label `max-width`/`opacity` transition falls under the existing "Added bottom-nav motion respects reduced-motion preference" requirement, whose text covers "any motion introduced by the floating tab bar". The CSS pin should target the label rule too, not only `.bottom-nav__lozenge`.
- **The rest of D8 and D11 is sound and implementable once HEL-1578 merges.** The D8 Phase A interaction is unchanged from r3's analysis.
