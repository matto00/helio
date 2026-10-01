## Context

HEL-1209 added `FirstRunDashboardService` (rule planner -> `PipelineProposalService.apply` (runs the pipeline) -> `DashboardProposalService.apply`, rolling the pipeline back on dashboard failure). `DataSourceService.createCsv` creates a user-owned CSV source from bytes. `DemoData.seedIfEmpty` seeds a system-user-owned source/pipeline/outputs/dashboard at boot, setting output schemas directly with no pipeline run.

## Goals / Non-Goals

**Goals:** four persona templates through the one existing apply path; real materialized, typed data; per-user ownership; CI-validated datasets; telemetry proven live.
**Non-Goals:** gallery, shared/user-authored/import templates (HEL-421); fixing HEL-1222 globally.

## Decisions

1. **One apply path.** Extend `FirstRunDashboardService` so its apply step takes a plan (`PipelineProposal` + a function from created outputs to `DashboardProposal`); `build` supplies the rule planner's plan, a new `buildTemplate` supplies the template's. No third apply path, no `CombinedProposalService`.
2. **Code-level registry.** `PersonaTemplates` (Scala objects): slug, display name, resource path, source name ("Sample: Streamer stats" etc.), explicit pipeline (cast step for numeric/date columns + shape/step chains), explicit outputs (kind, chartType, fieldMapping, column order), explicit lg layout. md/sm/xs are derived by `LayoutBreakpointScaling` (x=0 full width stacks); verify at phone width.
3. **Data.** Synthetic, authored in-repo CSVs under `backend/src/main/resources/templates/<slug>.csv` (classpath, works in prod), a `templates/README.md` noting provenance (synthetic, no third-party data). Small (<= ~50KB, 60-200 rows), within HEL-1221 limits.
4. **Instantiation.** Endpoint reads the resource, calls `DataSourceService.createCsv` as the user, then the shared apply path; on any failure after source creation the created source is deleted too (no residue). Not tier-gated; no Claude client in the constructor.
5. **Types.** CSV columns are strings; each template's pipeline casts numeric (and date, if a cast type exists; else uses shapes that accept date strings) columns so charts render. Verified by materialized output schemas in tests.
6. **Telemetry.** Frontend `track("firstrun_template_chosen", {template: slug})`; `RolledUpTemplateSlugs` = the four slugs; the wire-contract fixture `client-wire-batch.json` and `track.wireContract.test.ts` gain a template-event variant that fails if it drifts. Live proof: row lands in `product_events` with the right property and the rollup buckets it under its slug.
7. **DemoData: retired.** Its data is owned by a system user that no real user can see (ownership/RLS), so it is dead weight in prod and a second seed system. Remove `DemoData.seedIfEmpty` and its Main call. Executor must first check which tests depend on seeded rows; if removal is non-trivial, fall back to keeping it dev-only (disabled in prod via explicit config) and STATE that in the PR, never silently leaving both.
8. **Frontend.** Chips live in `FirstRunDropZone` (or a sibling `FirstRunTemplateChips` component) using a `useFirstRunTemplate` hook mirroring `useFirstRunBuild`'s navigate/refresh/dismiss behavior. DESIGN.md tokens; verified in both themes at desktop and phone.

## Risks / Trade-offs

- [Builder drift between rule and template paths] -> shared apply function; tests for both.
- [Slow instantiation (pipeline run)] -> measure chip-click to rendered dashboard and record it in the PR.
- [DemoData removal breaks tests] -> see Decision 7 fallback.
- [Sample-source residue on failure] -> explicit cleanup, tested.
