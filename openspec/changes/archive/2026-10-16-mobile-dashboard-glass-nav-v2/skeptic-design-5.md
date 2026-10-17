## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Scope: Phase B (design.md D8–D11), tasks.md §3, specs/mobile-bottom-nav/spec.md, specs/mobile-dashboard-meta-line/spec.md.
Reviewed worktree HEAD d9ab82edd696f9c171632c477cc7d236ef42d91b. The Phase B artifacts are uncommitted edits in the working tree.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/mobile-dashboard-glass-nav/HEL-1583`.
- **Owner answer 2 is recorded as stated.**
  - `.concertino/runs/HEL-1583/events.jsonl` l.49 raises `HEL-1583-1792194842888-26a3dd`. It recommends `opaque-pill-text-ring`: "the active pill becomes an opaque --app-surface-strong fill with a 1px full-ink (--app-text) ring, inside the glass capsule". It lists two alternatives that waive floors.
  - l.51 is `escalation.answered`, answer `opaque-pill-text-ring`, `answer_source human`.
  - l.50 is an `answer_discarded` event 8ms after the raise. It does not affect l.51.
- **The owner's treatment is implemented faithfully.**
  - D10 keeps the capsule's `backdrop-filter`, 55% tint and `--app-border-strong` border unchanged.
  - Only `.bottom-nav__tab--active .bottom-nav__lozenge` becomes opaque `--app-surface-strong` with a 1px `--app-text` ring. Inactive lozenges get neither.
  - The spec scenario "The active pill is opaque inside a translucent capsule" pins exactly this.
  - The shortfall rule is explicit and correct: "reports it with the numbers and does not adjust the treatment silently … surfaced to the owner, never fixed in-loop" (D10, and task 3.2a "Report any shortfall with the numbers instead of adjusting").
- **The owner's floors are achievable (my own arithmetic, not r4's).**
  - Script: `.concertino/scratch/HEL-1583/skeptic5-contrast.mjs`.
  - Inputs from origin/main theme.css: dark `--app-surface #1a1816`, `--app-surface-strong #262320`, `--app-text #f2efe9`; light `#fdfcfa`/`#ffffff`/`#211d19`.
  - Capsule = 55% `--app-surface` composited over each backdrop: theme bg, white, black, all 8 `ACCENT_PRESETS`, and all 12 `DASHBOARD_APPEARANCE_PRESETS`.
  - **Ring vs capsule:** worst 3.44:1 (dark over white) and 4.89:1 (light over black).
  - **Label vs fill:** 13.62:1 (dark) and 16.74:1 (light).
  - **Active icon:** `--app-accent-text` on the opaque fill clears 4.5:1 by construction, because `--app-surface-strong` is in `deriveAccentTextColor`'s scored set (`ACCENT_TEXT_NEUTRAL_SURFACES`, appearance.ts).
  - **No owner-facing finding:** no floor is unmeetable under the owner's treatment. The 3.44 margin in dark-over-white is thin, so the C1 rendered-pixel measurement matters there.
- **r3/r4 items resolved, checked against ground truth.**
  - r3 CR1 (breakpoint wording), CR4 (refresh-line placement, `--app-command-bar-height` unchanged at theme.css l.163) and CR5 (free-tier assistant path) remain resolved. The MODIFIED/REMOVED headers match HEL-1578's canonical `openspec/specs/mobile-bottom-nav/spec.md` (l.10, l.36, l.175; worktree now at 9dd48db0f).
  - r4 CR1 (lozenge edge): resolved by the owner answer above. The stale "opaque-lozenge fallback" phrase survives only in Planner Notes (non-blocking).
  - r4 CR2:
    - Even rhythm and content sizing: specified (`flex: 0 1 auto`, `min-width: 44px`, `space-evenly`).
    - Basis/grow switch: removed. No flex property changes on activation.
    - Geometry pin: replaced with named invariants (block padding, radius, a 22px icon box with fixed vertical position, inline-only growth).
    - Label type: named (`--text-xs`, `--weight-semibold`, `--app-text`).
    - The **truncation mechanism and its assertion are only half-applied.** See CR1.
  - r4 non-blocking items:
    - D3/D11 ordering: amended in D3.
    - Me popover: portalled via `usePortalPopover`. This is real: `features/auth/ui/UserMenu.tsx` l.67 uses it, and the hook supports `bottom`-anchored, upward-opening panels.
    - `kind: "menu"`: now a discriminated union.
    - Phone label overrides: scoped to `phoneNavTabs`.
- **D8/D11 premises (origin/main):** `useDashboardMeta.ts`, `DashboardMetaFacts.tsx`, `DashboardMetaRow.tsx` and `usePortalPopover.ts` exist, and `UserMenu` has its owner-only Usage item (l.214). The HEL-1578 and HEL-1573 merge preconditions are handled by the stop-and-report rule.
- **New interaction found: the HEL-1048 accent-text derivation reads `BottomNav.css`.** See CR2.
  - `frontend/src/theme/accentTextSourceSyncGuard.css.test.ts` (origin/main, l.83–99) calls `parseFirstAccentBackgroundTint(bottomNavCss)`. That function throws when no `background: color-mix(in srgb, var(--app-accent) N%` exists in the file.
  - `appearance.ts` hard-codes that 22% in `ACCENT_TEXT_INLINE_TINT_STRENGTHS = [0.22, 0.2]`.
  - DESIGN.md l.937 and l.1553 name "`BottomNav.css`'s 22% active-tab lozenge" as part of the scored set.
  - D10 deletes that wash. The design, the tasks and the DESIGN.md update list (§3/§12 only) say nothing about any of these three sites.
  - Script: `.concertino/scratch/HEL-1583/skeptic5-accenttext.mjs`. It re-implements `deriveAccentTextColor`. Dropping 0.22 from the set changes `--app-accent-text` for 15 of 18 preset×theme combinations. Examples: dark Orange `#fa8737` → `#fa8230`, which is the pinned static fallback literal in theme.css; light Blue `#295aaa` → `#295bac`.

### Verdict: REFUTE

The owner's treatment is faithfully carried, and its floors compute as achievable. Two specification defects remain. Each would let the implementer ship something wrong, or force them into an unreviewed call.

### Change Requests

1. **D9's truncation does not work as specified, and the planned e2e would not catch it.** (r4 CR2 asked for this; it was half-applied.)
   - **The CSS as specified does not truncate.** D9 puts `min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis` on the **label only**.
     - `.bottom-nav__tab` is a column flexbox with `align-items: center` (origin/main BottomNav.css). Its child `.bottom-nav__lozenge` (inline-flex) is therefore sized fit-content: at least its min-content width.
     - That min-content is the sum of its items' min-content contributions. The label's contribution is its full nowrap text width, capped only by the 96px `max-width`. `min-width: 0` lowers the automatic minimum, not the contribution.
     - At 320px the active tab shrinks to about 102px (its 4px padding leaves 98px of content box), but the lozenge stays about 24 + 22 + 4 + ~65 ≈ 115px for "Dashboards". It spills about 8px into each neighbouring tab, and the label never shows an ellipsis.
     - D9's sentence "The active tab can shrink to its 44px floor, so at 320px a long label truncates" is therefore false as written.
   - **Required (design):** the lozenge must also be bounded by its tab, for example `.bottom-nav__lozenge { min-width: 0; max-width: 100%; }`, so the label (`flex-shrink: 1`, `min-width: 0`) actually ellipsises.
   - **Arithmetic fix:** correct the expected label room. 102 − 4 (tab padding) − 24 − 22 − 4 = 48px, not 52px; with a real 1px border instead of an inset shadow it is 46px.
   - **Required (task 3.5):** Dashboards and Pipelines are interior tabs (2 and 4), so "no tab or label box crosses the capsule's content box" passes even while the pill overlaps its neighbours. Add both of these, at 320px with Dashboards and then Pipelines active:
     - (a) the active lozenge's rendered box lies within its own tab's box;
     - (b) the truncated label has `scrollWidth > clientWidth`.

2. **D10 removes an input to the HEL-1048 accent-text contract without saying what replaces it.**
   - Deleting the 22% accent wash from `BottomNav.css` makes `accentTextSourceSyncGuard.css.test.ts` throw. It also leaves `ACCENT_TEXT_INLINE_TINT_STRENGTHS[0] = 0.22` and DESIGN.md l.937/l.1553 describing a background that no longer exists.
   - Two competent implementers would diverge:
     - **(a) Drop 0.22 from the scored set.** This shifts `--app-accent-text` app-wide in 15/18 preset×theme cases and forces a change to the pinned theme.css fallback literal (`#fa8737` → `#fa8230`). It is an app-wide colour change outside this ticket's ACs.
     - **(b) Keep 0.22 as a frozen constant and cut the guard's BottomNav parse.** That reads as loosening a drift pin, which C3 forbids.
   - **Required:** decide which one, state it in D10, and list it in tasks (3.2a or 3.3).
     - If (a), list the changed derived values in measurements and in the PR's "UI decisions taken overnight".
     - If (b), state why retiring a parse whose subject no longer exists is not a loosening, and pin the frozen constant with a comment naming HEL-1583.
     - Either way, add DESIGN.md l.937/l.1553 to the D10 doc-update list.
   - Note: the active icon stays ≥ 4.5:1 under both options, because `--app-surface-strong` is already scored. This is a scope and consistency decision, not a contrast risk.

### Non-blocking notes

- **The lozenge padding snaps on activation, contrary to D9's text.** Inactive inline padding is `--space-2` and active is `--space-3`. D9 says "the only property that changes size is the label's `max-width`", and task 3.2 says "`max-width`/`opacity` are the only transitioned properties", so the lozenge snaps 8px wider at activation.
  - Either add `padding-inline` to the transition list (and its reduced-motion gating), or say the snap is accepted.
  - Also, the existing pin "`.bottom-nav__lozenge` declares a transition on background only" (BottomNav.css.test.ts l.185) must be replaced deliberately. If the ring is an inset `box-shadow`, say whether it fades with the fill or snaps.
- **Spec wording.** "inactive tabs share the remaining width evenly" (spec scenario "The active pill is content-sized", and the requirement body) does not describe `space-evenly` with fixed 44px tabs. There the **gaps** are even and the tabs do not share width. Reword to "are evenly spaced", so a reader does not implement `flex: 1` on inactive tabs.
- **Dead gaps between tabs.** At 768px, `space-evenly` leaves roughly 70px of untappable gap between tabs, where today's `flex: 1` tabs make the whole bar tappable. The 44px floor is still met, so this is acceptable. Confirm it in the screenshots at the final gate.
- **Stale Planner Notes phrase.** Planner Notes still self-approve "the opaque-lozenge fallback". Since the owner answer, it is no longer a fallback or a self-approval. Reword it to cite `opaque-pill-text-ring`.
- **Purpose line.** The `mobile-dashboard-meta-line` delta has a `## Purpose` section. That is fine for a new capability. The canonical mobile-bottom-nav Purpose "(<768px)" staleness (r4 note) is still worth fixing at archive time.
