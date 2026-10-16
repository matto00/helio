## Skeptic Report — final gate (round 1, skeptic-final-1.md)

**Reviewed HEAD:** `ecfe7542156fc00c384c51f89b6d6083bc213d09`. The review base was resolved live with `resolve-review-base.sh` (main/origin) and gave `7fd2f4f29` (exit 0). The diff covers 83 files.

Evidence lives under `/home/matt/Development/helio/.concertino/runs/HEL-1572/evidence/.concertino/scratch/HEL-1572/skeptic/` (written `EV/` below).

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/appearance-type-density-motion/HEL-1572`.

**Gates (fresh, this worktree, load about 5).**
- Jest, 2 workers, `nice -n 19`: 628 suites and 7462 tests passed. My path pattern did not narrow the run, so this was the full frontend suite. The counts match the evaluator's.
- Playwright (`DEV_PORT=7004`, under the e2e lock, 2 workers, `nice -n 19`): `e2e/hel1572-appearance-preferences.spec.ts` plus `e2e/state-surface-contrast-guard.spec.ts` gave **32 passed (2.1m)**.
- I did not re-run the backend. It has not changed since 540bda525 (`git diff --stat 540bda525..HEAD -- backend` is empty). The evaluator's cycle-1 `sbt testFull` passed 8150 with 0 failures. I read the new `UserPreferencesRoutesSpec` cases:
  - fields accumulate;
  - 9 invalid bodies get 400 and the stored value stays unchanged;
  - `motion: null` clears the choice and is idempotent;
  - an invalid stored value is dropped on read;
  - user B's writes leave user A's row byte-identical through the app role.

**AC1: type style re-renders headings with no reload and survives on another device.** Met.
- Live, at 1280: picking Mono set `data-type-style="mono"`. The computed fonts on `body` and `h1.page-title` became `"JetBrains Mono"`. The Sans preview card stayed `"Schibsted Grotesk"`, so the raw face tokens work.
- `/api/auth/me` returned `typeStyle: "mono"`.
- Serif turned `.page-title` and the ContextList heading into Fraunces and left body copy and section h2s sans. That matches DESIGN.md §3's list of `--font-heading` readers, which is the pre-existing HEL-1571 standard.
- New-device check: I removed `helio-appearance` from localStorage and reloaded. The server value was restored as `mono/compact/off` and the cache was rewritten.
- The e2e spec covers a new browser context and the no-reload flag.

**AC2: density switches grid gutters and list row heights between two documented token sets.** Met.
- I measured the real dashboard live (finance template, 3 panels).
  - Comfortable: tops 72/492/772, heights 402/262/262, gutter 18.
  - Compact: tops 72/492/772 (unchanged), heights 412/272/272, gutter 8.
- This is exactly the design's derived compensation (`gridMetrics`, `panelGridConfig.ts`).
- Row padding reads `--density-row-pad-y` at `.context-list__row` (sources/pipelines), `.pipeline-list-table__td`, `.source-list-table td` and `.connectors-page__td`.
- Both token sets are in DESIGN.md Spacing > Density.
- Comfortable is 18px, not the owner's 12px, because HEL-1576 has not merged (`git log origin/main` has no HEL-1576). design.md D4 plans this ordering explicitly, and `appearanceTokens.css.test.ts` pins the TS and CSS values together. Accepted.

**AC3: Off disables motion-token animation, and no preference plus OS reduce gives Off.** Met.
- Live with Off: `--motion-duration-standard` = `0.01ms`, `--app-transition` = `0.01ms ease`, and a segmented option's computed `transition-duration` = `1e-05s`. That is near-zero, not 0s, per C4.
- The global rule in `theme.css` is scoped to `:root:not([data-motion])` under the media query, with an unconditional `[data-motion="off"]` twin.
- `reducedMotionScopeGuard.css.test.ts` checks each selector's twin. The evaluator's 14/14 mutation sweep shows it is failable.
- The e2e motion test passed in my run.

**AC4: schema, contract and backend persist the fields, with tests.** Met.
- Both schemas carry the three enums, and `motion` is nullable in the request.
- `UserPreferencesRoutes` validates against the closed sets.
- `patchPrefs` is a single UPDATE (`|| patch` then `- 'motion'` when clearing).
- Every `UserPreferences` construction site carries the fields (`ApiRoutes.scala:891`, `UserPreferencesRoutes`, `UserResponseAssembler`).

**AC5: no flash, checked in a real browser.** Met.
- `app.html` has an inline pre-paint script that validates the enum sets inside try/catch. There is no CSP in the repo that would block it (grep found none).
- The e2e no-flash tests passed: a cached reload, a new device with no cache, and two negative controls. One negative control strips the pre-paint script and the probe then fails as it should.

**Iron Laws.** This is not a bug fix, so the debugging law does not apply. Every claim above comes from output I produced myself, except the backend run. For that I relied on the evaluator's pasted run on an unchanged backend.

**UI and design judgment.** I took screenshots, both themes, 1280 and 375, and looked at each:
- `EV/settings-dark-sans-1280.png`
- `EV/settings-dark-mono-1280.png`
- `EV/settings-light-serif-1280.png`
- `EV/settings-dark-mono-compact-off-1280.png`
- `EV/dash-light-serif-comfortable-1280.png`
- `EV/dash-light-mono-compact-1280.png`
- `EV/settings-dark-mono-375.png`

What holds up:
- Selection states use only `--app-accent*` tokens.
- Light and dark match.
- Mono is legible on the settings page and the dashboard. Its wider labels truncate with an ellipsis where intended (ContextList).
- `SegmentedRadioGroup` is a justified new shared primitive: no segmented component existed, and the only `radiogroup` was ad hoc. Its selected state is a neutral lift, which matches the spine's "neutral lift, not an accent wash".
- At 375 the labels stack and the cards stack.

**Judgment calls the orchestrator handed me, and overnight UI decisions:**
1. **Accent swatches in 2 rows of 4: rejected (CR1).** The ticket asks for "new layout" for the accent row and the board shows one row of 8. The desktop control column is 536px wide and 8 × 28 + 7 × 16 = 336px fits easily. `.accent-picker`'s `grid-template-columns: repeat(4, 28px)` is a leftover from the retired UserMenu popover; the file's own stale F-169 comment says so. AppearanceSection is now its only consumer. On the ticket's own page it reads as a palette block. That leaves a dead second row under the "ACCENT" label, while every other row (segments, Mode, Theme) is a single line (`EV/settings-dark-sans-1280.png`).
2. **Type-card titles wrapping at 1280: accepted.** The section shares the Settings page's 672px column with its siblings. Widening only Appearance would break the page rhythm. Mono's "Markets & Business" (about 173px at 16px) cannot fit the 138px content box of a three-up card at any reasonable size. The wrap is clean, card heights stay equal (128px), and each card still shows its face.
3. **Mode row second: accepted.** The `frontend-theme-system` spec requires it, it is unchanged in behaviour, and it fits the row grammar.
4. **"Use system setting" text button: accepted.** It appears only when a choice is saved, is inline in the hint line, and has an accent-text underline plus a coarse-pointer 44px expander.
5. **28px swatches, 16px gap, 44×44 expanders, hover scale on an inner dot: accepted.** The pitch is 44 on both axes, so expanders touch without overlapping. This matches the board's larger swatches.

### Verdict: REFUTE

### Change Requests

1. **Lay the accent presets out in one row of 8 on desktop, per the board** (`frontend/src/shared/chrome/AccentPicker.css:7-11`).
   - **Above 768px:** use `grid-template-columns: repeat(8, 28px)`. Keep `gap: var(--space-4)` so the 44px pitch, and with it the non-overlapping 44×44 expanders, are unchanged.
   - **At 768px and below:** keep `repeat(4, 28px)`. At 375 the control column is about 327px, below the 336px a single row needs.
   - **Clean-up:** update the stale F-169 comment ("only ever renders inside the UserMenu popover") to name AppearanceSection as the sole consumer.
   - **Tests:** update `AccentPicker.css.test.ts` for both column counts.
   - **Acceptance signal:** at 1280 all 8 swatch centres share one `top`; at 375 there are 2 rows of 4; the `hel1572` tap-floor e2e still passes at both widths.

### Non-blocking notes

- **Theme "Later" swatches** use `--app-bg`, `--app-surface-raised` and `--app-accent-dim`. In dark mode the three squares are almost indistinguishable (`EV/settings-dark-sans-1280.png`). The board uses three contrasting chips (dark / cream / navy) to suggest a palette. Consider fixed, contrasting tokens.
- **Right-edge misalignment.** Appearance rows run to x=752 (the section's full 672px), while the Preferences cards below stop at x=720. Pre-existing card width, but now visible as a 32px step.
- **Dashboards ContextList rows do not respond to density.** `DashboardList` rows are fixed-height `--control-md` buttons with no vertical padding, and the Assistant list likewise. This complies with the owner's literal ruling ("row padding 8→4") and DESIGN.md's fixed control heights. But on the Dashboards section, Compact visibly tightens only the grid. Worth a sentence in the PR so the owner is not surprised. Also, the execution-notes grep records the included sites but not this exclusion.
- **Evaluator's carried suggestions, still optional:**
  - the duplicated roving-radio keyboard handler in `AppearanceSection.tsx` versus `SegmentedRadioGroup`;
  - the verbose card accessible names ("Markets & Business 140 Sans + mono"); consider `aria-label={card.label}`.
- **Leftover data from this review.** I registered `hel1572-skeptic-1792110543421@example.test` (id `8b429796-…`) on the shared dev DB and instantiated the finance template for it. It is not in the e2e cleanup ledger.
- **Gate-defect check (CON-160).** No report I drilled into discloses unsound evidence mtimes, and none of my conclusions rest on mtime ordering.
