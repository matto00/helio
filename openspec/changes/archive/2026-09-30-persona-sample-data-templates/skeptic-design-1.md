## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (against the live tree, not the narrative)
- FirstRunDashboardService reuse: it applies via `pipelineProposalService.apply` then `FirstRunPlanner.dashboardProposal(...)` inside private `applyBoth`, with rollback of the pipeline only. A plan-taking refactor (Decision 1) is feasible: the planner call is the only rule-specific step. Source is never deleted by this rollback, so the plan's extra source cleanup (Decision 4) is genuinely new work and is correctly listed.
- `DataSourceService.createCsv(name, bytes, overrides, user, tag)` exists and creates a user-owned source; `delete(sourceId, user)` exists for cleanup.
- DemoData: only caller is `Main.scala:187`. Grep of backend/src/test finds NO test referencing DemoData/seedIfEmpty (only a pg_dump fixture mentions SystemUserId). Retirement is trivially safe, so the fallback in Decision 7 will almost certainly not trigger. `DashboardRepository.count()` becomes dead after removal.
- RolledUpTemplateSlugs: `ProductEventRegistry.scala:71` is `Set.empty`, consumed in `ProductEventRepository.scala:113/126` via `string_to_array($slugs, ',')` -> populating it works with no SQL change. `FirstrunTemplateChosen` already has Slug regex `^[a-z0-9-]{1,40}$` which all four slugs satisfy.
- CastStep: `domain/steps/CastStep.scala` supports `integer`, `date` (string passthrough), etc. Decision 5's "date if a cast type exists" hedge resolves to: yes, `date` exists (passthrough). FirstRunPlanner casts numerics to `double`.
- Layout: `LayoutBreakpointScaling` cols lg12/md10/sm6/xs2; `FirstRunPlanner` stacks full-width x=0 panels. Claim "x=0 full width stacks" is true ONLY for full-width items.
- Telemetry fixture: `backend/src/test/resources/telemetry/client-wire-batch.json` and `track.wireContract.test.ts` exist and are consumed by `ProductEventRegistrySpec`.
- ACs mapped: chips/<=5 interactions/both themes/phone (4.1, 4.2, 5.1); ownership tested (2.2); CI dataset validation (1.1); slugs + live telemetry + fixture (3.1, 3.2, 5.1); DemoData fate stated (Decision 7); out-of-scope respected. No migration planned (V114 untouched).

### Verdict: CONFIRM

### Non-blocking notes (executor should fold these in)
1. The fixture ALREADY contains a `firstrun_template_chosen` variant with `template: "sales-overview"` (not a real slug). Task 3.2 says "gain a template-event variant"; correct action is to change it to a real slug (e.g. `streamer`) and have the seam test/Spec assert that slug, and mutation-test that drift fails. Don't leave `sales-overview` implying a valid rollup slug.
2. Phone layout: scaling of a half-width lg item (e.g. x=6,w=6) yields xs x=1,w=1 side-by-side in a 2-col grid, NOT stacked, with y carried over. If any template uses side-by-side lg panels, phone shows two ~half-width panels (no overlap, but likely cramped). Prefer full-width lg panels or distinct y rows for chart/table kinds, and confirm visually at phone width (standing constraint). The "stack" spec scenario should be read as "no overlap".
3. DemoData retirement should also update `CLAUDE.md:99` and `backend/README.md` "Note on DemoData and SystemUser ownership" (stale after removal), remove the now-dead `DashboardRepository.count()` if no other caller, and note it in the PR.
4. Specify in tests that cleanup on pipeline-apply failure (not just dashboard failure) deletes the source; Decision 4 says so, tasks 2.1 only names "cleanup of source on failure".
5. Explicit HEL-1222 workaround: ensure each template's output schema types come from the cast step (Decision 5 + 2.3 cover this).
