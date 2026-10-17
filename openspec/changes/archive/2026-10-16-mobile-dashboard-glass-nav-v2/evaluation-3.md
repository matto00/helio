## Evaluation Report — Cycle 3 (evaluation-3.md)

Head reviewed: `55ff0e85de639c6c905b4729698cf6e6d91c0c29`. Diff base resolved live with `resolve-review-base.sh`:
`d777803c1` (origin/main, HEL-1578). Scope: Phase B (tasks 3.0–3.6), the origin/main merge, and a Phase A
regression check on the merged head.

### Phase 1: Spec Review — FAIL

Issues:
1. **Spec divergence: the phone refreshed line ships in sans, and the spec, ticket, design and desktop all say mono.**
   `frontend/src/app/dashboardMeta/DashboardMetaRow.css:162-168` (`.dashboard-refresh-line`) sets
   `font-family: var(--font-sans)`, with the comment "Sans (HANDOFF: no mono)". That comment is wrong:
   - Ticket: 'a mono "refreshed 9h ago" line'.
   - Spec delta `specs/mobile-dashboard-meta-line/spec.md`: "SHALL show a **mono caption line**".
   - design.md D11: "a mono caption line".
   - HANDOFF.md line 28: "A slim mono meta row (panel count · refreshed · source)". Line 26 says the owner prefers
     monospace. Nothing in HANDOFF says "no mono" (only the serif title is rejected).
   - The desktop meta row this line has to match (HEL-1576) renders the same fact in mono:
     `DashboardMetaRow.css:4-9` `.dashboard-meta-row__left { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--app-text-muted) }`.
   - DESIGN.md:382 [binding]: "Mono is for metadata (counts, timestamps, sources, keyboard hints)". DESIGN.md:1073
     describes the desktop meta row as `--font-mono`, `--text-xs`, muted.
   Rendered on the running app at 375, 320 and 768: computed `font-family` is `"Schibsted Grotesk", …`
   (screenshot `dash-375-default.png`, ref below). No pin or e2e checks the font, so nothing caught this.
   The DESIGN.md §12 "Refreshed line" bullet the executor added does not mention the face either.
   Everything else on the line matches D11. It is the first child of `.panel-list`, 12px from the edge and above the
   chip row; it uses the shared `refreshFactOf`/`RefreshFact` helper and gives the same text as desktop (RTL-proven);
   it exposes `<time dateTime>` with a full-date title; it is absent for unknown; the command bar stays 56px.

All other Phase 1 items PASS:
- AC1 (markdown text <= 28px at 375): measured 27/27px on the merged head, both themes.
- AC2 (chips one-tap, active chip in view on load): PASS (e2e plus a live check: `activeChipInRow: true`).
- AC3: 5 tabs, the active label is visible, Connectors is reachable via Data's sub-row, Usage via Me (owner, e2e).
  Floors re-measured independently (see Phase 3).
- AC4: nothing floats over panels except the nav; the zoom widget is absent at 320/375/768; last card to nav top is
  19.6px at 375.
- Owner rulings honoured: `assistant-to-header` (no Assistant tab; header "Open assistant" is one tap; the e2e
  free/beta paths pass), `opaque-pill-text-ring` (opaque `--app-surface-strong` and inset 1px `--app-text`, glass
  capsule unchanged), `keep-022-superset` (0.22 retained), `wire-after-1576` (shared helper).
- Merge (3.0): chips navigate to `/dashboards/<id>` (`DashboardChipRow.tsx:111`). The chip row and refreshed line
  mount only inside `PanelList` (dashboard view); on `/home`, chip rows = 0. HEL-1575's `PanelGridSkeleton
  dashboardId={selectedDashboardId}` is untouched. Merge conflicts were limited to the recounted pins.
- CONSTRAINTS C1–C3 (C4 retired): C1 measurements are on port 7015 after `fonts.ready`. C2 caps: my gate and e2e runs
  used 2 workers under `nice -n 19`. C3: pins are recounted (147->148 by `find`) or replaced with stronger ones, never
  loosened (see item 4 in Phase 2). No rendered Concertino file is in the diff.

### Phase 2: Code Review — PASS (no blocking findings; suggestions below)

Gates, fresh runs in `WORKTREE_PATH` at 55ff0e85d:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm --prefix frontend run typecheck`: exit 0
- `npm test` (`HELIO_JEST_MAX_WORKERS=2`): exit 0. Root 61 suites / 524 tests; frontend 693 suites / 8823 tests, all
  pass.
- `npm --prefix frontend run build`: exit 0
- No `backend/**` changes, so no sbt run.

Judged items:
- **Accent-text guard rewrite (item 4): genuinely not loosened, red by mutation.**
  - The old guard asserted `parsed == ACCENT_TEXT_INLINE_TINT_STRENGTHS` over two hand-picked files.
  - The new one scans every stylesheet under `frontend/src` (wider, and the regex now also accepts whitespace and
    decimal variants). It asserts both directions:
    - every painted tint is scored;
    - a scored, unpainted tint is allowed only if it is named in `RETAINED_UNPAINTED_INLINE_TINTS` (0.22).
  - The contrast scan's input is painted ∪ retained, parsed from source.
  - I mutated a throwaway detached worktree (since removed); every mutation went red:
    - add a 31% tint to `AddSourceModal.css`: 2 failed (unscored tint, and 4.36 < 4.5);
    - change AddSourceModal 20% to 18%: 3 failed;
    - empty the retained list: 1 failed;
    - clean: 9/9 pass.
  - `ACCENT_TEXT_INLINE_TINT_STRENGTHS` is still `[0.22, 0.2]`, and the theme.css diff is comment-only.
    `--app-accent-text: #fa8737` is intact at theme.css:527, so it is byte-identical.
  - `inlineTintStrengths.length` changed from `toHaveLength(2)` to `>= 2`. That is a sanity bound adjusted for the
    wider scan; the exact-set assertions moved to the two new tests.
- **Shared helpers (item 5):**
  - `isDestinationActive` is extended with `activePrefixes` and a `menu` kind, with no parallel registry.
  - `phoneNavTabs` derives from `homeAlias`/`navEntry(pickerId)`, and the rail's destinations carry no
    `activePrefixes` (unit-pinned).
  - `UserMenu` is reused through `tabTrigger` with `placement="nav"`. The Me menu is portalled, `aria-current="true"`
    is used (never `"page"`), and Escape closes it and returns focus to Me (verified live).
  - Two minor near-duplicates are listed as suggestions below.
- **hel1572 probe change (item 6): legitimate, not a loosening.** The probe now measures the union of visible text
  nodes, skipping text under an `opacity: 0` ancestor. It still flags any visible clipped text. I tested it live on
  `/settings` at 375:
  - the old probe flags 4 tabs (the collapsed, invisible labels: a false positive);
  - the new probe flags 0;
  - with a style mutation making the collapsed labels visible (`opacity: 1`), the new probe flags
    "Dashboards" and "Pipelines" (red).
  The spec's own "clipping sweep is failable" mutation test still passes.
- Type safety: `navDestinations.ts` `const route = destination as NavDestination;` is a cast after a non-narrowing
  `"kind" in` check. It is harmless here but a suggestion below.
- Tests are meaningful:
  - BottomNav: 11 RTL tests and 30 CSS pins, covering geometry, fill/ring, motion gating under both selectors, and
    the 44px floor declared once.
  - navDestinations: the activePrefixes truth table, including `/connectorsx` = false.
  - `DashboardRefreshLine`: ran/failed/never/unknown/no-selection, desktop parity, and absence on the public route.
  - e2e: the ring mutation goes to 1.04 (red) and the unbounded lozenge goes red at 320 (evidence files present).

### Phase 3: UI Review — PASS (except the Phase 1 font divergence, which is visible here)

Servers: `start-servers.sh` READY on 7015/9922, and `assert-phase.sh servers` PASS.

- **Contrast (C1, item 2), measured independently** with my own capture script and analyser (not the executor's
  spec), from rendered pixels:
  - Coverage: 320 (Dashboards and Pipelines active), 375 and 768; both themes; backdrops
    default/white/black/accent/6px checker.
  - Method: the ring is the worst column across 35–65% of the pill's straight top and bottom segments, against
    capsule material 4px outside. The label and glyphs use max ink against the box corners.
  - Minimums across all 40 rows:
    - **ring 3.43:1** (dark theme over white, bottom segment; top 3.96)
    - **label 12.77:1**
    - **active glyph 6.39:1**
    - **inactive glyph 3.43:1** (dark over white)
  - Light-theme worst: ring 4.86 and glyph 4.86/4.91 over black.
  - This reproduces the executor's table exactly. Every floor holds, but dark-over-white has only 0.43 of margin
    (already flagged to the owner).
- **320 truncation (item 3):**
  - Dashboards active: label scroll/client 72/54, so it really truncates ("Dashb…" visible in
    `dash-320-dark.png`).
  - Pipelines active: 55/54.
  - Both themes: every tab is >= 44x54, no overlaps, every tab is inside the capsule's content box, and the
    lozenge stays inside its own tab.
- **e2e re-run** (DEV_PORT=7015, 2 workers, nice 19, outputDir in SCRATCH): hel1583-glass-nav, hel1583-mobile-dashboard,
  hel1583-home-375, hel1572-appearance-preferences, hel1574-shell-rail, hel813-mobile-touch-target-floor and
  hel1023-breakpoint-layout-derivation: **124/124 passed**, and teardown deleted all 124 throwaway users.
  - I did not re-run the full suite. The executor's full run at the code-final head (41caa4ceb; later commits
    only touch tasks.md) had 2 failures. Both sit in specs I re-ran green here, and 55ff0e85d changes no code.
- **Phase A on the merged head (item 7):**
  - 375 light and dark: markdown text 27/27px from the edges, cards 12px, gap 10px.
  - The stack renders at 768. There is no zoom widget at 320/375/768.
  - The chips have the active one filled and in view.
  - Last card bottom 712.4 vs nav top 732.
- **Entry points:**
  - Home -> Data tab -> `/sources`, then the Connectors pill -> `/connectors`. Data is the one current tab
    (`aria-current="page"`), and the sub-row pill shows `aria-current="page"`.
  - Me opens Settings / Getting started / Sign out (non-owner).
  - On `/home`, Home is the only current tab and there is no chip row.
  - The phone header has no avatar.
- **Console:** no errors or warnings on a dashboard load. Earlier in the session the browser logged four 502s on
  `GET /api/pipelines/<id>/run-events` (SSE). They were not reproducible on a fresh load and came from the
  pre-existing `pipelineRunFanout`/`usePipelineRunEvents`, not from this diff. Recorded, not attributed.
- **Breakpoints:** 320/375/768 render without breakage (screenshots below). Above 768 is unchanged (rail), per the
  unit tests.

Evidence (persisted, durable):
- `/home/matt/Development/helio/.concertino/runs/HEL-1583/evidence/.concertino/scratch/HEL-1583/eval3/contrast-eval3.json` (all 40 rows + minimums)
- `…/eval3/contrast/nav-375-dark-Dashboards-white.png`, `…/nav-320-dark-Dashboards-white.png`, `…/nav-768-dark-Dashboards-white.png`, `…/nav-320-light-Pipelines-black.png`
- `…/eval3/dash-375-default.png` (dark, sans refreshed line), `…/dash-375-light-bottom.png`, `…/dash-768-light.png`, `…/dash-320-dark.png`, `…/connectors-375-light.png`

### Overall: FAIL

### Change Requests
1. `frontend/src/app/dashboardMeta/DashboardMetaRow.css:162-168`: change `.dashboard-refresh-line` to
   `font-family: var(--font-mono)`, matching `.dashboard-meta-row__left` (lines 4-9) and spec/D11/ticket/HANDOFF:28.
   Fix the comment ("Sans (HANDOFF: no mono)" is factually wrong).
   - Add a CSS pin, for example in `DashboardRefreshLine.test.tsx` or a new `DashboardMetaRow.css.test.ts`, asserting
     `--font-mono` on `.dashboard-refresh-line`. It must go red if it reverts to `--font-sans`.
   - Add a font-family assertion to the refreshed-line e2e (`e2e/hel1583-glass-nav.spec.ts` ~line 657) that compares
     against the computed `--font-mono` family.
   - Update DESIGN.md §12 "Refreshed line" to say it is a mono caption, like the desktop meta row.
   - Re-capture the refreshed-line screenshot.
   - Note: under the user's opt-in Mono type style `--font-sans` already resolves to mono. Under the default
     "Sans + mono" style this line must be mono like the desktop meta fact.

### Non-blocking Suggestions
- `frontend/src/shared/chrome/navDestinations.ts`, `connectorsPath`/`settingsPath`: the `?? ""` fallback is a silent
  failure. An empty prefix would make the Data/Me tab current on every route. The unit truth table does catch this
  today, but throwing (like `navEntry`) is clearer.
- `frontend/src/shared/chrome/DataSectionTabs.tsx:20` re-implements the prefix match inline
  (`pathname === link.to || pathname.startsWith(...)`). Export and reuse the same `underPrefix` logic that
  `isDestinationActive` uses.
- `navDestinations.ts`, `isDestinationActive`: replace `destination as NavDestination` with a type guard
  (`function isMenuTab(d): d is MenuNavTab`) so the narrowing is checked.
- `DataSectionTabs` styling lives in `features/dashboards/ui/DashboardChipRow.css` and is imported from
  `shared/chrome`. That works, but a shared pill stylesheet would make the ownership clearer.
- The dark-over-white margins (ring 3.43, inactive glyph 3.43) are thin. Consider a follow-up if the capsule tint
  ever changes.
- Housekeeping: the Playwright MCP session wrote `.playwright-mcp/` snapshot/console files under the main checkout
  root (`/home/matt/Development/helio/.playwright-mcp/`). These are from this evaluator's browser session; they are
  not in the worktree and not tracked.

### Critical Path (final cycle, CYCLE 3 = EXECUTION_CYCLES 3)
- One issue blocks PASS: the refreshed line's typeface (CR1). It is a one-declaration CSS fix plus a pin. Everything
  else checks out on independent re-measurement: tab set, expanding pill, contrast floors, 320 truncation, accent
  guard, merge, Phase A gutters and chips, and 124/124 affected e2e.
- Recommendation for the human: either authorize one small fix-forward commit for CR1 (mono, with pin, e2e
  assertion and DESIGN.md line) and a targeted re-check of `DashboardRefreshLine` and the refreshed-line e2e, or
  explicitly accept sans as a deviation from the spec delta/D11. In that case the spec delta and D11 must be edited
  to say sans, because shipping code that contradicts its own SHALL is not acceptable as-is.

Cleanup: my one throwaway user (`hel1583eval3-1792203439987@example.com`) was deleted through the e2e harness's
`buildUserDeleteSql`; 0 rows remain. The e2e runs deleted their 124 users. No leftovers. The throwaway mutation
worktree was removed (`git worktree list` shows none). Servers on 7015/9922 were left running for the next gate.
