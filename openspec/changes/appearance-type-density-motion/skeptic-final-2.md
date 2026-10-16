## Skeptic Report — final gate (round 2, skeptic-final-2.md)

**Reviewed HEAD:** `97b9fa44993041b5794da9d58f38bb7da7598125`. I resolved the review base live with `resolve-review-base.sh` (main/origin), which returned `7fd2f4f29157c1f159db12e99bda86ef886e4cf2` (exit 0). The full diff covers 83 files. Since the round-1 head, `git diff --stat ecfe75421..HEAD` shows 4 files:
- `AccentPicker.css`
- `AccentPicker.css.test.ts`
- `AppearanceSection.css` (the three theme-chip backgrounds)
- `e2e/hel1572-appearance-preferences.spec.ts` (a row-count assertion)

Evidence lives under `/home/matt/Development/helio/.concertino/runs/HEL-1572/evidence/.concertino/scratch/HEL-1572/skeptic2/`, written `EV/` below.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/appearance-type-density-motion/HEL-1572`.

**Round-1 CR1 (accent swatches in one row of 8 above 768px) is fixed.** I measured it live on :7004 after `document.fonts.ready`.
- **The CSS.** `.accent-picker` is `repeat(8, 28px)` with `gap: var(--space-4)`. An `@media (max-width: 768px)` block sets `repeat(4, 28px)`. The stale F-169 comment was rewritten and now names Settings → Appearance as the only consumer. A grep confirms that `<AccentPicker` is rendered only in `AppearanceSection.tsx:119`.
- **1280, both themes.** Computed `grid-template-columns` is eight 28px tracks. All 8 swatch tops are equal (y=176), the x positions run 216 to 524 on a 44px pitch, and each painted swatch is 28×28. See `EV/settings-dark-1280.png`, `EV/settings-light-1280.png` and, under Mono, `EV/settings-dark-mono-1280.png`.
  - With a fine pointer at 1280 there is no expander, by design (the `(max-width: 768px), (pointer: coarse)` gate). The `elementFromPoint` extent is the painted 28px, which is above WCAG 2.5.8's 24px.
  - **Coarse pointer at 1280.** I simulated it by injecting the expander rule into the page only, then removing it; no code changed. Each swatch's hit extent was about 22.5 / 21-21.5 px left/right/up/down, so roughly 44×44, and every swatch's extent ended exactly at its neighbour. That means the expanders do not overlap.
- **769px.** Still one row. The last swatch's right edge is at 552 and the control column's at 745. No horizontal overflow.
- **768px, light.** 2 rows of 4 (y=205 and 249), 44px pitch on both axes. Measured hit extents are about 44×44 for all 8 and none overlap. See `EV/settings-light-768.png`.
- **375px, dark.** 2 rows of 4 (y=223 and 267), the same about 44×44 non-overlapping extents for all 8, and no page overflow. See `EV/settings-dark-375.png`.
- **Unit tests.** The new jest test pins the 768px media block to `repeat(4, 28px)`. The tap-floor test now parses `repeat(8, …)`.
- **E2E.** The spec asserts 1 row at 1280 and 2 rows at 375/768, in addition to the existing `bisectHitExtent` checks on touch widths.

**Theme-later chips (round-1 non-blocking note) are addressed.**
- Dark: `rgb(38,35,32)` (`--app-surface-strong`), `rgb(242,239,233)` (`--app-text`) and the accent `rgb(249,115,22)`. The three are clearly distinguishable, each with an `--app-border-strong` outline.
- Light: white, `rgb(33,29,25)` and the accent. Also clearly distinguishable, all tokens.

**Gates re-run fresh on HEAD 97b9fa449.** Load was 4.6–7, under the 10 cap.
- **Jest** (`HELIO_JEST_MAX_WORKERS=2 nice -n 19`): the path pattern did not narrow, so the full frontend suite ran. 628 suites and **7463 tests passed**, one more than round 1 (the new 768px test).
- **Playwright** (`DEV_PORT=7004`, under `e2e.lock`, 2 workers, `nice -n 19`): `e2e/hel1572-appearance-preferences.spec.ts` plus `e2e/state-surface-contrast-guard.spec.ts` gave **32 passed (2.0m)**, exit 0 (`EV/e2e.log`). These are the only two e2e specs that reference `accent-picker`/`theme-swatch` (grep). The run includes the tap-target tests at 375/768/1280 and the HEL-866 contrast guard in both themes.
- **Servers.** Started via `start-servers.sh`, `assert-phase.sh servers` passed, and I stopped them with `stop-servers.sh` (STOPPED 7004,9911).

**The five acceptance criteria on this head.** Round 1 traced AC1–AC5 in detail (skeptic-final-1.md). The only runtime change since then is the two CSS files above, which cannot affect persistence, the motion/density tokens or the pre-paint script. I re-checked AC1–AC4 live:
- picking Mono / Compact / Off set `data-type-style="mono"`, `data-density="compact"` and `data-motion="off"`;
- `body` computed to `"JetBrains Mono", …`;
- `--density-grid-gap` was `0.5rem` and `--density-row-pad-y` was `0.25rem`;
- `/api/auth/me` returned `{density:"compact", motion:"off", typeStyle:"mono"}`.

AC5 (no flash) is covered by the no-flash e2e tests in the 32-pass run, including the negative control that strips the pre-paint script.

**Owner rulings and the board.**
- Q1–Q3 hold as verified in round 1. Comfortable is still 18px pending HEL-1576 (design.md D4 ordering, sync-guarded).
- The layout now matches the board: one row of 8 swatches, segmented Density and Motion, a dashed Theme row with a "Later" chip, and accent-agnostic tokens.
- The remaining differences from the board are non-blocking: the board's Theme chips are rounded squares and ours render near-circular, and the type-card titles wrap at 1280 (accepted in round 1).

**Gate-defect check (CON-160).** No report I drilled into discloses unsound evidence mtimes, and none of my conclusions rest on mtime ordering. Every claim above is a measurement (coordinates, computed styles, test counts).

### Verdict: CONFIRM

### Non-blocking notes
- **Swatch class names are inverted in light mode.** `.appearance__theme-swatch--dark` renders white and `--light` renders near-black, because they are bound to `--app-surface-strong` and `--app-text`. It is purely decorative and `aria-hidden`, but a rename (for example `--surface`/`--ink`) would stop the next reader tripping on it.
- **At exactly 768px the labels already stack.** The control column is full width (about 720px), so one row of 8 would fit there too. Keeping 4×2 at ≤768 matches my round-1 CR, so it is not a defect.
- **C3 (full Playwright on the final head).** The evaluator's full 340-test run was on `ecfe75421`, not `97b9fa449`. The delta is CSS on two selectors, and the only specs that touch them passed fresh here. If the orchestrator treats C3 literally, it needs a full-suite run on 97b9fa449 before delivery.
- **Still optional, carried from round 1:**
  - Dashboards/Assistant ContextList rows do not respond to density; worth a sentence in the PR.
  - The duplicated roving-radio key handler.
  - The verbose type-card accessible names.
  - The 32px right-edge step between Appearance rows and the Preferences cards.
- **Leftover data on the shared dev DB.** I registered `hel1572-skeptic2-1792114190532@example.test` (id `e4501548-1f87-4c84-95bf-ee562f417bd3`) with preferences saved as mono/compact/off. It is not in the e2e cleanup ledger.
