## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD b2603ab7998f3e9b4bdca5089a18f89da16fdc8b (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn cwd**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/shared-dashboard-freshness-refresh-invalid/HEL-1786`.
- **Round-1 CR1 (trigger keyed on committed data): resolved in D1/D3/D5/spec.**
  - `PipelineRunSucceededWrites.scala:126-150`: when `outputHistoryRepo != null`, the per-Output `OutputHistoryInsert` entries (`capturedAt = now`, `now = Instant.now()` at :84) are passed as `historyAction` to `nodeSnapshotRepo.overwriteRowsWith(...)`.
  - `NodeSnapshotRepository.scala:122-130`: `overwriteRowsWith` runs `overwriteRowsAction(...).andThen(andThen)` inside ONE `ctx.withSystemContext`, which is one transaction. When `captured_at` advances, the new rows are therefore committed.
  - `outputHistoryRepo` is wired in production (`Main.scala:153,277`; `ApiRoutes.scala:552`).
  - Entries are built for every Output on a materialized node, whatever its kind. That supports the executor's "every kind a grantee panel can show" check.
  - The shape matches `DashboardChangesRepository.scala:31-38`, the LATERAL `LIMIT 1` on `captured_at DESC`.
  - D3 now triggers only on `dataUpdatedAt`. The baseline rule and the null-to-value rule are stated. D5 has the "advance `last_run_at` with no history point" case, m8 is added, and the spec has a "Refresh signal follows committed data" scenario.
- **Round-1 CR2 (sources restricted to what provenance shows): the restriction is resolved.**
  - `ProvenanceService.forOutput` (`ProvenanceService.scala:56-88`) derives sources from closure-feeding roots plus join/union/lookup secondaries only.
  - `ProvenanceResponses.public` (`ProvenanceProtocol.scala:49-56`) emits exactly those names.
  - D5 has the two-root case and m9.
  - `provenanceServiceOpt` is an `Option` (`ApiRoutes.scala:589-592`), so the `None -> []` clause matches the tree.
  - The cost of HOW it is reused is a new problem; see CR2 below.
- **Non-blocking notes from round 1, all addressed:**
  - Page bound: `Page.MaxLimit = 500` is confirmed (`AutoLayoutService.scala:95`), and `AskAccess.scala:47` uses the same `findAllByDashboardId(..., Page(0, Page.MaxLimit), accessAlreadyGranted = true)` call.
  - The invalid-flicker risk is now stated in Risks.
  - The phone "Refresh dashboard" click is inside the zero-request window (D6).
  - m4 is split into m4a and m4b.
- **Invalid rule**: `OutputService.scala:333-350` (`listByPipelineInternal`, first `status != "dry_run"`, count of error-severity failed assertions on the own step) matches the D1 restatement.
- **Badge sites**: the tree has `PanelCard.tsx`, `useDataInvalid.ts`, `ProvenanceTrigger.tsx` and `PanelProvenance.tsx`. D4 tells the executor to grep and list every site, which covers `ProvenanceTrigger.tsx`.
- **Refresh handler**: `PanelCardBody.tsx:191-195`. `handleFanoutRefresh` = `refresh()` plus an announcement counter, and the owner hook is still gated on `scope.kind === "output"`. D4's plan to add a parallel panel-scope hook fits this shape.
- **AC coverage, re-checked across the whole design**:
  - Grantee-safe route per dashboard: D1, task 2.2.
  - Stranger 404 and NOBYPASSRLS proof: D5, task 2.3.
  - No ids or error text: allow-list, schema `additionalProperties: false`, m1.
  - e2e for viewer and editor with no Output/pipeline requests: D6, task 4.1.
  - Red first: tasks 1.x and mutations.
  - No TODO/TBD placeholders found.

### Verdict: REFUTE

### Change Requests

1. **Stale `lastRunAt` trigger text contradicts the revised D3 (internal contradiction; an implementer could build the trigger round 1 rejected).** D3 and the spec now say `lastRunAt`/`runStatus` never trigger a refresh. Three passages still describe the old trigger:
   - design.md D6, jest store list: "`lastRunAt` advance + succeeded fires, advance + failed does not". Read literally, this asks for a jest case asserting that a `lastRunAt` advance with `succeeded` FIRES. That is the CR1 bug, and it conflicts with m4b and m8.
   - proposal.md "What Changes": "refreshes a panel's rows ... when its last run time advances with status `succeeded`".
   - design.md Risks: "[`lastRunAt` advances on a failed run too] -> ... never refresh rows, matching the owner path (refresh on `succeeded` only)". This still frames the trigger as `lastRunAt` + succeeded.

   Rewrite all three in terms of `dataUpdatedAt`. Replace the D6 jest cases with:
   - `dataUpdatedAt` advance fires;
   - `null` -> value fires;
   - `lastRunAt` advance with `succeeded` and unchanged `dataUpdatedAt` does NOT fire (this is the jest-level guard of the CR1 race);
   - `failed` with no `dataUpdatedAt` change does not fire;
   - a newly appearing panel is baseline.

2. **`sources` via `ProvenanceService.forOutput` once per distinct Output on every 15 s poll contradicts D1's own per-pipeline read rule and the Risks load claim (performance by default).** `forOutput` (`ProvenanceService.scala:56-75`) does seven reads per Output. Among them are `runRepo.latestNonDryRunInternal(pipelineId)` (once per Output, not once per pipeline), `assertionsFor`, and `nodeSnapshotRepo.countRows`. `countRows` is an unbounded `SELECT count(*) FROM node_snapshots` over that node's rows (`NodeSnapshotRepository.scala:401-406`). The route would discard every one of these results except `sources`, and it would repeat them per open grantee tab every 15 s. That contradicts:
   - D1, `invalid`: "Latest non-dry run per pipeline is read once per pipeline per request, not once per panel";
   - Risks: "each a handful of indexed reads per distinct pipeline".

   Revise D1 so the reuse is of the source-resolution logic, not the whole chain. Factor `closureFor`/`feedingRootIds`/`secondarySourceIds`/name lookup into one `ProvenanceService` method (e.g. `sourcesFor(output)`, or a batched form over the dashboard's Outputs). Have `forOutput` itself call it, so there is still exactly one derivation and m9 still bites. The new route calls only that method, with steps and roots read once per pipeline per request. Then state the per-request query bound in Risks (as a function of distinct pipelines and Outputs), and say explicitly that no `count(*)` over `node_snapshots` runs on the poll path. If the executor keeps the full `forOutput` instead, the design must justify it with a measured cost and correct both contradicted sentences.

### Non-blocking notes

- `updateSchemaInternal` (the Output's inferred schema) is written AFTER the snapshot+history transaction (`PipelineRunSucceededWrites.scala:151-160`). A grantee refresh that fires in that window gets the new rows with the previous schema. Under the HEL-1705 ordering, a newly added column then appears in code-point order rather than schema order until the next refresh. This is cosmetic and rare; one sentence in Risks would keep the e2e from misreading it.
- In spec.md, the "Viewer and editor read panel status" scenario's THEN clause omits the stored-data capture time (`dataUpdatedAt`) the requirement text lists. Add it for completeness.
- When `invalid` is computed per pipeline once, prefer the existing `listByPipelineInternal` + `find(_.status != "dry_run")` path that the Output route uses, or prove `latestNonDryRunInternal` selects the same row (including in-flight `running` runs). That keeps "the Output route keeps its exact behaviour" true under one shared function.
