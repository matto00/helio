## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `395db8d9cab81801c6dd3de09bbd2bb20e639feb`.
Review base (resolved live via `resolve-review-base.sh`): `d8387507734f8e74bbf62df8880923791ec7c08d`.
origin/main has since moved to `647734111` (HEL-1608 #1064). `git merge-tree origin/main HEAD` merges cleanly.
HEL-1608's diff touches the spine CSS and the hel1579 spec, but not `--app-accent-strong` or `.mobile-pill`, so the two
changes do not overlap. HEL-1668 (gating pipeline-page `:hover` in `@media (hover: hover)`) is not merged yet. Whichever
of the two lanes merges second has to wrap the two new light `.mobile-pill` rules; the driver note in
workflow-state.md already records this.

### Phase 1: Spec Review — PASS
- AC1 (accent hover text >= 4.5:1 in both themes): met at the token, app-wide. `buildAccentTokens` now writes
  `--app-accent-strong` at runtime, mixed away from the ink (`appearance.ts:611-660`). Every one of the ~38 CSS
  consumers is a `background` under `color: var(--app-accent-ink)`. I checked each consumer and found none that uses
  the token as text or as a border. The chart emphasis consumer was moved off the token (D2b).
- AC2 (Dry run hover >= 1.10:1 vs rest): met. Two light-only selectors in `PipelineMobile.css:417-427`, exactly as
  D2 specifies.
- AC3 (running app, both themes, desktop and phone; the HEL-1582 pin removed): the pin is gone from
  `e2e/hel1582-mobile-pipeline.spec.ts`, and I verified the running app myself (Phase 3).
- No AC was reinterpreted. All tasks are ticked. Task 4.0 is a PR-body item that becomes due at Delivery, so the
  orchestrator should confirm the "UI decisions taken overnight" section is actually in the PR body.
- There is no scope creep: the rename across 10 chart test fixtures follows mechanically from D2b's field rename.
- Spec deltas: `openspec validate accent-hover-contrast-fix` reports the change valid. The MODIFIED "Phone touch floor
  and state contrast" requirement keeps the original "Touch floor sweep" scenario and adds two new ones.
- CONSTRAINTS: `[]`, so there is nothing to honour.

### Phase 2: Code Review — PASS
I re-ran the gates myself in WORKTREE_PATH:
- `npm run lint`: clean, zero warnings.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test` (2 workers, `nice -n 19`): root 61/61 suites, 524 tests; frontend 723/723 suites, 9073 tests; exit 0.
- `npm --prefix frontend run build`: OK.
- e2e: `hel1582-mobile-pipeline`, `hel1579-pipeline-spine-layout` and `state-surface-contrast-guard`, run with 2
  workers, `--trace retain-on-failure`, under the e2e lock, against 7101/10008: **53/53 passed**. That includes the
  hel1579 `:174` accent audit, the known HEL-1620 flake, which passed first time here. Transcript:
  `/home/matt/Development/helio/.concertino/scratch/HEL-1669/eval-1/e2e-eval.txt`.

Code findings:
- **DRY:** the ink choice is extracted into `pickAccentInk`, which `buildAccentTokens` and `deriveAccentStrong` both
  call. The unit sweep keeps a local copy of the ink rule (`inkFor`) for speed. A test keeps that copy honest by
  asserting it agrees with `buildAccentTokens` on the presets plus one light-ink accent. Acceptable.
- **Tests:** the guard covers the 8 presets plus both defaults in both themes, at >= 4.5 and >= rest. The sweep steps
  every 5th channel value plus 255, a step the test states; D3 allowed up to every 15th. Over that sweep the guard
  asserts >= 4.5 and >= rest, sees both ink kinds, and checks that dark-theme parity with the old mix stays within 1 per
  channel. focusRingTokenGuard D5a now runs against the rendered token, and its "Yellow fails 3:1" check still holds.
  The e2e adds a check that the Dry run hover is distinct from rest and that the Run pill rest and hover match their
  tokens.
- **Red-first proof:** the executor's transcripts show each new check failing before its fix:
  - red-a: Dry run 1.0253 against the old CSS.
  - red-b: Run pill light hover 3.929 against the old token.
  - red-c: Run pill rest turned neutral (`rgb(239,236,230)`) under the naive selector.
  - unit guard: 12 failures against the old toward-black mix.

  These are consistent with the arithmetic in the ticket and design.md, and with my own measurements.
- **Security, error handling:** an unparseable hex returns `{}` from `buildAccentTokens` and `null` from
  `deriveAccentStrong`. That is unchanged behaviour, and it is tested.
- **No dead code:** the removed `toHex`, `mixWith` and `parseAccentStrongMix` helpers have no remaining callers, and
  lint is clean.
- **[mechanical] DESIGN.md rules:** both new CSS rules use existing tokens only. No new token names are added, and no
  per-component accent override is added.
- **Docs:** stale comments and DESIGN.md text were updated as design.md requires: §3, §5, §8 and A.7 in DESIGN.md, the
  `theme.css` comments, `chartAppearance.ts` and `useChartOption.ts`.

### Phase 3: UI Review — PASS
I tested in the running app (start-servers.sh on 7101/10008, assert-phase `PASS servers`), using the shared dev account
with Orange (the ticket's case) and Yellow (the worst light-tint case). Ratios were computed from `getComputedStyle`
during a real Playwright hover.

| Surface | Viewport | Theme | Hover fill | Ink on hover | Before (ticket) |
| --- | --- | --- | --- | --- | --- |
| Spine header Run pipeline (Orange) | 1440 | light | rgb(250,149,78) | 8.208 | 3.93 |
| Settings "Save preferences" primary (Orange) | 1440 | light | rgb(250,149,78) | 8.208 | 3.93 |
| Spine header Run pipeline (Yellow) | 1440 | light | rgb(239,197,67) | 11.036 | 5.56 |
| Spine header Run pipeline (Yellow) | 1440 | dark | rgb(239,196,62) | 10.948 | 10.95 (unchanged) |
| Spine header Run pipeline (Orange) | 1440 | dark | rgb(250,146,73) | 8.034 | 8.03 (unchanged) |
| Phone Run pill (Orange) | 390 | light | rgb(250,149,78) | 8.208 | 3.93 |
| Phone Run pill (Orange) | 390 | dark | rgb(250,146,73) | 8.034 | 8.03 |

| Dry run pill | Theme | Rest | Hover | Hover vs rest | Hover vs `--app-bg` |
| --- | --- | --- | --- | --- | --- |
| 390 | light | rgb(239,236,230) | rgb(255,255,255) | 1.179 | 1.119 |
| 390 | dark | rgb(26,24,22) | rgb(38,35,32) | 1.133 | (unchanged) |

- The Run pill rests on `--app-accent` (`rgb(249,115,22)`) in light. The `:not(.mobile-pill--primary)` guard works.
- The theme switch re-derives the token: Yellow is `#efc43e` in dark and `#efc543` in light, so the provider
  re-applies it on theme change.
- Chart hover emphasis: I imported the live `/src/utils/chartAppearance.ts` in the page and ran `resolveChartTheme()` +
  `applyHoverEmphasis`. In both themes, `accentEmphasis` is `#db6513`, equal to the live `--app-focus-ring-color`.
  Before the change it was the light `color(srgb 0.742 0.343 0.066)` mix. Emphasis `itemStyle.borderColor` and
  `lineStyle.color` are both `#db6513`. The change works as designed.
- Console: the only error on the pipeline page is a pre-existing `404 /api/pipelines/:id/schedule` for a pipeline with
  no schedule. It is unrelated to this change, and nothing else is logged.
- Breakpoints: the change is colour-only, with no layout properties touched. 1440 and 390 were rendered and look
  normal. The 1100 and 768 layout is not affected by a background colour.
- Evidence (durable; it lives in the main-checkout scratch dir, outside the worktree):
  `/home/matt/Development/helio/.concertino/scratch/HEL-1669/eval-1/` contains
  `1440-light-orange-spine-run-hover.png`, `1440-light-orange-settings-save-hover.png`,
  `390-light-orange-pills-rest.png`, `390-light-orange-dryrun-hover.png`, `390-light-orange-run-hover.png` and
  `390-dark-orange-run-hover.png`.

**Is the executor's simulated "before" adequate?**

For the accent pair, yes. Removing the inline `--app-accent-strong` exposes the theme.css `color-mix` fallback, which
this commit leaves unchanged from main, so the simulated "before" is exactly what main renders. The measured 3.9457
matches the ticket's 3.95. The red-b e2e transcript backs this up independently.

For the Dry run, the "before" numbers (rest `#fdfcfa`, 1.0253) match main's CSS, and red-a backs them up. One
evidence gap, which does not block: the light and dark Dry run before/after PNGs are byte-identical pairs (same md5).
They capture only the hovered state, whose fill (`#fff`) did not change, so the PNGs do not show the rest-fill change
that actually happened. My `390-light-orange-pills-rest.png` covers the rest state. The dark before/after pairs being
byte-identical is expected, because dark is unchanged.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- **For the skeptic (judgment):** the light Dry run pill's rest fill is now `--app-surface-soft` (`#efece6`) on the
  `--app-bg` (`#f4f2ed`) canvas, about 1.05:1. Before, it was near-white at about 1.07:1. It still has its hairline and
  shadow. design.md already records this as a reversible overnight decision.
- **For the skeptic (judgment):** light-theme primary hover is now a lighter tint than rest. Against a white surface,
  Yellow's hover is about 1.65:1. This is a deliberate, reversible decision.
- `appearance.ts` (671 lines), `focusRingTokenGuard.css.test.ts` and `hel1582-mobile-pipeline.spec.ts` were already
  over CONTRIBUTING's soft size budget and grew slightly. The budget is informational only.
- If this merges after HEL-1668, wrap the two new light `.mobile-pill` rules in `@media (hover: hover)` per that
  lane's convention (driver note).
