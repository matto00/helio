## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: e93bebc320d47ebcb2e5d7ad21070fc984400ce8 (branch bug/pie-chart-needle-slices/hel-1181; only the change dir is untracked, no code diff yet).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/pie-chart-needle-slices/hel-1181`.
- **Round-1 CR1 (theme flip the chart actually reads) is addressed** in design.md D3, tasks.md 1.1 and Standing Constraint C1:
  - (a) The test renders a `ThemeToggler` that calls `useTheme().toggleTheme`, inside `renderWithStore`'s own `ThemeProvider`. Confirmed: `frontend/src/test/renderWithStore.tsx:24,287` wraps the UI in `ThemeProvider`, and `ThemeProvider.tsx:110` exposes `toggleTheme`. D3 states correctly that PanelCard's `theme` prop only styles the card.
  - (b) The toggle runs inside `act`, then waits for the rAF recompute. This is the pattern at `ChartPanel.theme.test.tsx:129-150`, which uses `act` plus a 50ms wait.
  - (c) Before re-asserting the slices, the test must prove the flip reached the chart:
    - `data-theme` flipped. `ThemeProvider.tsx:74` sets `document.documentElement.dataset.theme`, so this is JS-observable.
    - AND a theme-dependent option value differs between the two reads.
    - D3 also anticipates that jsdom has no stylesheet, so CSS-derived tokens may be identical in both themes. In that case it requires mocking the chart-theme resolver per theme. The precedent exists: `ChartPanel.theme.test.tsx`'s `mockResolveChartThemeFromLiveDom` spies on `resolveChartTheme` and keys it on the live `data-theme` attribute. That keeps the precondition failable either way.
  - The test toggles back and asserts again.
- **Round-1 note (persist transcripts) is promoted and addressed:** D5 and task 1.3 now persist the mutation transcripts via `persist-evidence.sh` (C2).
- **Round-1 note (AC3 "aggregated pie with few rows") is addressed:** design.md Risks says this half rests on the empty production diff and that the PR will say so.
- **Fresh read of the rest:**
  - The seam (D1) and fixture (D2: 80 rows over 4 categories, with sums computed independently of `groupAndAggregate`) are unchanged and remain sound.
  - The mutations M1/M2 are unchanged and failable: the raw pie branch gives 80 slices against 4 expected (traced in round 1).
  - The control (D4) is named as pinning current behaviour.
  - No placeholders or TBDs. Tasks are consistent with the design. There is no scope beyond the restated ACs, and AC4's out-of-scope items are respected by the proposal's Non-goals.
  - Test-only, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

- D3's example "legend/text colour resolved via `resolveChartTextColor`" uses `themeTokens.text`, which comes from `resolveChartTheme`. If that value is identical across themes, the executor should go straight to the `resolveChartTheme` spy (the `ChartPanel.theme.test.tsx` pattern) rather than any weaker substitute. Whichever value is used, it must be shown to differ.
- If the spy is used, restore it (`mockRestore`) so it does not leak into the control case's expectations.
- Restated scope rests on a driver delegation, not an owner ruling. The PR should keep disclosing that, as the planner notes already say.
