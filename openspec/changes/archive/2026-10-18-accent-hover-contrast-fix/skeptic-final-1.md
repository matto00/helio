## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `395db8d9cab81801c6dd3de09bbd2bb20e639feb`. Review base resolved live with `resolve-review-base.sh`:
`d8387507734f8e74bbf62df8880923791ec7c08d` (merge base). `origin/main` (647734111, HEL-1608) changes no file this
branch touches: no `accent-strong` or `mobile-pill` hits in `git diff d838750 origin/main`, and
`git merge-tree --write-tree origin/main HEAD` is clean.

### What I verified (with evidence)

**AC1: accent hover text is at least 4.5:1 in both themes, fixed at the token and app-wide.**
- `appearance.ts` `buildAccentTokens` now writes `--app-accent-strong` inline on `<html>`, mixed away from the
  chosen ink: toward white under the dark ink, toward black under the light ink, at 24% in light and 22% in dark.
  There are no per-component overrides.
- I grepped every consumer: 38 `background: var(--app-accent-strong)` hover rules. Every one sits under
  `color: var(--app-accent-ink)`, and none uses the token as text or a border. The chart consumer has moved off it.
- I wrote my own Node script (scratchpad `sk1669/cube.js`) and swept the **full** 256^3 sRGB cube, not a sample:
  - The minimum ink-on-hover is **4.93 in light and 4.83 in dark**, both at `#f50000`.
  - Hover contrast is never below rest contrast: 0 violations.
  - design.md claims 4.96/4.86 at `#f60000`. That figure came from a 3-step sample, so it is slightly off, but the
    4.5 floor holds across the whole cube.
- Light-theme presets now give ink-on-hover between 6.42 (Red) and 11.04 (Yellow). Before the change the range was
  2.95 to 5.56.
- Running app, real Playwright hover, `getComputedStyle` after the transition settles:
  - Desktop 1440, light, Orange, spine-header Run pipeline: `rgb(250,149,78)` → **8.208**
  - Desktop 1440, light, Orange, Settings "Save preferences": **8.208**
  - Desktop 1440, light, Yellow, spine Run: **11.036**
  - Desktop 1440, dark, Yellow, spine Run: **10.948** (unchanged)
  - Phone 390, light, Orange, Run pill: **8.208**
  - Phone 390, dark, Orange, Run pill: **8.034** (unchanged)
- Toggling the theme re-derives the token: Yellow is `#efc543` in light and `#efc43e` in dark.
- Custom accents that get the light ink darken on hover as intended:
  - `#1d4ed8`: 6.54 → 9.33
  - `#7c3aed`: 5.56 → 8.21

**AC2: the Dry run hover is visibly distinct from its rest fill.**
- At phone width in light, the rest fill is `rgb(239,236,230)` and the hover fill is `rgb(255,255,255)`.
- Hover vs rest is **1.179**. Hover vs `--app-bg` is 1.119.
- The Run pill rest is still `rgb(249,115,22)` (`--app-accent`), so the `:not(.mobile-pill--primary)` guard works.
- Dark is unchanged (`rgb(26,24,22)` rest).

**AC3: the HEL-1582 exception pin is removed, and the change is compared against the running app.**
- `isKnownAccentHover` and `KNOWN_ACCENT_HOVER_FLOOR` are deleted from `e2e/hel1582-mobile-pipeline.spec.ts`.
- The generic 4.5 filter now covers the Run pill hover, and the spec asserts the filter saw it in both themes.
- A new test checks that Dry run hover vs rest is at least 1.10 and that the Run pill rest and hover match their
  tokens.
- I checked the running app myself (above).

**Gates**
- I re-ran the targeted unit suites with 2 workers under `nice -n 19`: 23 suites and 498 tests pass. They cover
  appearance, focusRingTokenGuard, chartAppearance, ChartPanel.theme, buildChartOption*, referenceMarks, chartOverlay
  and the PanelCard pie test.
- `npm --prefix frontend run typecheck` is clean.
- I relied on the evaluator's pasted e2e transcript (`eval-1/e2e-eval.txt`, 53/53 passed) and the red-first
  transcripts. For example, `red-b` shows `light Run pipeline pill hover ... text=3.929` failing against the old
  token. Both are unambiguous, so I did not re-run them.

**Design judgment calls deferred to me**
- **(a) The light primary hover is now a lighter tint.**
  - The hover still reads clearly as a hover. Hover vs rest is between 1.16 (Yellow) and 1.42 (Purple) across the
    presets. See `1440-light-orange-spine-run-hover.png` and `1440-light-orange-settings-save-hover.png`.
  - Yellow's hover is about 1.65:1 against white. Its rest fill is already only about 1.9:1 there, and a filled
    button with text does not need a 3:1 boundary, so this is not a new kind of failure.
  - Lightening on hover is a common pattern. It is consistent with dark theme, which has always lightened.
  - DESIGN.md §3 and §5 are updated to describe the token as ink-aware.
  - It is reversible: one function plus one constant.
  - Acceptable.
- **(b) The light Dry run pill now rests on `--app-surface-soft`.**
  - In `390-light-orange-pills-rest.png`, the pill stays clearly delineated by its border-strong hairline and soft
    shadow, over both the canvas and a white card.
  - It reads as a quiet secondary pill next to the solid primary. Hover-to-white
    (`390-light-orange-dryrun-hover.png`) is now visible.
  - The semantic stretch ("recessed" token on a floating element) is disclosed in design.md D2.
  - It is reversible: two CSS rules, existing tokens only.
  - Acceptable.
- **(c) The chart hover emphasis now uses `--app-focus-ring-color`.**
  - Checked live: `resolveChartTheme().accentEmphasis` equals `--app-focus-ring-color` for Orange, Yellow and Green.
  - In light it measures at least 3.02:1 against `--app-bg`, `--app-surface`, `--app-surface-soft` and
    `--app-surface-strong`.
  - Leaving it on `--app-accent-strong` would have put a light tint (Yellow about 1.65) on white panels. Moving it is
    the correct decoupling, not a regression.
  - In dark the emphasis is darker than before (Orange `#db6513` instead of `#fa9249`) but still above 3:1 on dark
    surfaces, per the focus-ring guard.
  - It is reversible: one field read.
  - Acceptable.

**Screenshots** were taken and viewed by me. They are stored outside the worktree in the main-checkout scratch dir,
so `cleanup.sh` does not remove them:
`/home/matt/Development/helio/.concertino/scratch/HEL-1669/skeptic-final-1/`

| File | md5 |
| --- | --- |
| `1440-light-orange-spine-run-hover.png` | 723c9d6d… |
| `1440-light-orange-settings-save-hover.png` | 017fa9f6… |
| `390-light-orange-pills-rest.png` | 73075f6f… |
| `390-light-orange-dryrun-hover.png` | 99a1ae7f… |
| `390-dark-orange-run-hover.png` | 920c1312… |

The rest and hover pills have distinct checksums. I tested Orange through the app's real `applyAccentTokens`
(imported from `/src/theme/appearance.ts`), so the dev account's persisted accent was not changed. The theme was
returned to dark, its starting state.

No mtime-ordering evidence is relied on. No gate defect was found.

### Verdict: CONFIRM

### Non-blocking notes
- A near-black custom accent with the light ink (for example `#000000` to about `#101010`) now darkens toward black
  in dark theme too, so the hover is invisible or barely visible. `#000` gives an identical hover. The old dark mix
  lightened it, so this is a small edge-case regression in dark theme. Light theme already behaved this way before
  the change. It could be fixed with a floor on the hover-vs-rest delta (for example, flip direction when the darken
  step is under about 1.1:1, as long as ink contrast stays at least 4.5). It does not block: presets are unaffected,
  and the ticket's ACs are about contrast.
- design.md D1's "weakest point 4.96/4.86 at `#f60000`" is a sampled figure. Over the full cube it is 4.93/4.83 at
  `#f50000`, and the in-code comment and test comment repeat the sampled number. Correct it if convenient.
- Merge ordering with HEL-1668: whichever lane merges second must wrap the two new light `.mobile-pill` rules in
  `@media (hover: hover)`. Only the hover rule needs it; the rest-fill rule must stay ungated.
- The Delivery PR body must carry the "UI decisions taken overnight" section with (a), (b) and (c) above (task 4.0).
