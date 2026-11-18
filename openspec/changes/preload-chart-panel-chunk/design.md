## Context

See proposal.md (Why). Current code:

- `ChartRenderer.tsx:19` holds `lazy(() => import("../ChartPanel")...)`. `ChartRenderer` is statically imported by
  `ChartOutputPanel` and so ships in the entry chunk (the `/dashboards` route is not lazy, `AppRoutes.tsx`).
- A panel placement carries only `outputId`. Chart-ness is `output.kind === "chart"`, resolved by `GET /api/outputs/:id`
  through `outputMetaCache.fetchOutputMeta` (HEL-1392). Its success handler already records the kind
  (`knownKinds.set`, HEL-1744). Every consumer (`useOutputMeta`, `useDashboardMeta`, `usePanelRunRefresh`) goes through it.
- HEL-1758's CI trace (run 44244750573 e2e (2), evaluation-1.md): expect window 874.40-879.40 s, rows answered 876.84,
  `ChartPanel.tsx` requested 877.37, echarts chain done 878.26, canvas visible 1-2 s later in the video. The ticket's
  "~1.7 s" gap is not in that record (it shows ~0.5 s rows -> request). It is re-measured here (D3).

## Goals / Non-Goals

**Goals:** chart chunk download overlaps the rows fetch; one chunk request; echarts stays out of the entry chunk;
the forced-red / green / 40-of-40 record the ticket asks for; an honest entry-chunk byte delta.

**Non-Goals:** see proposal.md. No change to `OutputPanelContent.tsx`, `ChartOutputPanel.tsx`, `ChartPanel.tsx`,
`PanelContent.tsx`, `usePublicPanelData.ts` or any e2e timeout/wait.

## Decisions

### D1. One shared loader module

New `frontend/src/features/panels/ui/renderers/chartPanelModule.ts` exports `loadChartPanel()` (returns the
`import("../ChartPanel")` promise, memoised while pending or fulfilled; a rejection clears the memo so the next call
retries) and `preloadChartPanel()` (calls it, swallows the rejection). `ChartRenderer` builds its `lazy()` from
`loadChartPanel`. Same specifier in one module means Vite (rolldown) emits one chunk and the browser makes one request.
Alternative: a second `import("../ChartPanel")` at the trigger site. Rejected: two specifiers is easy to drift, and
the retry-on-failure behaviour would live in two places.

### D2. Trigger at every point an Output panel's kind becomes known

Three sites resolve an Output's metadata, and all three fire the preload when the kind is `chart`:

1. `outputMetaCache.fetchOutputMeta`'s success handler (the authenticated `/dashboards` path; `useOutputMeta`,
   `useDashboardMeta`, `usePanelRunRefresh` all go through it).
2. `outputMetaCache.seedOutputMeta` (HEL-1575 warm restore, `warmRestore.ts:54`). It writes `knownKinds` directly and
   never runs the handler in (1). A reload whose chart Output has run since capture seeds the metadata but fetches
   rows cold, so the same serial gap exists there.
3. `publicDashboardService.fetchPublicOutputMeta` (public / share-token viewer, `usePublicPanelData.ts:88`), which
   bypasses `outputMetaCache`. The trigger goes in the service function, not the hook, so no component or hook file
   changes.

Sites (1) and (2) share one private helper in `outputMetaCache` (`noteKind(outputId, kind)`) that does
`knownKinds.set` and the preload, so the two writes cannot drift. Site (3) calls `preloadChartPanel()` directly after
building its return value. The chart component mounts only after BOTH metadata and rows resolve (`PanelContent`'s
`Crossfade` gate on the rows load, `OutputPanelContent`'s gate on metadata), so a metadata-time preload overlaps the
rows fetch whenever metadata arrives first. Panel placements carry no kind, so nothing earlier is available.
`outputMetaCache` / the public service importing from `ui/renderers` is a state/service -> ui import; acceptable
because the loader holds no React and no state (documented in the module).
Alternatives: (a) a `useEffect` in `OutputPanelContent`/`PanelCardBody` -- after a render, and in files concurrent
lanes touch; (b) preload on every `/dashboards` visit -- loads echarts for chart-free dashboards (Non-goal).
If D3's measurement shows something earlier on the path already carrying kind, the executor reports it and stops for
a design revisit rather than changing a component file.

### D3. Measure first, before and after

Before any code change, on this run's ports (7192 / 10099, URL and port checked before trusting a probe), record one
timeline of the hel1573 chart test path: goto resolved (window start), `GET /api/outputs/:id` answered, rows
answered, `ChartPanel.tsx` requested, last chart module answered, `.chart-panel__canvas canvas` present. Repeat after
the fix. This re-measures the driver's "~1.7 s" claim and shows how much of the gap a preload can close, including
the post-chunk mount-to-canvas time that a preload does not touch (reported, not fixed).

### D4. Forcing: the literal 6 s delay, and a CI-shaped forcing

Arithmetic the executor must confirm with real runs: the expect window opens when `page.goto` resolves (`load`). No
JS-initiated request starts a full second before `load`, and with a flat 6 s delay applied to the `ChartPanel.tsx`
response from the moment it is requested, the canvas cannot appear before request + 6 s > window + 5 s. So the literal
forcing is expected to be red before AND after any data-triggered preload. Both runs are recorded as-is, never
tuned. The forcing that matches the CI signature (data arrives late in the window; the chunk is requested only after
the data) is: hold the chart Output's rows response until about 3 s after `load` and delay `ChartPanel.tsx` from its request
by a CI-like amount: CI's chunk chain took about 0.9 s and the unfixed run missed by about 1-1.5 s, so the delays are
calibrated to that shape from D3's local baseline (including the measured mount-to-canvas time), never a large chunk
delay that makes green-after a foregone conclusion. Numbers and the expected-red / expected-green arithmetic are written
down before running. If at CI-like numbers the preload alone does not clear the window because mount-to-canvas
dominates, that is reported honestly, not tuned away. Unfixed: rows + chunk in series, past 5 s, red. Fixed: chunk loads during the rows hold,
green. Driver clarification (ticket.md, the driver authored this AC): the CI-shaped forcing is the AC's
discriminating forcing; the literal 6 s run is recorded as-is before and after and the PR says plainly it cannot
discriminate. **If the CI-shaped forcing is red after the fix, that is an escalation trigger, not a footnote**: AC 1 is
then unmet. HEL-1758's trace shows the chunk chain finished inside the window and the canvas 1-2 s later, so
mount-to-canvas may dominate; D3's timelines decide and are attached to any escalation. 40/40 alone is weak evidence
(the test rarely fails locally on unfixed code); the PR says the CI-shaped forcing carries the proof.

### D5. Bundle evidence

`npm run build` on the base commit and on the fix, saving the full Vite output to scratch, plus raw and gzip bytes of
everything `index.html` and `app.html` load up front (entry scripts and every `<link rel="modulepreload">` chunk) and a grep proving no `echarts` code in any entry chunk (`build:analyze` report as backup). The
entry chunk changes only by the loader/trigger glue (expected well under 1 KB raw). Literal byte equality is not
possible for any preload code living in the entry. Driver clarification (ticket.md): echarts and the chart chunk
must stay out of the entry; small glue is acceptable; the exact raw and gzip delta is reported, and called out if it
exceeds about 1 KB gzip.

## Risks / Trade-offs

- [Preload for a chart Output that is never shown, e.g. off-screen or on another tab] -> the chunk is the one the user
  needs on that dashboard anyway; it is cached by the browser; no cost on chart-free dashboards.
- [Preload rejection surfaces as an unhandled rejection] -> `preloadChartPanel` catches; unit test pins it.
- [A rejected memo poisons the lazy renderer] -> the memo is cleared on rejection; unit test pins the retry.
- [A preload does not cover the mount-to-canvas time] -> measured in D3 and reported; out of scope here.
- [Concurrent lanes] -> diff limited to the loader, `ChartRenderer.tsx`, `outputMetaCache.ts`,
  `publicDashboardService.ts` and tests. None is a panel-rendering component.
- [Jest: a fire-and-forget `import()` from `fetchOutputMeta`/`seedOutputMeta` resolving after a suite's environment is
  torn down] -> suites that exercise those functions mock the loader module; the full jest run (3.8) is checked for
  the "import after the Jest environment has been torn down" warning specifically.
- [Failed-preload retry is proven at unit level only (mocked import)] -> stated in the test and the PR; real-browser
  retry after a failed dynamic import depends on module-map semantics this change does not alter.

## Planner Notes

- Self-approved: placing the loader beside `ChartRenderer`; the state -> ui import (D2).
- The "remove hel1573:104 from the flake-candidate list" AC refers to the driver's lane-brief list, not a repo file
  (repo-wide grep finds none). Reported in the PR and handback for the driver to act on.
- Standing run constraints (C1-C14 in tasks.md) bind every role.
