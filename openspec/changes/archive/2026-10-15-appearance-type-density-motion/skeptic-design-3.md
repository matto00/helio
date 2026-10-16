## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD f3dfcb110ab6d1b385c843374476a4ceb0bac0f2 (merge of origin/main 31263face). The round-3 artifact
revisions (design.md, proposal.md, tasks.md, ticket.md, specs/appearance-preferences/spec.md) are UNCOMMITTED
working-tree changes on top of that HEAD (`git status --short`); this review covers the working tree.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/appearance-type-density-motion/HEL-1572`.
- **Owner answer is real and faithfully transcribed.** `.concertino/runs/HEL-1572/events.jsonl` line 23,
  `escalation.answered`, `answer_source: human`, sub_answers:
  `["recommended (owner override of the grid gap: desktop default gutter is 12px for everyone per HEL-1576; Compact = 8px with row-height compensation + list row padding 8->4)", "whole-ui-mono", "recommended"]`.
  design.md D3/D4 + "Owner rulings", ticket.md "Owner rulings", tasks C5/C6/3.5/3.8 and spec "Type style"/"Density"
  requirements all carry the rulings (12/8 gutter with compensation, list rows 8→4, whole-UI Mono, Q3 names), not the
  old recommendations (18→12, headings-only). No residue of the old values found.
- **Compensation arithmetic.** `panelGridConfig.ts` has `containerPadding: [0, 0]`, so RGL top = `y·(rowHeight+margin)`
  and height = `h·rowHeight + (h−1)·margin = 64h − margin`. Comfortable 52+12 = 64, Compact 56+8 = 64 → tops identical;
  height +4px (h=5: 308 → 312) — matches D4 and HEL-1576 D7 ("5·52 + 4·12 = 308"). Derived formula
  `rowHeight + (GRID_GUTTER_PX − 8)` gives 62 for an 18px default (step 70) — also correct. Only consumers of
  `rowHeight`/`margin`: `DesktopPanelGrid.tsx:142-143`, `DesktopPanelGridSkeleton.tsx:52-53` (both named in D4);
  `useGridLayoutInteraction.ts` imports only `rglBreakpoints`/`itemsFromRglLayout`.
- **HEL-1576 ordering.** HEL-1576 worktree (82c96e790) has `GRID_GUTTER_PX = 12` and `margin: [GRID_GUTTER_PX, GRID_GUTTER_PX]`,
  rowHeight 52, plus a guard asserting `--space-3` == `GRID_GUTTER_PX` (its tasks 1.1). Its D10a forbids changing
  rowHeight, consistent with C5's rowHeight 52. If HEL-1572 lands first at 18, HEL-1576's merge conflicts on the
  constant/margin lines and HEL-1572's TS↔CSS guard fails until `--density-grid-gap` Comfortable is 12 — drift is
  mechanically caught. Plan is sound (see note on guard coverage).
- **Whole-UI Mono mechanism works with theme.css as declared.** `theme.css:14-26`: single `:root` block declares
  `--font-sans`, `--font-display`, `--font-heading: var(--font-sans)`, `--font-mono`, and `font-family: var(--font-sans)`.
  No other file redeclares `--font-sans`/`--font-heading` (grep). `:root[data-type-style="mono"]` out-specifies `:root`,
  and `var()` in custom properties is substituted at computed-value time on `:root` and inherited, so
  `--font-heading`, root `font-family`, and the 13 descendant `font-family: var(--font-sans)` sites all resolve to the
  mono stack. `theme.css:357-362` sets `font: inherit` on body/button/input/textarea/select, so form controls follow.
  No hardcoded family in non-landing CSS/TSX (only `font-family: inherit` and token uses); no `<iframe>`/`srcDoc`;
  `chartAppearance.ts:62-63` literal stacks are fallbacks only. `getComputedStyle(...).getPropertyValue("--font-sans")`
  returns the substituted mono string.
- **Surfaces that escape a LIVE switch (not found by a family grep):** ECharts canvas text. `resolveChartTheme()`
  reads `--font-sans` (`chartAppearance.ts:97`) into `textStyle.fontFamily` (`:215`) and `referenceMarksOption.ts:93`,
  but `useChartOption.ts:51-77` and `UsageChart.tsx:40-47` only recompute on `theme`/`accentColor`. A type-style
  change leaves chart legend/tooltip/title text in Schibsted until an unrelated re-render. Same for
  `prefersReducedMotion()` reads in `buildChartOption.ts:310`, `referenceMarksOption.ts:91` on a motion change.
- **Sans preview card collides with the Mono override.** D7 previews each card "via an inline `--font-heading`
  override on the card". The only sans token is `--font-sans`, which Mono rebinds to mono; a Sans card using
  `--font-heading: var(--font-sans)` previews mono while Mono is active — and a literal stack would violate DESIGN.md §3.
- **Mono risk checks.** The HEL-774 guards are jsdom CSS tests (`BottomNav.css.test.ts`, `BottomNav.test.tsx`), font-
  independent; HEL-866 (`e2e/state-surface-contrast-guard.spec.ts`) runs in the default type style. "These guards pass"
  says nothing about Mono. Task 3.8 asks for screenshots only; task 4.3 has no Mono measurement. The spec scenario
  "Mono keeps layouts intact" (tap targets ≥44px, labels unclipped at 375) therefore has no check that exercises it.
- **Merge of main did not invalidate earlier claims.** `git diff 1092fe007 HEAD` on theme/utils/grid: only HEL-1600
  test mocks and the motion-token-guard file count (135→141). `prefers-reduced-motion` files under `frontend/src`:
  the six D5 components + theme.css + landing (excluded) + `OnboardingChecklist.css` (comment only, pre-existing since
  HEL-1571). Script consumers unchanged (`prefersReducedMotion.ts` → chartAppearance, buildChartOption,
  referenceMarksOption, Toast). `panelGridConfig` on main still 18/52.

### Verdict: REFUTE

### Change Requests

1. **Sans-card preview under Mono (design.md D7 + D3).** Add a raw face token that Mono does not rebind (e.g.
   `--font-sans-face: "Schibsted Grotesk", …`, `--font-sans: var(--font-sans-face)`, Mono sets
   `--font-sans: var(--font-mono)`), and specify that the Sans + mono card previews with `--font-sans-face`. Add to
   task 4.2 a test asserting the Sans card's heading resolves to the sans face while `data-type-style="mono"` is set
   (and likewise Serif/Mono cards show their own face under every active style).
2. **Charts must re-resolve fonts (and motion) on a live switch (D3/D2; AC1 "no reload"; spec "Mono switches the
   whole UI … without a reload").** Name the ECharts recompute path in D3 and add a task: expose `typeStyle` (and
   `motion`) from `useTheme()` and add them to the cache-buster/rAF tick deps in `useChartOption.ts:51-77` and
   `UsageChart.tsx:40-47`, so `resolveChartTheme()` and `prefersReducedMotion()` re-read after the attribute is
   written. Add a test that switching type style recomputes the chart option with the mono family. State in 3.8 that
   the "hardcoded family" grep cannot detect cached token reads, and record this enumeration (grep `resolveChartTheme`,
   `getComputedStyle` reads of `--font-*`).
3. **Make the Mono checks actually exercise Mono (D3, C6, 3.8, 4.3).** Replace "HEL-774 / HEL-866 guards pass" as
   the Mono evidence with a Playwright check under `data-type-style="mono"`: at 375, every BottomNav/command-bar tap
   target's bounding box is ≥44×44 and each label has `scrollWidth <= clientWidth`; at 1280/820/768, the same
   no-overflow assertion on rail, ContextList rows, tabs, and overview-table headers. Specify how "tabular numbers and
   table columns stay aligned" is checked (e.g. numeric cells in one column share a right edge within 1px). Keep the
   existing guards as regression gates, not as the Mono proof.

### Non-blocking notes

- `app.html` loads JetBrains Mono at 400/500/600 only; under Mono the three `--weight-bold` (700) sites
  (`PanelDetailModal.css:107`, `OutputEditorSheet.css:51`, `UserMenu.css:38`) get synthesized bold. Load 700 or accept
  and note it.
- The HEL-1572 TS↔CSS sync guard (3.5) should cover both sets: Comfortable token == `GRID_GUTTER_PX` and Compact token
  == the compact constant, so neither side can drift.
- If HEL-1572 lands first, the interim Comfortable `--density-grid-gap: 18px` is a literal with no spacing token;
  call it out as transitional in the PR.
- Commit the round-3 artifact revisions before execution starts; they are uncommitted on f3dfcb110.
