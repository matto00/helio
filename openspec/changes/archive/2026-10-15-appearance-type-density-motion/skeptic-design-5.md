## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed HEAD 53632f81bee57d60cd38aae89b16f9fe7d1d59a1. `git status --short` was clean.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed
  `READY ambient=/home/matt/Development/helio branch=feature/appearance-type-density-motion/HEL-1572`.

- **Round-4 CR1 (44px check measured the wrong thing): fixed.**
  - D3 "Touch targets" now reuses the HEL-813 specs and their own two mechanisms:
    - box height for full-width rows, tabs and inputs;
    - `bisectHitExtent` for compact expander buttons.
  - Checked against the live tree:
    - `e2e/hel813-mobile-touch-target-floor.spec.ts:56-77` (`assertExpanderFloor`) bisects x and y and asserts the
      painted box is < 44.
    - `e2e/support/touchTargetProbe.ts:197` takes a `Locator` and `minPx`.
  - The specs log in with `registerAndLogin` and then `page.goto`. An `addInitScript` that seeds `helio-appearance` will
    therefore be read by the planned `app.html` pre-paint script.
  - D2 says server values are applied "as it already does for accent". `ThemeProvider.tsx:47-68` and
    `ThemeProvider.test.tsx:177` ("leaves the current accent untouched when preferredAccentColor is absent") show that
    accent does not overwrite local state when the server has no value. A fresh test user has no saved `typeStyle`, so
    the seeded cache should survive. This makes the parametrization workable. See note 1 for a non-vacuity assertion.

- **Round-4 CR2 (accent swatches below the floor; no mechanism for the new controls): fixed in the plan.**
  - D3 "Appearance page tap targets" and task 3.13 specify:
    - 28px swatches with a `--space-4` (16px) gap;
    - a 44px `::after` expander;
    - cards ≥ 88px tall from their content;
    - segments that take the expander on coarse pointers, verified by `bisectHitExtent`.
  - Geometry:
    - Pitch is 28 + 16 = 44 on both axes. `AccentPicker.css:7-10` uses a `gap` grid with 4 columns, so the 16px applies
      to rows and columns.
    - A 44px expander centred on each 28px swatch overhangs 8px per side, so neighbouring expanders meet edge to edge
      and do not overlap.
    - `bisectHitExtent` at 0.25px sampling will see 44 minus at most one sample step at the shared edge, within its
      epsilon.
  - Caveat: the literal `tapTarget.css` pattern sizes height only (see note 2). `bisectHitExtent` on x would catch
    this, so it corrects itself during execution.

- **Round-4 CR3(a) (clipping check could not fail): fixed.**
  - "Clipped" is now defined as: computed `text-overflow` is not `ellipsis`, and `scrollWidth > clientWidth + 1`.
  - This excludes the intentionally ellipsized ContextList and command-bar text. Fixtures are pinned.
  - The mutation (inject a `width: 3ch` label) goes red when the injected element is block or inline-block, because
    Chrome's `scrollWidth` includes visible overflow.
  - Caveats are in note 3.

- **Round-4 CR3(b) (table column check could not fail): resolved.** The plan now states outright that `<table>` column
  alignment is structural and not re-checked, which was one of the options round 4 offered.
  - The replacement `.mono` equal-digit check is itself unfailable. I measured it; see note 4. It is non-blocking
    because, by grep, the property it guards cannot regress under any of the three styles.

- **Round-4 CR3(c) (chart scenario named the wrong signal): fixed.**
  - D3 and task 3.10 now assert the global `textStyle.fontFamily`:
    - its source is `themeTokens.fontSans` (`chartAppearance.ts:215`);
    - `resolveChartTheme` reads `--font-sans` via `getComputedStyle(documentElement)` (`chartAppearance.ts:89-98`).
  - The jsdom test sets `--font-sans` inline on `documentElement`, so the family does change across the switch.
  - Motion is asserted on `animation`.
  - Axis labels are explicitly ruled out as the signal.

- **Round-4 non-blocking notes:**
  - The two `app.html` font links are both named in D3 and task 3.11. Done.
  - The confusing 3.8 numbering is gone.
  - The sync guard covering both densities is still implicit (note 5).

- **Owner rulings** (design.md "Owner rulings"; ticket Q1–Q3): D1, D3, D4 and C5/C6 all follow them. I did not
  relitigate them.

- **Nothing new from the revision contradicts DESIGN.md, HEL-813 or another plan section.**
  - The spec scenario "Mono keeps layouts intact" now names the mechanism ("painted box or invisible hit expander").
    That is consistent with D3.

### Verdict: CONFIRM

The plan is sound enough to implement. All three round-4 change requests were addressed in substance, and every AC is
covered by a task with a failable acceptance signal.

The defects below are sub-check specification errors, not design errors. Each has a one-line correction the executor
can apply. Where the check is an evidence gate, the evaluator should confirm the correction was made (notes 1 and 4
especially).

### Non-blocking notes

1. **Add a non-vacuity assertion to the Mono parametrization.** Before measuring, each Mono-parametrized HEL-813 and
   HEL-866 run should assert:
   - `document.documentElement.dataset.typeStyle === "mono"`, and
   - that a button's computed `font-family` starts with `"JetBrains Mono"`.

   Without this, a `ThemeProvider` that resets an absent server value to `sans`, rather than leaving the cache alone as
   accent does, would silently run the "Mono" pass in the default face and stay green. If the cache seed proves
   fragile, seeding via `PATCH /api/users/me/preferences {typeStyle:"mono"}` is the more faithful alternative.

2. **The accent expander must be sized on both axes.** `frontend/src/shared/ui/tapTarget.css` sizes the expander
   height only (`left:0; right:0; height:44px`), so `.tap-expand-44` used as-is gives an x extent of 28px. The swatch
   expander needs an explicit `width: 44px`, centred.

   Also, the swatch `:hover { transform: scale(1.15) }` (`AccentPicker.css:27-29`) scales the `::after` too, to about
   50.6px. After a tap on touch, sticky hover could make one expander overlap its neighbour. Consider dropping the
   scale inside the tap gate.

3. **The clipping sweep is thinner than its target list suggests.**
   - BottomNav tabs are icon-only, with no visible label (`BottomNav.tsx:15-16`, `aria-label` only), and the
     command-bar targets are icon buttons. At 375 the sweep therefore effectively covers only the Appearance controls.
   - `clientWidth`/`scrollWidth` are 0 on non-replaced inline elements. Sweep the block or inline-block containers
     (buttons, tabs, cells), not bare inline spans.
   - The HEL-813 specs run at 430 and 768, not 375. The spec scenario "Mono keeps layouts intact" says 375. Either add
     375 to the Mono parametrization or restate the scenario's width.

4. **The `.mono` equal-digit-width check and its mutation cannot fail.**
   - Why: `.mono` sets `font-family: var(--font-mono)` (`theme.css:507-510`). JetBrains Mono and every fallback in the
     stack are monospace.
   - What I measured (headless Chromium, run twice with identical results, script under the scratchpad
     `hel1572/probe.cjs`):
     - "1111" and "8888" in the mono stack *without* `tabular-nums` were both 38.406px.
     - In the sans stack with `proportional-nums` they were 28.23 and 37.70px.
   - So removing `tabular-nums` from `.mono` does not turn the Sans + mono run red, contrary to D3's "Mutation proof".
   - Why the property is still safe: all 13 `tabular-nums` sites use either `--font-mono` or inherited `--font-sans`.
     None uses `--font-heading` (grep over `frontend/src/**/*.css`; the one apparent hit is `.wordmark`, a separate rule
     above `.mono`). Serif therefore never touches a tabular site, and Mono only makes digits more uniform. Tabular
     alignment cannot regress under any style.
   - Correction, either of these:
     - (a) Replace the check with that recorded grep plus the statement "structural, like table columns".
     - (b) Run the equal-width check on a sans-inherited tabular site (e.g. `.run-history-modal__row-duration`,
       `RunHistoryModal.css:46-53`), where removing `tabular-nums` does go red under Sans + mono.

   Do not present the `.mono` mutation as proof.
5. **Task 3.5:** state that the TS↔CSS sync guard checks both pairs: the Comfortable token equals `GRID_GUTTER_PX`,
   and the Compact token equals `COMPACT_GRID_GUTTER_PX`. This is carried over from rounds 3 and 4.
6. **Spec "Charts follow a live switch"** lists tooltip text, but the tooltip is already `fontMono` under every style
   (`chartAppearance.ts:209`). The assertion D3 names (global `textStyle.fontFamily`) is the right one; trim "tooltip"
   from the scenario wording.
7. **No gate defect to record:** no report I drilled into makes an mtime-ordering claim.
