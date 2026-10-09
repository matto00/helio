## Standing Constraints

- [C1] Guard tests prove failability by mutating the SOURCE (editor option constant / offset check / backend rule), never the test's expected values; red-first tests are shown failing before the implementation lands.

## 1. Backend

### Backend

- [x] 1.1 `FillNullStep`: add public `strategyProblem(cfg)` (non-empty unknown strategy only); override `validateRawConfig` as `super.orElse(Try(decode).toOption.flatMap(strategyProblem))`; `apply` uses it
- [x] 1.2 `WindowStep`: add public `enumProblems(cfg)` (non-empty unknown function; lag/lead explicit offset <= 0); override `validateRawConfig`; `apply` uses it
- [x] 1.3 `PivotStep`: add public `aggProblem(cfg)` (non-empty unknown agg); override `validateRawConfig`; `apply` uses it
- [x] 1.4 `PipelineAnalyzeService.validateFillNull/validateWindow/validatePivot`: call the shared functions; keep empty-value draft reporting with unchanged message
- [x] 1.5 Update scaladoc on the three companions (HEL-1416 rule, drafts accepted, offset only lag/lead)

## 2. Frontend

### Frontend

- [x] 2.1 `useStepCardState`: pass `captureErrors = true` for fillnull/window/pivot config changes
- [x] 2.1a Make the `persist` error fallback neutral or per-call-site (current text is upsertsource-specific, `useStepCardState.ts:303-306`) and update the `persist` doc comment (:259-264)
- [x] 2.2 Render `saveError` for the three editors via the existing `InlineError` element used at `UpsertSourceConfig.tsx:192` (no new styling)

## 3. Tests

### Tests

- [x] 3.1 Step specs (red-first): each companion's `validateRawConfig` rejects each invalid case, accepts each draft case and row_number+offset 0
- [x] 3.2 Analyze spec: each invalid value reported exactly once; drafts still reported; legacy stored invalid step lists + analyzes
- [x] 3.3 Route specs (red-first): 422 on REST step create and update (stored config unchanged) for each kind; draft create 201
- [x] 3.4 Single-call create, proposal apply, patch-set step-update and pipeline-create edits: 422/rejection for one invalid case per kind
- [x] 3.5 `CreateStepConfigNonRegressionSpec` stays green (helio-news + shape/first-run pins)
- [x] 3.6 Frontend (red-first): each of the three editors shows the server's 422 message on a rejected save
- [x] 3.7 Frontend guards (mutation-shown failable): dropdowns offer exactly the backend's supported sets; offset input never emits <= 0
- [x] 3.8 Run `sbt testFull` (or targeted testOnly + full before commit), `npm test`, lint, typecheck
