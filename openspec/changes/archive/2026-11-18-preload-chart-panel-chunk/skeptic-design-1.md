## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/frontend-code-splitting/spec.md (uncommitted, HEAD
ecefad62a191e68d32fdf333acb695f296671f1e), against the worktree source and the HEL-1758 archive.

### What I verified (with evidence)

**Q1 / D2: chart mount timing and the trigger point**
- The chart component mounts only after the rows arrive. This part of the claim holds.
  - `PanelContent.tsx` wraps the body in `<Crossfade loading={props.isLoading === true && ...}>` with no
    `keepContentMounted`. `Crossfade.tsx` renders `children` only when `!loading || keepContentMounted`.
    `PanelCardBody.tsx:254` passes `isLoading` from `usePanelData`, which is the rows load.
  - `OutputPanelContent.tsx` also gates on metadata (`if (isLoading || !output) return skeleton`). So
    `ChartOutputPanel` → `ChartRenderer` → `lazy(import("../ChartPanel"))` (`ChartRenderer.tsx:19`, the only
    import of `ChartPanel` outside tests) runs only once BOTH metadata and rows have resolved. A preload when
    the metadata resolves therefore overlaps the rows fetch whenever the metadata arrives first.
- On the authenticated `/dashboards` path, `fetchOutputMeta` is the earliest point where kind is known. Panel
  placements carry no kind (grep for `outputKind` finds only pipeline-draft code). Every consumer there goes
  through it: `useOutputMeta` (PanelCardBody, OutputPanelContent own-fetch, modal/fullscreen),
  `useDashboardMeta`, `usePanelRunRefresh`.
- **D2's claim that this is "the earliest point the client learns chart-ness on every path that renders a
  chart Output panel" is false.** There are two live paths that resolve a chart Output's metadata without going
  through `fetchOutputMeta`'s success handler:
  1. **Warm restore (HEL-1575).** `warmRestore.ts:54` calls `seedOutputMeta`, which writes
     `knownKinds.set` and the cache entry directly (`outputMetaCache.ts:86-94`). It never runs the handler D2
     hooks. The same function seeds row windows only when `isWindowFresh(...)`, and skips any Output that has
     newer data. On a reload of a tab whose chart Output has run since capture, the metadata is seeded, the rows
     are fetched cold, and the chart still mounts only after the rows arrive. That is the exact serial gap this
     ticket closes, and the design leaves it open.
  2. **Public / shared viewer.** `PublicDashboardViewerPage.tsx:83` → `usePublicPanelData.ts:88` resolves the
     kind through `fetchPublicOutputMeta`, which bypasses `outputMetaCache` entirely. It runs in parallel with
     `fetchPublicPanelRows` (line 114), and then goes through the same `PanelContent` Crossfade gate. Public
     chart panels keep the late chart.
  The spec delta's requirement says "When the app resolves an Output's metadata and its kind is `chart`, the
  client SHALL begin loading". Both paths above resolve an Output's metadata, so the planned implementation
  would not satisfy the spec as written. The spec and the design contradict each other.

**Q2 / D4: forcing arithmetic**
- The test (`e2e/hel1573-motion-grid-chart.spec.ts:114-115`) runs `page.goto("/dashboards")` (resolves at
  `load`) and then `expect(...canvas).toBeVisible()` with the default 5 s. A data-triggered preload cannot
  request `ChartPanel.tsx` before the app has booted, then fetched auth, the dashboard/panel list and
  `GET /api/outputs/:id`. All of those are JS-initiated around `load`. So with a flat 6 s on the chunk response:
  canvas ≥ request + 6 s ≥ (load − δ) + 6 s, which is past load + 5 s for any δ < 1 s. Even a boot-time preload
  (a Non-goal) would not plausibly beat that. I agree: the literal forcing is expected red after ANY fix that
  keeps echarts out of the entry chunk. The two literal ACs pull against each other (green-after-6 s vs. no
  bundle growth). Recording the literal run as-is and escalating the wording is correct. It is not silently
  replaced.
- Is the CI-shaped forcing faithful? It is broadly faithful: it reproduces the CI signature (HEL-1758
  evaluation-1.md: window 874.40-879.40, rows 876.84, chunk request 877.37, echarts chain done 878.26, canvas
  1-2 s after that). One risk is the 2.5 s chunk delay. In CI the chunk chain took about 0.9 s, and the rest of
  the overrun was mount-to-canvas time, which the preload does not touch. A 2.5 s chunk delay makes the
  preload's benefit look larger than it would be in CI. See non-blocking note 1.

**Q3 / D5: entry-chunk bytes**
- `ChartRenderer` is reached by static imports from the non-lazy `/dashboards` route
  (`AppRoutes.tsx:119`, `<PanelList />`). Any trigger call and loader module therefore land in an entry chunk,
  so literal byte equality is impossible for any preload. The plan is sound: report the exact raw and gzip delta,
  grep for echarts absence, and escalate if "does not grow" is meant literally. The build has two inputs
  (`vite.config` `rolldownOptions.input`: `index.html`, `app.html`), and D5 says "entry chunk(s)", so both are
  covered (note 3).

**Q4 / D1: one specifier, one chunk, one request**
- Prod (Vite with rolldown, per `vite.config` `build.rolldownOptions`): one module dynamically imported from one
  call site gives one chunk. In dev, the browser module map is keyed by the resolved URL
  (`/src/features/panels/ui/ChartPanel.tsx`), so the module is fetched once. The same would hold even with two
  specifiers that resolve to the same URL. D1's single loader is still the right call for the shared
  memo/retry. Minor wording: the build uses rolldown, not Rollup.
- Retry after rejection: React.lazy caches its own factory promise. D1's memo clears on rejection so the lazy
  factory gets a fresh `import()`. Whether a browser re-fetches a module after a failed dynamic import depends
  on module-map failure caching, so the spec scenario "a failed preload ... still loads its chunk" can only be
  proven at unit level with a mocked import. See note 2.

**Other checks**
- AC coverage: forced red/green → 1.3/1.4/3.4. 40/40 → 3.5. Bundle → 1.1/3.7. Flake-list removal → Planner
  Notes, a driver-side action (the "no in-repo list" claim is consistent: the list exists only as C11 in
  tasks.md). No AC is left uncovered.
- No placeholders/TBDs. No timeout, sleep or retry changes planned (C12 honoured). Frontend only; no
  contract/schema delta needed.
- Existing `frontend-code-splitting` spec ("fallback while chunk loads", "echarts not in entry") is not
  contradicted by a preload.

### Verdict: REFUTE

### Change Requests

1. **D2 / spec: cover every metadata-resolution path, or narrow the claim and spec explicitly.** D2's rationale
   ("every path that renders a chart Output panel") is false, and the spec requirement as written is not met by
   the plan.
   - Either (preferred, cheap): fire the preload wherever the kind becomes known. That means `seedOutputMeta`
     (`outputMetaCache.ts:86-94`), ideally through one small helper that both `knownKinds.set` sites call, and
     the public meta path (`usePublicPanelData.ts:88`'s `.then`, or `fetchPublicOutputMeta` itself). Add the
     matching unit tests to 3.2 (seed with a chart kind → preload; public meta with a chart kind → preload;
     non-chart → none), and list the files in Impact.
   - Or: add the warm-restore and public paths to Non-goals with a reason, and reword the spec requirement so it
     applies only to the authenticated metadata fetch.
   The design must not keep the "every path" sentence either way.
2. **Proposal Impact / D2 "no component change": reconcile with CR1.** If the public path is covered at the hook
   or service level, update Impact and the "stays clear of the panel-rendering files" statement (and the
   concurrent-lane overlap list in 3.8) accordingly.

### Non-blocking notes

1. **CI-shaped forcing calibration (D4).** Write the arithmetic down before running, as D4 already requires, and
   calibrate the forcing to CI's measured shape: chunk chain about 0.9 s, about 1-1.5 s past the window
   unfixed, mount-to-canvas measured from D3. Do not pick a large chunk delay that makes "green after" a
   foregone conclusion. If, at CI-like numbers, the preload alone does not clear the window because
   mount-to-canvas dominates, report that honestly. That is the HEL-1758 evaluator's open lead (deferred ECharts
   init).
2. **Failed-preload scenario.** State in the test and the PR that the retry scenario is proven at unit level
   (mocked import). Real-browser retry after a failed dynamic import depends on module-map semantics, and this
   change does not alter that.
3. **D5 evidence.** Include the chunks `index.html`/`app.html` reference via `<link rel="modulepreload">` in
   the "initial bundle" byte table, not only the entry file, so "initial bundle does not grow" is measured
   over what the browser actually loads up front.
4. **Jest hygiene.** `fetchOutputMeta` is used by many suites. A fire-and-forget `import("../ChartPanel")` from
   it can resolve after a test's environment is torn down ("import after the Jest environment has been torn
   down"). Task 3.8's full jest run should be checked for that warning specifically, and the loader mocked in
   suites that do not need it.
5. **Escalate early.** The literal-6 s arithmetic is near-certain. Consider raising the AC-wording escalation
   with the design-time arithmetic now, in parallel with execution, rather than after task 3.4.
