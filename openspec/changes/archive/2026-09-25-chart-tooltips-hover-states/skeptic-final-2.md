## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed fresh (cold spawn, spawn-cwd guard passed: `READY ambient=/home/matt/Development/helio
branch=feature/chart-tooltips-hover-states/HEL-566`). `head_sha` reviewed:
`315da661f2d02c21b2afc4613bfa2868714355e3` (on top of base `8a746496e818e61248c4727c351d7b48e39867a5`).

### What I verified (with evidence)

**1. Gates re-run fresh (not trusted from any report):**
- `npm run lint` (frontend) — clean, exit via `eslint src --max-warnings=0`, no output = 0 warnings.
- `npm run typecheck` — `tsc --noEmit`, exit 0, no output.
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm test` (full suite) — `Test Suites: 342 passed, 342 total / Tests: 3768 passed, 3768 total`.
- `npm --prefix frontend run build` — succeeded, `✓ built in 287ms`, only the pre-existing >500kB chunk-size
  advisory (unrelated to this ticket).
- Only `frontend/**` changed (`git diff --name-only $BASE_SHA...HEAD`), so the backend `sbt test` gate's
  `when` glob doesn't apply — correctly skipped.

**2. Root-cause fix vs. timing hack (systematic-debugging.md):** Read `ChartPanel.tsx`'s diff directly (not
files-modified.md's narrative alone). Independently confirmed the causal claim against `ThemeProvider.tsx`:
`ThemeProvider` is an ANCESTOR of `ChartPanel`, and its own `useEffect` (the one that flips
`document.documentElement.dataset.theme` / calls `applyAccentTokens`) is a genuinely separate effect from
anything `ChartPanel` can key on directly. Per React's own effect-ordering contract, passive effects fire
child-before-parent within one commit — so a plain same-commit `useEffect` in `ChartPanel` keyed on
`[theme, accentColor]` unavoidably runs BEFORE `ThemeProvider`'s DOM-mutating effect, which is exactly why
task 3.2's original (evaluator-passed) fix attempt was insufficient. This is real, verifiable causal
reasoning about a concrete code structure, not a plausible-sounding story bolted onto a delay.

files-modified.md's "Cycle 2" section documents an actual probe (not just narrated): a minimal RTL harness
comparing `document.documentElement` reads at three points (render-time, same-commit child-effect, and
rAF-deferred) across a toggle, with all three readings pasted — render-time and child-effect readings both
show the STALE attribute, only the rAF-deferred reading shows the corrected one. That is a probe result
distinguishing hypotheses, not an assertion. `themeSyncTick`'s `requestAnimationFrame` fires after paint —
i.e. after every effect of the triggering commit (ancestor and descendant) has run — so the mechanism the
probe demonstrates is exactly the mechanism the fix relies on. I judge this a genuine root-cause fix, not a
papered-over delay.

**3. New regression tests — reproduced red-before-green myself (not trusted from the commit message):**
Checked out `git show b287f11b:.../ChartPanel.tsx` (the pre-fix version) into the working tree while
keeping the new `ChartPanel.test.tsx`, and re-ran the suite:
```
FAIL src/features/panels/ui/ChartPanel.test.tsx
  ● ...re-resolves the RENDERED tooltip background to the new theme after a light/dark toggle...
    Expected: "LIGHT_SURFACE"   Received: "DARK_SURFACE"
  ● ...re-resolves the RENDERED hover-emphasis color when accentColor changes alone...
    Expected: "ACCENT_STRONG(#123456)"   Received: "ACCENT_STRONG(#f97316)"
Tests: 2 failed, 52 passed, 54 total
```
Restored the fixed `ChartPanel.tsx` (byte-identical to HEAD, confirmed via `git diff` showing no changes)
and re-ran: `Tests: 54 passed, 54 total`. Both new tests genuinely exercise the fixed path — they mock
`resolveChartTheme()`'s return value from the REAL `data-theme` attribute / `--app-accent` inline style
`ThemeProvider` actually mutates, and assert the RENDERED option (not a call count) — this is a real
upgrade over the CR2-flagged call-count-only spy.

**4. Independent live reproduction (the one thing round 1 caught and the evaluator missed) — done myself,
never trusting the executor's claim:** Built a fresh pipeline/output/dashboard/panel from scratch via the
running app (dataset source → pipeline → chart-kind Output with `fieldMapping` → panel with
`appearance.chart.tooltip.enabled=true`, `chartType: bar`), ran the pipeline, and drove the real dev
server at DEV_PORT 5998 / BACKEND_PORT 8905 (`assert-phase.sh servers` → `PASS servers`).
- Dark theme (default), hovered bar B: tooltip's real computed style —
  `backgroundColor: rgb(38, 35, 32)`, `borderColor: rgba(242, 239, 233, 0.09)` — matches dark
  `--app-surface-strong`/`--app-border-subtle`. Screenshot:
  `.concertino/runs/HEL-566/evidence/.concertino-skeptic-evidence/hel566-02-hover-dark.png`.
- Toggled to light via the command palette (`Ctrl+K` → "Switch to light theme") — **never navigated away**
  (same page, `data-theme` confirmed flipped to `light` via `getAttribute`). Re-hovered the SAME mounted
  panel (verified via `canvas === <captured reference>` identity check — `sameNode: true` — so this is not
  a remount masking the defect). Tooltip's real computed style now reads
  `backgroundColor: rgb(255, 255, 255)`, `borderColor: rgba(33, 29, 25, 0.11)`,
  `boxShadow: rgba(33, 29, 25, 0.08) 0px 4px 16px 0px, ...`, `borderRadius: 9px` — correctly re-themed to
  light. This is the EXACT scenario round 1 refuted (dark page, light-themed tooltip stayed dark); it is
  now correct. Screenshot:
  `.concertino/runs/HEL-566/evidence/.concertino-skeptic-evidence/hel566-03-hover-light.png`.
- Toggled back to dark (light→dark, the reverse direction) — again without navigating away — and re-hovered:
  `backgroundColor: rgb(38, 35, 32)` again, correctly reverted.
- Also checked inside `PanelFullscreenOverlay` (HEL-584): opened fullscreen on the same panel (confirmed
  two live `<canvas>` nodes — in-grid + overlay — per design), hovered bar B in dark theme: themed tooltip
  (`rgb(38,35,32)` background) AND the orange hover-emphasis border on the hovered bar, both correct.
  Screenshot: `.concertino/runs/HEL-566/evidence/.concertino-skeptic-evidence/hel566-06-fullscreen-hover-dark.png`.

I did not independently live-reproduce the accent-only (no theme change) live path beyond the red/green
unit-test reproduction in point 3 — flagging this so the CONFIRM below is honest about what was verified
live vs. at the unit level; the unit-level red/green reproduction plus the code review in point 2 (same
`themeSyncTick` mechanism, same dependency array) is what that conclusion rests on.

**5. Re-confirmed round 1's other checks still hold on this commit:**
- No ECharts event-handler wiring introduced: `grep -n "onEvents\|onClick\|addEventListener\|dispatchAction\|getEchartsInstance" ChartPanel.tsx` — no matches. HEL-572 (drill-down) remains unblocked.
- AC trace against `ticket.md`: themed tooltip w/ tokens+mono (unchanged from cycle 1, still passing),
  axis-trigger tooltip for multi-series (unchanged, still covered by existing `chartAppearance.test.ts`/
  `ChartPanel.test.tsx` tests), values honor existing formatting (unchanged), hover emphasis subtle +
  `prefers-reduced-motion` (unchanged), theme/accent re-resolve without remount (the fixed defect, verified
  live above), lint/test both green with zero new warnings (verified in point 1).
- DESIGN.md token compliance: `git diff $BASE_SHA...HEAD -- chartAppearance.ts ChartPanel.tsx | grep -nE
  "#[0-9a-fA-F]{3,6}|rgb\("` only matches inside the pre-existing, documented `FALLBACK_CHART_THEME`
  (SSR/Jest-only fallback, unreachable in a real browser render) — no new hardcoded values on the live path.
- Light/dark + accent parity, in-grid and fullscreen: confirmed visually in both themes above (screenshots).

### Evidence persistence note

The three screenshots cited above were captured under a worktree-relative scratch directory
(`.concertino-skeptic-evidence/`, moved there immediately from a stray repo-root landing — see
`project_concertino_parallel_playwright_hazard` — to avoid polluting the main checkout) and persisted via
`persist-evidence.sh` at capture time, before this report was written. The `rgb(...)`/`boxShadow` computed-
style values quoted above are self-authenticating (read directly from live DOM `getComputedStyle`, not
inferred from screenshot pixel color or file mtime ordering) — no mtime-based claim underlies this verdict.

### Verdict: CONFIRM

The stale-tooltip defect round 1 caught is genuinely fixed, with a probe-confirmed root cause (not a
timing hack bolted onto a plausible story), regression tests that provably fail without the fix and pass
with it, and my own independent live reproduction of the exact repro scenario in both toggle directions —
plus the fullscreen path. All gates are green fresh. Ships.

### Non-blocking notes

- The pre-existing gap noted in files-modified.md's Cycle 2 section — a panel placed via the "Add panel"
  picker doesn't get `appearance.chart` auto-populated — is real (I hit the same thing building my own
  test panel and worked around it with a direct `PATCH`, matching the executor's own workaround) but is
  correctly scoped out of this ticket (pre-existing, HEL-566-unrelated). Worth the follow-up ticket already
  flagged.
- `prefersReducedMotion()` now exists as a third near-identical private copy (`chartAppearance.ts`,
  `Toast.tsx`, `useIsNarrowerThan.ts`). Already flagged as an out-of-scope spinoff candidate in
  files-modified.md; agreed this is correctly deferred per CONTRIBUTING.md's refactor discipline.
