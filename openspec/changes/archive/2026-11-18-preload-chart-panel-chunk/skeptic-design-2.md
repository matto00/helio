## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/frontend-code-splitting/spec.md (uncommitted, worktree
HEAD ecefad62a191e68d32fdf333acb695f296671f1e), against the worktree source, and against the HEL-1758 archive
(main checkout, openspec/changes/archive/2026-11-18-flake-sweep-two-ci-backend/).

### What I verified (with evidence)

**Round-1 CR1 (cover every metadata-resolution path): addressed.**
- D2 now lists three trigger sites: `fetchOutputMeta`'s success handler, `seedOutputMeta`, and
  `publicDashboardService.fetchPublicOutputMeta`. The first two share one `noteKind` helper, so the two
  `knownKinds.set` sites (`outputMetaCache.ts:58` and `:88`) cannot drift. Tasks 2.3/2.4 and 3.2 cover all three,
  with red-first unit tests for chart and for non-chart kinds. The spec requirement names the same three contexts.
  The round-1 "earliest point on every path" sentence is gone.
- **Completeness, checked against the tree.** I traced every path that renders a chart panel:
  - `ChartOutputPanel` is rendered only from `OutputPanelContent.tsx:168-170`. `OutputPanelContent` is rendered
    only from `PanelContent.tsx:226`.
  - `PanelContent` has four callers. `PanelCardBody.tsx:248` (desktop `PanelCard` and `MobilePanelStack`) passes
    `output` from its own `useOutputMeta` (line 101). `PanelFullscreenOverlay.tsx:218` and
    `PanelDetailModal.tsx:240` pass no `output`, so `OutputPanelContent` falls back to its own `useOutputMeta`.
    `PublicDashboardViewerPage.tsx:114/130` passes `panelData.output` from `usePublicPanelData.ts:88`, which is
    `fetchPublicOutputMeta`.
  - `useOutputMeta` reads only `getOutputMetaCached` and `fetchOutputMeta`. The cache is written only by
    `fetchOutputMeta` and `seedOutputMeta`. `seedOutputMeta`'s only production caller is `warmRestore.ts:54`.
    `usePanelRunRefresh` and `useDashboardMeta` also go through `fetchOutputMeta`.
  - Other Output-returning calls (`listOutputs`, `listAllOutputs`, `outputsSlice`, `fetchOutputs` in
    ProposalReviewPage) feed pickers and the pipeline editor, never a panel render. The other `ChartRenderer`
    users (`LiveOutputRender`, `HistoryChart`, `OutputPreviewPane`) are pipeline-editor and history surfaces,
    not chart panels. They pick up the shared loader through `ChartRenderer` unchanged.
  - Result: the three D2 sites are the complete set of points where a chart Output's kind becomes known on a
    path that renders a chart panel.
- The design's mount gating is still correct. `OutputPanelContent` gates on metadata
  (`if (isLoading || !output)`), and `PanelContent`'s Crossfade gates on the rows load. A metadata-time preload
  therefore overlaps the rows fetch.

**Round-1 CR2 (Impact / no-component-change reconciliation): addressed.**
- The public trigger goes in the service function (`publicDashboardService.ts:72`), not in the hook. The proposal's
  Impact lists `outputMetaCache.ts`, `publicDashboardService.ts`, `ChartRenderer.tsx`, the new loader and tests. It
  also says no panel-rendering component or hook changes, which is now true of the plan. The risks list names the
  same file set.
- No eslint import-boundary rule exists (`eslint.config.*` has no restricted-imports/boundaries rule). A
  state→ui import already exists in the tree (`panels/state/formSubmission.ts:11`). The D2 state/service→ui import
  is permitted and documented.

**D1 (one loader).** `ChartRenderer.tsx:19` is the only production `import("../ChartPanel")`. `test/settleChartMount.ts:28`
is a test helper. Memo-while-pending/fulfilled with clear-on-reject is coherent with React.lazy calling the factory
once: a pending preload hands lazy the same promise, and a rejected preload leaves lazy a fresh `import()`.
Real-browser retry after a failed import is stated as unit-proof-only (round-1 note 2 adopted).

**D4 (forcing).**
- Test (`e2e/hel1573-motion-grid-chart.spec.ts:114-115`): `page.goto("/dashboards")`, then
  `toBeVisible()` on `.chart-panel__canvas canvas`, with the default 5 s expect timeout. `playwright.config.ts` has
  no `expect.timeout` override.
- Literal 6 s forcing. The preload can start only after app boot, auth, the panel list and `GET /api/outputs/:id`.
  All of these are JS-initiated around `load`. So request + 6 s lands past load + 5 s, and red after the fix is the
  expected outcome. The plan records both runs as-is and escalates the AC wording to the owner if the after-run is
  red. It does not silently substitute the CI-shaped forcing. That is the correct handling of an AC that
  contradicts "the initial bundle does not grow".
- The CI-shaped forcing now must be calibrated to CI's measured shape. Its numbers and the expected arithmetic are
  written down before running, and a large chunk delay is forbidden (round-1 note 1 adopted).
- The design's CI figures match HEL-1758 evaluation-1.md:14/51 (window 874.40-879.40, rows 876.84, request 877.374,
  chain done ~878.26, canvas 1-2 s later). D3 re-measures the ticket's "~1.7 s" claim instead of trusting it.

**D5 (bundle).** The build has two inputs (`vite.config` `rolldownOptions.input`: `index.html`, `app.html`).
`/dashboards` → `PanelList` is a static route (`AppRoutes.tsx:23,119`). `PublicDashboardViewerPage` is also static
(`:21`). So all glue lands in an entry chunk, and literal byte equality is impossible. The plan covers this: raw
and gzip bytes for every entry and modulepreload chunk, a grep proving no echarts in any of them, and
escalation if "does not grow" is meant literally. Round-1 note 3 adopted.

**Spec delta vs plan.** This is an ADDED requirement, and its name does not collide with the existing four in
`openspec/specs/frontend-code-splitting/spec.md`. Each scenario maps to a task:
- rows-held chunk request → 3.3
- warm/public → 3.2
- non-chart → 3.2
- failed preload → 3.1
- echarts out of entry → 1.1/3.7
The existing "chart rendering is code-split" requirement is not contradicted.

**AC coverage.**
- forced red/green → 1.3, 1.4, 3.4
- 40/40 → 3.5
- bundle → 1.1, 3.7
- flake-list removal → Planner Notes, as a driver action. The list exists only as C11 in tasks.md, not in the repo.

No TODO/TBD. No timeout, sleep or retry changes. Frontend only.

### Verdict: CONFIRM

### Non-blocking notes

1. **What if both forcings are red after the fix?** D4 escalates on a literal red after the fix. For the CI-shaped
   forcing it says only "reported honestly". If the CI-shaped forcing is also red after the fix, no forcing is green
   after the fix. AC1 is then unmet, and the run must escalate rather than ship. That case is likely, not
   theoretical. In HEL-1758's trace the chunk chain finished at about 878.26, inside the 879.40 window. The miss came
   from the 1-2 s between the chunk and the canvas, which a preload does not touch. The ticket's own "chart code
   finishes 1-1.5 s after the wait" contradicts evaluation-1.md:14. The orchestrator should treat "CI-shaped forcing
   red after the fix" as an escalation trigger with the D3 timelines attached. It should not be read as a
   reportable footnote.
2. **40/40 is weak evidence on its own.** The test is not flaky locally, so 40/40 would likely pass on unfixed
   code too. The PR should say that the CI-shaped forcing, not 40/40, carries the proof.
3. **Spec wording.** "fetched for the signed-in app" could be read as covering `listAllOutputs`/`listOutputs`
   (pickers, pipeline editor), which the plan deliberately does not trigger on. Consider scoping the requirement to
   "an Output panel's metadata" so an evaluator does not read it as broader than D2. D2's heading ("every point the
   client learns an Output's kind") has the same overreach. Its body correctly scopes to the three panel-render
   sites.
4. Round-1 note 5 (raise the literal-6 s wording escalation early, in parallel with execution) still stands as an
   option for the orchestrator.
