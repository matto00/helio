## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `60086f02bb5b1ee48f2246bc09e3e66349199585`. The planning artifacts are untracked files in the change
dir. I read ticket.md, proposal.md, design.md, tasks.md, all six spec deltas, the round-1 report, DESIGN.md §10, the
HEL-1570 board (Appearance.png, README.md, HANDOFF.md), and the live files cited below.

### Round-1 change requests: each one checked against the tree

1. **CR1 (Comfortable baseline): fixed.** D4 now sets Comfortable to today's values: an 18px gutter, rowHeight 52 and
   `--space-2` row padding. C5 pins this. I re-checked the live values:
   - `panelGridConfig.ts:33-35`: `rowHeight: 52`, `margin: [18, 18]`, `containerPadding: [0, 0]`
   - `PipelinesPage.css:30` and `SourceListTable.css:29`: `padding: var(--space-2)`
   - `AuditEventTable.css:28`, `ConnectorsPage.css:104`, `ContextList.css:131` and `ApiTokensSection.css:133/143`:
     `var(--space-2) var(--space-3)`

   Compact is now tighter than today: 12px (`--space-3`) and `--space-1`. The 18px gutter is off-scale, and D4
   discloses that.
2. **CR2 (pad-x contradiction): fixed.** `--density-row-pad-x` is gone. D4 now says horizontal padding is not a density
   token. Both remaining tokens are strictly tighter in Compact, so the spec sentence holds.
3. **CR3 (reduced-motion enumeration): fixed.** I re-ran
   `grep -rn "prefers-reduced-motion\|prefersReducedMotion" frontend/src` with `landing/` excluded:
   - The CSS media blocks are exactly `theme.css:481`, `Skeleton.css:57`, `toast.css:65`,
     `RefinementChatDrawer.css:67`, `StreamingText.css:29`, `MobileNavSheet.css:95` and `BottomNav.css:146`. D5 and
     task 3.7 name every one.
   - The JS consumers (`Toast.tsx:39`, `buildChartOption.ts:310`, `referenceMarksOption.ts:91`,
     `chartAppearance.ts:292`) all go through `utils/prefersReducedMotion.ts`, which D5 changes.
   - `landing/` is excluded explicitly, with a reason, both from the change and from the guard.

   Every component rule uses `animation: none` / `transition: none`, with no literal durations. That means a
   `:root[data-motion="off"]` twin outside the media block will not trip `motionTokenGuard.css.test.ts`, whose
   exception (a) covers only media blocks. The scoped selectors also raise specificity from 0,1,0 to 0,3,0, which only
   strengthens these overrides.
4. **CR4 (spec deltas): fixed.** There are now MODIFIED deltas for `shared-skeleton`, `mobile-dashboard-sheet`,
   `mobile-bottom-nav` and `echarts-chart-panel`. Each one defines "reduced motion in effect" with the right
   precedence and adds a saved-Full counter-scenario where it applies. The light/dark toggle is now "Mode", second in
   the Appearance order. That satisfies `frontend-theme-system/spec.md:5,23-25` ("in the Appearance section, alongside
   the accent color picker") without a delta.
5. **CR5 (Off values): fixed.** D5 lists exact values:
   - the four `--motion-duration-*` tokens at `0.01ms`
   - `--motion-stagger` at `0ms`
   - `--app-transition` at `0.01ms ease`
   - `--transition-slow` at `0.01ms` plus today's curve. I checked the curve against `theme.css:70`:
     `cubic-bezier(0.3, 0.9, 0.4, 1)`.

   The loop tokens are explicitly left to the blanket rule. C4 pins the near-zero, end-event-firing contract for
   HEL-1573. Every token name exists in `theme.css:69-91`.
6. **CR6 (Open Question 1 framing): fixed.** The question now gives the panel-height consequence, the per-viewer
   divergence, a with/without-compensation choice, on-scale values, and the Subtle-is-interim context.

### New material in the revision

- **Row-height compensation arithmetic is correct.** RGL height is `h*rowHeight + (h-1)*marginY`:
  - Comfortable, h=5: 5·52 + 4·18 = 332.
  - Compact without compensation: 5·52 + 4·12 = 308. design.md says 302, but that figure only holds at a 10px gap.
    It is a stale number with no effect on the decision.
  - Compact with compensation, h=5: 5·58 + 4·12 = 338. In general the difference is h·6 − (h−1)·6 = +6px for every h.
  - The row pitch (rowHeight + margin) is 70 in both sets and `containerPadding` is `[0,0]`, so panel tops are
    identical. Only horizontal positions move: left edges by up to x·6/12 ≤ 5.5px, and widths by up to 6px. D4's
    "top moves by at most a few px" is accurate (vertically it is 0).
- **No hidden rowHeight consumers.** `grep -rn rowHeight frontend/src` finds the RGL props only in
  `DesktopPanelGrid.tsx:142` and `DesktopPanelGridSkeleton.tsx:52`. `MobilePanelStack` explicitly does not use the
  `h × rowHeight` formula. `DataGrid`/`useVirtualRows` have their own unrelated rowHeight.
- **A density switch cannot cause a layout write.** `useGridLayoutInteraction.ts:95-120` compares RGL's echoed layout
  with `areDashboardLayoutsEqual`, and the grid units do not change. So a viewer toggling density cannot arm a layout
  PATCH on a shared dashboard.
- **The no-flash wiring is plausible.** `main.tsx:33-58` feeds ThemeProvider from the same Redux store that
  ProtectedRoute reads. ThemeProvider already adjusts accent state during render (`ThemeProvider.tsx:66-72`). A
  `useLayoutEffect` in that same commit lands before paint.
- **Every Comfortable value equals today's:** 18px gutter, rowHeight 52, `--space-2` row padding (cited above).
- **The board matches D7**: rows, subtitle, Theme "Stone (default)…" placeholder and "LATER" chip. The only departure
  is the added Mode row, which a binding spec requires.

### Owner escalation framing

- Q1, Q2 and Q3 are sound and their recommendations are well grounded. Q2 is backed by the board's cards. Q3 is
  backed by DESIGN.md §10 fixing `data-motion` and by HEL-1574's flat keys.
- Add to the escalation context (not as a question): the Mode row is an addition the board does not show, placed
  second. It is reversible, but the owner approved that board.

### Verdict: CONFIRM

### Non-blocking notes

- In design.md D4 and Open Question 1, correct "302px" to **308px**: an uncompensated 12px gap gives
  5·52 + 4·12 = 308. Do this before the escalation goes out, so the owner sees the right number.
- **Phone stack scope is unstated.** Below 768px, `MobilePanelStack` replaces RGL. Its gap is `var(--space-3)`
  (`MobilePanelStack.css:11`) and is not a density token. State explicitly whether Compact touches the phone stack.
  Recommendation: it does not, and the spec should say "desktop panel grid".
- **The no-flash probe needs a sharper method.** D6's probe ("first-paint probe of the page title's computed
  `font-family`, `document.fonts.ready` awaited") is evidence-shaped. Computed `font-family` is the declared stack
  whether or not fonts have loaded. A probe taken after load cannot see a flash. Record the heading's computed
  `--font-heading`/`font-family` at the moment the heading is inserted, using a `MutationObserver` from
  `addInitScript`. Do this for both paths: reload with a cache, and a cold context with no cache. Then show it red by
  disabling the pre-paint script or the layout effect.
- Fonts load non-blocking with `display=swap` (`app.html`). Serif users briefly see the Georgia fallback before
  Fraunces arrives. That is the serif style, not the default style, so the AC holds. Mention it in the PR so nobody
  reads it as a flash.
- **Sign-out should reset the attributes too.** D6 clears the cache on sign-out. It should also reset the root
  attributes to defaults, so the login page after a sign-out does not keep the previous user's style.
- `motion` must be nullable only in `update-user-preferences-request.schema.json`. In `user-preferences.schema.json`
  it must stay non-null, because absent means unset.
- The density spec has no requirement for the `rowHeight` compensation. Once the owner answers Q1, add a scenario that
  pins the chosen rowHeight per density, so the TS table cannot drift.
- `--toast-exit-duration` is not in D5's explicit list. `toast.css`'s scoped component rule and `Toast.tsx`'s util
  check cover it. Name it alongside the loop tokens so HEL-1573 does not have to infer it.
