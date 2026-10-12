## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `513c0492c05b9b479ca6930cf0c6aae5ef1c041b` against live-resolved base `9e51550f16b7a2d29250e7b2f7e5b8c91076349f`
(`resolve-review-base.sh`). Scope: HEL-1490 item 1 only. Owner ruling C1 (runtime auto-adjust, no editor warning) is
settled and was not re-litigated.

Evidence dir (durable, outside the worktree): `/home/matt/Development/helio/.concertino/runs/HEL-1490/evidence/`,
all files prefixed `item1-eval1-`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (tone text >= 4.5:1 on surface and wash, both themes, 1440 and 375): met. Measured in the running app, see the
  Phase 3 table (420 measurements, minimum 4.558).
- AC2 (same hue family; glyph and sr label unchanged): met. The variants are `blend(token, black|white, t)`. Measured
  hue shift is at most ~5 degrees in CIELAB (for example dark error is 36.1 for the token and 34.5 on `#ffffff`). No
  renderer TSX changed, so the glyph and `ToneSrText` are untouched.
- AC3 (unit/label >= 4.5:1, still following panel text): met. Measured minimum is 4.558 (light, `#ff0000`, raised
  mix 67%). The value stays `color-mix(currentColor p%, transparent)`.
- AC4 (delta up/down/flat): included. `--panel-tone-success/error` serve up/down and `--panel-tone-muted` serves
  flat. Measured minimum is 4.62.
- AC5 (default panels unchanged): met. There is no inline `--panel-tone-*` or `--panel-secondary-text-mix` on the
  transparent panels, and their computed colours equal the `:root` tokens in both themes. `theme.css` is not in the
  diff.
- AC6 (no editor warning; nothing reaching ECharts uses `color-mix()`): met. There is no editor change. The picker
  outputs `#rrggbb`. `--panel-tone-*` is only read by CSS (grep: the only TS producer is `panelReadableTones.ts`).
  `chartAppearance.ts:91` reads `getComputedStyle(document.documentElement)`, never the card, so per-card inline vars
  cannot reach a chart.
- AC7 (red first; no new `eslint-disable`): met. `item1-red-tests.txt` shows module-not-found plus failing
  assertions before the implementation existed. The diff adds zero `eslint-disable`.
- AC8: done by this evaluation (Phase 3).
- Tasks 1.1-1.6, 2.1 and 2.3 are ticked and match the diff. 2.2 is the evaluator's task, done below.
- Spec deltas: I diffed the MODIFIED "Rendering per Output kind" requirement against
  `openspec/specs/output-conditional-formatting/spec.md`. It is a faithful copy plus the custom-background clause, and
  no scenario was dropped. The ADDED requirements match the behaviour. `npm run check:openspec` reports clean.
- I verified the public-viewer claim in the spec by grep: `buildPanelSurface`, `getPanelCardStyle` and
  `--panel-surface-override` are applied only in `PanelCard.tsx` and `MobilePanelStack.tsx` (plus the editor
  preview).
- CONSTRAINTS C1 is honoured: no editor warning, runtime fallback only.
- Scope: no creep. The `check-tokens.mjs` allowlist is the one unplanned change; it is judged below.

### Phase 2: Code Review — PASS
I ran the gates myself, fresh, in WORKTREE_PATH at 513c0492c:
- `npm run lint`: exit 0 (`item1-eval1-lint.txt`).
- `npm run format:check`: exit 0 (`item1-eval1-format.txt`).
- `npm run typecheck`: exit 0 (`item1-eval1-typecheck.txt`).
- `npm test`: exit 0. Root jest 454/454; frontend 564 suites, 6179/6179 tests (`item1-eval1-jest.txt`).
- `npm --prefix frontend run build`: exit 0 (`item1-eval1-build.txt`).
- `node scripts/check-tokens.mjs` plus its selftest: exit 0, 10/10 (`item1-eval1-check-tokens.txt`).
- Backend: no `backend/**` change, so `sbt testFull` was not run.

**`scripts/check-tokens.mjs` allowlist (unplanned): acceptable, no change needed.**
- It is required: `check-tokens` deliberately does not exempt a `var(--x, fallback)` reference (D3b), and the four
  `--panel-tone-*` tokens are intentionally never declared in CSS (D4: emitted inline only when needed).
- It follows the existing precedent exactly: `--panel-surface-override` and `--panel-text-override` are inline-only,
  fallback-read tokens allowlisted against `PanelCard.tsx`.
- The entries name the real setter chain (`panelReadableTones.ts` via `PanelCard.tsx`), which the allowlist's D4 rule
  requires. This is useful here because the key is built by a template string (`--panel-tone-${tone}`), so a literal
  grep would not find the setter.
- `--panel-secondary-text-mix` is correctly not allowlisted, because it is declared on `:root`.
- Declaring the tokens in CSS on the card instead would also have worked. Since it is not better than the established
  pattern, this is not a finding.

Code-quality notes:
- **Size budget:** the new logic was split into `theme/panelReadableTones.ts` (158 lines). `appearance.ts` grew by
  only 5 lines; it was already at 639 lines before this change.
- **Visibility changes:** the previously private helpers (`parseHexColor`, `toHexColor`, `getContrastRatio`,
  `resolveTintedSurface`, `RgbColor`) are now exported and reused. That is DRY and adds no duplicate maths.
- **No escape hatches:** no `any`, no `eslint-disable`, no TODOs.
- **Dead code:** none found.
- **D2/D3/D5 as designed:**
  - The picker stops at the first passing 4%-step. Backdrops and the unit/label composite are computed with
    unrounded float blends (`blendFloat`).
  - The internal target is 4.55. The mix search starts at the theme default and caps at 100.
  - Inline vars are emitted only when the value differs from the token, so default panels get none.
- **Mirror guard:** `panelReadableTones.css.test.ts` parses `theme.css` (tones, muted text, wash shares, mix default)
  per theme. It fails on drift by construction: exact `toBe` against declared values.
- **Tests are meaningful:**
  - Pass-through, darker/lighter, multi-backdrop worst case and minimal-step cases.
  - The unrounded near-threshold pair (dark, `#00ffff`, success), checked against an independent float model.
  - Cross-tone mark wash, a sweep over 11 backgrounds in both themes, and the 100% cap.
  - CSS consumers pinned to the `var(--panel-tone-x, var(--app-x))` form.
- **Performance:** `MobilePanelStack.tsx:159` calls `getPanelCardStyle` per render without a memo. Each call does at
  most about 3x25x4 contrast evaluations plus 40 mix steps, which is negligible.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` and `assert-phase.sh servers` (PASS) on 6922/9829.

**Identity:** I registered `hel1490-eval1-1791771329@example.test`, id `aa3ac73a-ed4c-4109-bdfd-46cdc95713de`, and
verified it via `/api/auth/me` before probing.

**Isolated browser (deviation from the MCP browser):** the shared Playwright MCP browser was unusable for this lane.
Within a minute of my login, its `localhost` session cookie had been replaced by another lane's user
(`eval5-...-hel1487-eval@example.test`; localhost cookies are not port-scoped), and the shared tab was navigated to
another lane's port. I made no probe as that user. All measurements were taken instead in a separate headless Chromium
context per theme/viewport (`item1-eval1-measure.cjs`, `item1-eval1-shots.cjs`, using the main checkout's
`node_modules/playwright` library). Each context logs in as the throwaway user and asserts `/api/auth/me` returns
`aa3ac73a-...` before measuring.

**Fixture:** the ops persona template, with the pipeline run twice so a real `previous_run` comparison exists (flat).
On top of that:
- One metric Output: warning rule, unit, label and `compare`.
- One table Output: success and warning cell rules on the first column `incidents`, an error cell rule on
  `avg_resolution_min`, and an error ROW rule on `uptime_pct`. The row mark lands in the first data cell, which can
  carry the warning wash.
- One collection Output: all three tones.
- 21 panels on dashboard `f6fb9f96-...`: transparent, `#ffffff`, `#000000`, `#ff0000`, `#3366ff`, `#ffcc00` and
  `#00ffff`, times the three kinds, all at transparency 0.

**Measurement method:**
- Each value is the computed `color` composited over the composited ancestor `background-color` chain. Float
  channels are parsed from `rgb()` and from `color(srgb ...)`, which the wash and the unit/label resolve to. The
  ratio is WCAG relative-luminance.
- Delta up/down: the fixture's data only yields a real flat comparison. So for up and down I inserted spans with the
  real classes `panel-content__metric-trend--up` and `--down` beside the real flat line, measured them, then removed
  them. This exercises the real cascade, including the inline vars.

Minimum ratio over 1440 and 375 (values were identical at both widths, 0 diffs; raw data in
`item1-eval1-ui/item1-eval1-contrast.json` and `item1-eval1-contrast-dark-375.json`; table in
`item1-eval1-ui/item1-eval1-contrast-table.md`):

| theme | bg | metric fig | unit | label | delta up | delta down | delta flat | coll succ | coll warn | coll err | cell succ/own wash | cell warn/own wash | cell err/own wash | err mark/WARN wash | err mark/err row wash |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| light | transparent | 6.18 | 4.68 | 4.68 | 6.20 | 6.16 | 6.25 | 6.20 | 6.18 | 6.16 | 5.29 | 5.29 | 5.28 | 5.27 | 5.28 |
| light | #ffffff | 6.23 | 4.70 | 4.70 | 6.24 | 6.21 | 6.29 | 6.24 | 6.23 | 6.21 | 5.32 | 5.32 | 5.32 | 5.30 | 5.32 |
| light | #000000 | 5.30 | 4.67 | 4.67 | 5.35 | 5.32 | 4.74 | 5.35 | 5.30 | 5.32 | 4.72 | 4.70 | 4.69 | 4.71 | 4.69 |
| light | #ff0000 | 5.49 | 4.56 | 4.56 | 5.51 | 5.49 | 4.64 | 5.51 | 5.49 | 5.49 | 4.78 | 4.83 | 4.84 | 4.83 | 4.84 |
| light | #3366ff | 5.34 | 4.64 | 4.64 | 5.36 | 5.34 | 4.80 | 5.36 | 5.34 | 5.34 | 4.66 | 4.64 | 4.64 | 4.65 | 4.64 |
| light | #ffcc00 | 5.55 | 4.64 | 4.64 | 5.57 | 5.53 | 5.61 | 5.57 | 5.55 | 5.53 | 4.77 | 4.78 | 4.77 | 4.77 | 4.77 |
| light | #00ffff | 5.64 | 4.69 | 4.69 | 5.66 | 5.62 | 5.70 | 5.66 | 5.64 | 5.62 | 4.87 | 4.83 | 4.80 | 4.82 | 4.80 |
| dark | transparent | 10.04 | 6.23 | 6.23 | 7.99 | 6.55 | 7.17 | 7.99 | 10.04 | 6.55 | 6.26 | 7.50 | 5.30 | 4.89 | 5.30 |
| dark | #ffffff | 5.93 | 4.59 | 4.59 | 5.96 | 6.02 | 4.74 | 5.96 | 5.93 | 6.02 | 4.91 | 4.65 | 5.16 | 4.71 | 5.16 |
| dark | #000000 | 10.59 | 6.38 | 6.38 | 8.43 | 6.91 | 7.56 | 8.43 | 10.59 | 6.91 | 6.70 | 8.05 | 5.66 | 5.25 | 5.66 |
| dark | #ff0000 | 8.24 | 5.33 | 5.33 | 6.56 | 6.08 | 5.88 | 6.56 | 8.24 | 6.08 | 5.55 | 6.19 | 4.84 | 4.56 | 4.84 |
| dark | #3366ff | 7.85 | 5.35 | 5.35 | 6.25 | 6.25 | 5.60 | 6.25 | 7.85 | 6.25 | 4.84 | 5.90 | 5.12 | 4.70 | 5.12 |
| dark | #ffcc00 | 6.03 | 4.63 | 4.63 | 6.06 | 6.11 | 4.67 | 6.06 | 6.03 | 6.11 | 4.92 | 4.56 | 5.08 | 4.63 | 5.08 |
| dark | #00ffff | 5.77 | 4.60 | 4.60 | 5.80 | 5.85 | 4.62 | 5.80 | 5.77 | 5.85 | 4.63 | 4.58 | 5.15 | 4.64 | 5.15 |

- **Ratios:** 420 measurements, 0 below 4.5. The minimum is 4.558 (light `#ff0000` unit/label).
- **Cross-tone mark:** "err mark/WARN wash" is a row-rule error mark measured inside a `td.ui-data-grid__cell--tone-warning`
  cell, so it sits on a different tone's wash. Its minimum is 4.56 (dark `#ff0000`). No row in the data puts an error
  row mark on a success cell, so that combination was not observable live; the unit sweep covers it.
- **Emitted variants match the design:**
  - Light theme: `#3366ff`, `#ff0000` and `#000000` emit all four `--panel-tone-*` plus a raised mix (66/67/71%).
    `#ffcc00` and `#00ffff` emit only a 63% mix. `#ffffff` emits nothing.
  - Dark theme: `#3366ff` and `#ff0000` emit only `--panel-tone-error`. `#000000` emits nothing. `#ffffff`, `#ffcc00`
    and `#00ffff` emit all four plus a mix.
- **Default panels:** no inline override. Computed colours equal the tokens (light: success `rgb(22,109,67)`, warning
  `rgb(133,85,26)`, error `rgb(175,51,37)`, muted `rgb(100,94,86)`, mix 62%; dark: `#4cc38a`, `#f5b944`, `#f17b67`,
  `#aaa49c`, mix 60%).
- **Distinguishability at the extreme (dark theme on `#ffffff`):** the variants are success `#b7e7d0`, warning
  `#f9d896` and error `#fbd5ce`. Their pairwise CIELAB dE76 is 38.1 (success-warning), 32.2 (success-error) and
  29.9 (warning-error), all far above a just-noticeable difference, and their hues are kept. The glyph shapes differ
  as well. Screenshots: `item1-eval1-ui/item1-eval1-dark-1440-{table,collection,metric}-ffffff.png`.
- **Console:**
  - The only app-originated errors are the expected pre-login `401` on `/api/auth/me` on the login page.
  - My first dark/375 pass hit `429` from the `/api` rate limiter. That came from my own harness volume (4 contexts x
    21 panels inside one minute) and is not a product defect. I re-ran dark/375 after the window and it showed no
    429; those are the numbers used above.
- **Breakpoints:** 1440 and 375 were measured and gave identical ratios. 1100 and 768 were not separately measured.
  The variants are inline per-card custom properties with no media query, and both the desktop grid
  (`PanelCard.tsx:143`) and the mobile stack (`MobilePanelStack.tsx:159`) set them, so no breakpoint dependence is
  possible. 375 exercised the mobile stack.
- **Accessibility, keyboard and loading/empty states:** unchanged by this colour-only diff. No TSX markup changed.

Cleanup: both servers I started are stopped. I killed the recorded PIDs (node 1502456/1502439, sbt 1502215/1501873;
1501831 exited with them), never by pattern, and confirmed ports 6922 and 9829 are free. The cookie jar was deleted.
My stray MCP files were moved to `item1-eval1-ui/playwright-mcp/`.

The throwaway user `aa3ac73a-ed4c-4109-bdfd-46cdc95713de` and its data remain in the shared dev DB: the sample
template plus dashboard `f6fb9f96-ae3b-4881-9e2a-1874b48fb882` and Outputs `8e968501-...`, `7ce1a8d9-...` and
`73c6d945-...`. Remove them by exact id if wanted.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `panelReadableTones.testUtils.ts:41-48` holds a third literal copy of the tone hexes, wash shares and panel
  surfaces. The guard test pins only the implementation's mirror to `theme.css`. If a token changes, the guard forces
  the mirror update, but the test model would keep the stale values.
  - The model's maths should stay independent. Its data could instead come from `PANEL_TONE_TOKEN_MIRROR`, which the
    guard already proves equal to `theme.css`.
  - Alternatively, extend the guard to assert the testUtils copy as well.
- `item1-mutation-guard.txt` and `item1-mutation-margin.txt` record only a `Tests: 1 failed` line, not which mutation
  was applied. Future mutation evidence should name the mutated line, so the record proves itself without the
  executor's narration.
- On the extreme (dark theme on `#ffffff`), the error variant `#fbd5ce` is close to the panel text colour (dE76 about
  14.7 against `#f2efe9`). It is readable and distinct from the other tones, and the glyph carries the meaning. This is
  noted for the skeptic's visual judgment; it is not a mechanical finding.
