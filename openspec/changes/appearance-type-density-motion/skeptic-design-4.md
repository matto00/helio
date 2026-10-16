## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD 5862d55af36890affe651f4a02217f98a3ea85df. `git status --short` is clean, so the artifacts are committed
(round-3 note 4 is resolved).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/appearance-type-density-motion/HEL-1572`.
- **Round-3 CR1 (Sans card under Mono) is fixed.** D3 "Raw face tokens" adds `--font-face-sans|mono|serif` and
  rebinds `--font-sans/--font-mono/--font-display` to them. D7 sets each card's inline `--font-heading` to its own
  face token. Task 3.9 and the spec scenario "Preview cards show their own face" cover it. I checked this against the
  live tree:
  - `theme.css:14-26` is the only place that declares `--font-sans`, `--font-display`, `--font-heading` or `--font-mono`
    (grep over `frontend/src` css/ts/tsx, landing excluded). The extra level of `var()` does not change any computed value.
  - `themeParityGuard` only checks `--app-*` light/dark symmetry. It does not care about font tokens.
  - `tokenAuditSweep` checks `font-family:` lines in a fixed list of files. They must use
    `var(--font-sans|display|heading|mono)`. A declaration like `--font-sans: var(--font-face-sans)` does not match
    `/font-family:/`. The inline `--font-heading` override keeps the card CSS on `var(--font-heading)`, so it passes.
  - `landingFonts.css.test.ts` only checks landing.css. jsdom chart tests never load theme.css and rely on fallbacks,
    so they are unaffected.
- **Round-3 CR2 (charts on a live switch) is fixed, and the consumer list is complete.**
  - `resolveChartTheme` is called only from `useChartOption.ts:96` and `UsageChart.tsx:49`. It also appears as a
    default argument in `chartAppearance.ts:179,291`, and those are reached only through those two callers.
    `echartsCore.ts` and `theme/appearance.ts` mention it in comments only.
  - `prefersReducedMotion()` has four callers. `chartAppearance.ts:292`, `buildChartOption.ts:310` and
    `referenceMarksOption.ts:91` all run inside the two memos. `Toast.tsx:39` reads at call time, so it is live anyway.
  - D3 plus task 3.10 add `typeStyle` and effective motion to the rAF tick deps of both hooks. That is enough, because
    the memo already depends on `themeSyncTick`.
- **Round-3 CR3 (Mono checks must run under Mono) was taken up, but the check as specified is wrong.** See CR1–CR3.
- **Round-3 non-blocking notes:**
  - JetBrains Mono 700 is now task 3.11 and in D3.
  - The sync guard covering both densities is not stated explicitly (see notes).
- **What I checked against the live tree:**
  - DESIGN.md "The 44px touch floor" (lines 267-319, two items marked **[mechanical]**) says compact painted buttons
    use a `::after` expander. Their painted box stays under 44px. Verification must bisect hit extent with
    `elementFromPoint`, using an epsilon.
  - `e2e/hel813-mobile-touch-target-floor.spec.ts:60-69` asserts `box.height < 44` for expander-based controls. This
    includes the command bar's "Open assistant" button and `.user-menu__trigger` (lines 99-107).
  - `AccentPicker.css:13-14`: the swatches are 20×20 with an 8px gap and no expander.
  - `ContextList.css:31,154,163` and `App.css:171,345` (`.app-command-bar__breadcrumb-current`,
    `__mobile-title-name`) truncate with `text-overflow: ellipsis` on purpose.
  - `SortableTable.tsx:89` renders a real `<table>`/`<thead>`, and the Pipelines, Sources and Connectors overviews all
    use it.
  - `chartAppearance.ts:221,231`: axis labels already use `fontMono` under every style.

### Verdict: REFUTE

The three round-3 change requests were addressed in substance. The revision added a new defect: its Mono acceptance
check contradicts DESIGN.md's [mechanical] touch-floor rule and an existing green guard. As written, it either cannot
pass or can only pass if the executor breaks HEL-813. Two more parts of the check, and one spec scenario, cannot fail.

### Change Requests

1. **The 44px check uses the wrong measurement (design.md D3, the "These are checked by a Playwright spec…" sentence;
   task 3.8).** "At 375px every interactive element in the bottom nav, command bar and Appearance page has a bounding
   box of at least 44×44px" fails on every correctly built expander control. That includes the command bar's
   `.ui-icon-btn` buttons and `.user-menu__trigger`. HEL-813 already asserts these keep a painted box under 44
   (`hel813-mobile-touch-target-floor.spec.ts:66-69`). The only way to make this check pass is to inflate painted
   buttons, which DESIGN.md forbids and HEL-813 turns red on.
   - Restate the check by mechanism:
     - BottomNav tabs, full-width rows and inputs: box height ≥ 44.
     - Painted buttons: hit extent ≥ 44 − 0.25, by `elementFromPoint` bisection with HEL-813's `bisectHitExtent`
       helper.
   - Better still, run the existing HEL-813 surfaces with `data-type-style="mono"` set, the same way D3 already plans
     for the HEL-866 guard.
2. **The new Appearance page fails the touch floor under every style, and no task covers it (D3/D7, task 4.1).**
   - D7 keeps `AccentPicker` "unchanged": 20×20 swatches, an 8px gap, no expander. D3's check sweeps the Appearance page
     at 375, so it fails under the default style before Mono is even involved.
   - Decide this in the plan:
     - Either give the swatches a tap expander under the DESIGN.md touch gate, with a tiling gap of at least 24px
       ((44−20)/2 per side). This is a layout change, not a behaviour change, and is allowed by the ticket's "new
       layout".
     - Or exclude the swatches from the sweep, with a written reason and a follow-up ticket.
   - The new radio cards, segmented controls and the "Use system setting" text button also need a stated floor
     mechanism.
3. **Two parts of the check cannot fail (D3, task 3.8; spec "Charts follow a live switch").**
   - (a) "No label has `scrollWidth > clientWidth`" over ContextList rows and the command-bar title/breadcrumb. These
     truncate with an ellipsis on purpose (`ContextList.css:31,154,163`, `App.css:171,345`), so the result depends only
     on fixture name length:
     - Short names make it vacuously green.
     - Long names make it red under every style.
     - Say what "clipped" means: exclude `text-overflow: ellipsis` elements, or require them to have the full name
       available. Pin fixture names that fit in the sans face, so the check isolates Mono's wider metrics.
   - (b) "Header and body cells in a column share `left` and `width` (±1px)". The overview tables are a real `<table>`
     (`SortableTable.tsx:89`), so this holds by construction and proves nothing.
     - Keep the `tabular-nums` assertion.
     - Replace the left/width check with one that can fail, e.g. numeric cells in one column share a right edge (or
       their `text-align`) ±1px.
     - Or state outright that table column alignment is structural and needs no check.
   - (c) Spec scenario "Charts follow a live switch" says "axis and label text re-render in the mono face". Axis labels
     are already `fontMono` under every style (`chartAppearance.ts:221,231`), so a test on them passes without the
     recompute fix.
     - Name the global `textStyle`/legend family (`themeTokens.fontSans`, `chartAppearance.ts:215`;
       `referenceMarksOption.ts:93`).
     - In task 3.10, say how the jsdom test shows a real family change. jsdom never loads theme.css, so
       `resolveChartTheme()` returns fallbacks: set `--font-sans` inline on `documentElement` before and after the
       switch, or assert a second `resolveChartTheme` read after the tick.

### Non-blocking notes

- Task 3.5: state that the TS↔CSS sync guard checks both pairs (Comfortable token == `GRID_GUTTER_PX`, Compact token
  == `COMPACT_GRID_GUTTER_PX`). This was round-3 note 2 and is still implicit.
- Task 3.11: `app.html` has two copies of the font URL, the media=print link at line 32 and the `<noscript>` copy at
  line 42. Update both.
- If the executor ever writes `font-family: var(--font-face-*)` in a swept CSS file, `tokenAuditSweep` will flag it.
  That is the right outcome. Keep `--font-face-*` limited to the inline `--font-heading` override as D7 says, or add it
  to the guard's allow-pattern along with the DESIGN.md §3 exception.
- Task numbering lists 3.9–3.11 before 3.8. Harmless, but 3.8's Mono checks depend on 3.9, so keep that order when
  executing.
- No gate defect to record: no report I drilled into makes an mtime-ordering claim.
