## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `60086f02bb5b1ee48f2246bc09e3e66349199585`. The planning artifacts are untracked files in the change
dir. I read ticket.md, proposal.md, design.md, tasks.md, both spec deltas, DESIGN.md §3 (Spacing, Typography) and §10,
the HEL-1570 board (screenshots/Appearance.png, README.md, HANDOFF.md) and Linear HEL-1573. I checked each factual
claim against the live tree.

### What I verified (with evidence)

**Claims that hold**
- `frontend/app.html` has no pre-paint script. Its only `<script>` is the `/src/main.tsx` module.
  `frontend/index.html:43` (the landing page) has one. No Content-Security-Policy anywhere in the repo blocks an inline
  script.
- Authenticated routes wait on auth. `features/auth/ui/ProtectedRoute.tsx` renders a Spinner while
  `auth.status` is `idle|loading` and renders `<Outlet/>` only once the status is `authenticated`. `App.tsx:370`
  dispatches `rehydrateAuth`. ThemeProvider (main.tsx) and ProtectedRoute read the same store, so a layout-effect
  application in the same commit is plausible. D6's "to be confirmed by the executor" is now confirmed for protected
  routes.
- There is no collision with HEL-1575. `gh pr diff 1032` adds only `dashboardTabs` (`AllowedFields` becomes
  `contextListWidth, contextListCollapsed, dashboardTabs`; `UserPreferences` goes to `jsonFormat5`). The union
  resolution in D1 is correct. Both PRs edit the same five constructor sites (`ApiRoutes.scala:891`,
  `UserPreferencesRoutes`, `UserResponseAssembler`, `AuthProtocol`, the repository), so expect a conflict.
- The backend shape matches D1. `UserPreferenceRepository.mergePrefs` is a single jsonb `||` UPDATE.
  `getPreferences` drops invalid values. `UserPreferencesRoutes` uses an `AllowedFields` whitelist. The app-role
  fixture exists (`backend/src/test/.../testsupport/TwoUserRlsApiFixture.scala`, `helio_app_test` NOBYPASSRLS).
  Neither schema has a key that collides, and both are `additionalProperties: false`, so they must be extended (task
  2.1 does this).
- The grid gutter is a JS constant: `panelGridConfig.ts:34 margin: [18, 18]`. It is consumed by
  `DesktopPanelGrid.tsx:143` and `DesktopPanelGridSkeleton.tsx:53`.
- The board confirms D3/Q2. The three type cards differ only in heading face; the label line and the "140" numeral are
  the same in each. That supports "Mono = headings only".
- `motionTokenGuard.css.test.ts` will not flag an unconditional `:root[data-motion="off"]` copy that uses
  `animation-duration`/`transition-duration` longhands. Its regex `(?<!-)\b(transition|animation)\s*:` does not match
  them.

**Claims that do not hold** (each feeds a Change Request below)
- **The reduced-motion consumer list is incomplete.** `grep -rn "prefers-reduced-motion" frontend/src` also finds
  `shared/chrome/MobileNavSheet.css:95` and `shared/chrome/BottomNav.css:146`, which design.md Context and D5 do not
  list. BottomNav's block is `transition: none`, and its comment says it depends on the global rule. It also finds
  `landing/landing.css:18,497`, `landing/build.ts:9` and `landing/reel.ts:19`, which the plan never addresses. JS
  consumers outside the util (`Toast.tsx:39`, `buildChartOption.ts:310`, `referenceMarksOption.ts:91`,
  `chartAppearance.ts:292`) all go through `utils/prefersReducedMotion.ts`, so changing the util covers them.
- **D4's Comfortable baseline is wrong.** Today every row D4 targets uses `--space-2` (8px) of vertical padding:
  - `PipelinesPage.css:30` (`padding: var(--space-2)`)
  - `SourceListTable.css:29` (same)
  - `AuditEventTable.css:28` (`var(--space-2) var(--space-3)`)
  - `ConnectorsPage.css:104` (`var(--space-2) var(--space-3)`)
  - `ContextList.css:131` (`.context-list__row`, `var(--space-2) var(--space-3)`)

  D4 sets Comfortable (the default) to `--space-3` and Compact to `--space-2`. That would make every default user's
  lists 8px taller per row, and Compact would just equal today. This changes the default without saying so.
- **D4 contradicts the spec.** D4 says "`--density-row-pad-x` unchanged-by-default". The delta's Density requirement
  says "Compact SHALL be strictly tighter than Comfortable in each token".
- **Spec deltas are missing.** Five existing capability specs state reduced-motion behaviour that this change makes
  conditional (no saved choice), or extends (saved Off):
  - `openspec/specs/shared-skeleton/spec.md:50-76` (it also names the global rule's mechanics)
  - `mobile-dashboard-sheet/spec.md:37,59-62`
  - `mobile-bottom-nav/spec.md:172-175`
  - `echarts-chart-panel/spec.md:314-316`

  None of them gets a MODIFIED delta. After this change, "explicit Full beats the OS" makes each of those scenarios
  false as written.

  Separately, `frontend-theme-system/spec.md:5,19-21` and `settings-preferences-ui/spec.md:75-90` require the
  light/dark toggle and the accent picker in Appearance. The new "Appearance settings section" requirement lists the
  section contents "in order" without the light/dark toggle. Proposal.md says the toggle stays, but no artifact says
  where.
- **Compact changes more than the gutter.** The plan does not mention this side effect. react-grid-layout sizes an item
  as `h*rowHeight + (h-1)*marginY` (`rowHeight: 52`). Dropping the margin from 18 to 10 makes every multi-row panel
  shorter as well as closer together: a default h=5 panel goes from 332px to 300px, about 10% less content height.
  Density is per user and layouts are shared, so viewers of one dashboard will see different panel heights. Also,
  neither 18 nor 10 is on the `--space-*` scale (DESIGN.md "Spacing": all gaps use a `--space-*` token).

**Owner escalation (Open Questions)**
- Q2 (Mono = headings only) is sound and backed by the board.
- Q3 (naming) is sound. `data-motion` is already fixed by DESIGN.md §10, and lowercase value tokens match the
  flat-key precedent HEL-1574 set.
- Q1 is sound in scope but must disclose the panel-height consequence and the baseline correction (CR 1, CR 5).
- Another decision HEL-1573 builds on is the exact values the Off state writes into the motion tokens (CR 4). It is an
  engineering contract, not an owner call, but it must be pinned before HEL-1573 starts.
- Worth adding to the escalation's context, not as a question: under this ticket "Subtle" only drops the overshoot.
  The existing translate animations (MobileNavSheet, RefinementChatDrawer, toast) keep sliding under Subtle until
  HEL-1573, although DESIGN.md §10 says Subtle has no translate. The owner should know Subtle ≈ Full in the interim.

### Verdict: REFUTE

### Change Requests

1. **Fix D4's baseline (design.md D4, Open Question 1, spec "Density token sets").** Comfortable must equal today's
   rendered values so default users see no change: row vertical padding `--space-2`, grid gutter 18px. Compact then
   goes tighter than today (for example `--space-1`, or a documented ≤4px optical value). If the plan really intends
   to loosen the default, say so and put it in the owner escalation. Cite the five files/lines above.
2. **Remove the `--density-row-pad-x` contradiction.** Either drop the token, make Compact tighter in it, or change the
   spec sentence to "tighter in each token that differs". Do not leave a token that is unchanged by design next to a
   "strictly tighter in each token" requirement.
3. **Complete the reduced-motion enumeration (design.md Context and D5, proposal.md Impact, tasks.md 3.7).**
   - Add `MobileNavSheet.css:95` and `BottomNav.css:146`. BottomNav's `transition: none` must also apply under
     `data-motion="off"`.
   - Decide `landing/landing.css`, `landing/build.ts` and `landing/reel.ts` explicitly. Recommended: leave them
     unscoped, because `index.html` never carries `data-motion` and signed-in users are redirected. Exclude `landing/`
     from the D5 guard with a stated reason. As written, the guard scans all of `frontend/src` CSS and would fail on
     `landing.css`, or force a pointless change there.
4. **Add MODIFIED spec deltas.** Cover `shared-skeleton`, `mobile-dashboard-sheet`, `mobile-bottom-nav` and
   `echarts-chart-panel`. Each reduced-motion requirement/scenario should read "OS reduce with no saved motion
   choice, or saved Off" and allow an explicit saved Full. Also state where the light/dark toggle sits in the new
   Appearance order, consistent with `frontend-theme-system` and `settings-preferences-ui`, or add a MODIFIED delta
   for those.
5. **Pin D5's Off token values.** Replace "instant values" with the exact list and values: `--motion-duration-*`,
   `--motion-stagger`, `--app-transition`, `--transition-slow`, and whether `--app-skeleton-shimmer`,
   `--app-spin-duration` and `--toast-exit-duration` are included. Recommended: a near-zero non-zero duration such as
   `0.01ms`, matching the global rule's precedent, rather than `0s`. A 0s transition fires no `transitionend`, and
   HEL-1573's primitives (layout slide, crossfade) may well await one. HEL-1573 consumes this contract, so it must not
   be left to the executor.
6. **Rewrite Open Question 1 so the owner sees the real trade-off.**
   - Compact's smaller gutter also shrinks each panel's pixel height (h=5: 332px → 300px).
   - Dashboards render at each viewer's own density.
   - The choice is: (a) accept shorter panels, or (b) compensate `rowHeight` so a cell keeps roughly its height.
   - Suggest on-scale values (e.g. Compact gutter `--space-2`/`--space-3`) or note why 18/10 are exempt.
   - Mention the Subtle-is-interim point above in the escalation context.

### Non-blocking notes

- D6/task 3.2 says "`clearAuth` clears the cache". `clearAuth` is a Redux reducer (`authSlice.ts:212`), so a
  localStorage side effect does not belong there. Do it in ThemeProvider when the auth status becomes
  `unauthenticated` (it can also reset the root attributes to defaults), or in the logout thunk and the 401
  interceptor path.
- Update `currentUser.preferences` optimistically on an appearance pick, the way `applyShellPreferences` does, so
  ThemeProvider's server-sourced input and the local state never disagree after a later auth response.
- Task 3.5 should name `DesktopPanelGridSkeleton.tsx:53` alongside `DesktopPanelGrid.tsx`, so the skeleton's gutter
  matches the grid's.
- The board's section subtitle ("Make Helio yours. Changes apply instantly and follow you across devices.") is not in
  D7.
- The overview tables share `shared/ui/SortableTable`. The executor may be able to apply density there once, instead
  of in each table's CSS.
- `effectiveMotion()` will be HEL-1573's "one way to read the Motion setting". Consider exposing a reactive hook too
  (attribute plus media-query change), because the Settings display needs it anyway.
