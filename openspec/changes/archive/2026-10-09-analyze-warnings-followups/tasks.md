## Standing Constraints

- [C1] Warnings never feed validationError / costVerdict / stepConfigProblem / validateRawConfig / the HEL-1384 RunConfigGate; HEL-1235 guard specs and HEL-1279 auto-run specs stay green unmodified.
- [C2] Red-first: every new behavioural test is shown failing on the WHOLE pre-fix tree before the fix (capture the red run as evidence).
- [C3] Warning UI copy never says the pipeline/step "can't run"; warnings use warning tokens, never the error accent, and never mark the card errored.
- [C4] Local caps (HEL-1442): `nice -n 19` for heavy runs, `-J-Xmx3g` on sbt, check `free -g` before commits (< ~15 GB available: wait).

### Backend

## 1. Analyze warnings (backend)

- [x] 1.1 RED-FIRST `AnalyzeSchemaWarningsSpec` cases (C2, capture red on pre-fix tree): lookup key family mismatch (lane + source secondary), missing lookupKey on secondary, source-lookup rename.
- [x] 1.1b LABELLED GUARDS in the same spec (pass pre-fix; label "GUARD" in test names/comments): matching families, untrusted input, unresolved source secondary, source-lookup output stays type-untrusted downstream. Show the last one failable by the mutation "D2 implemented without the `viaLane` check" (record red, revert).
- [x] 1.2 Add `PipelineAnalyzeService.secondarySourceIdOf` (join + lookup source secondaries); keep `sourceDependencyOf` join-only and `analyzeNodes` unchanged (D2).
- [x] 1.3 `PipelineService.resolveSecondarySourceSchemas` loads ids via `secondarySourceIdOf`.
- [x] 1.4 `AnalyzeSchemaWarnings`: `secondaryOf` via `secondarySourceIdOf`; `Secondary.viaLane`; `typesPreserved("lookup")` trusts lane secondaries only (D2).
- [x] 1.5 `AnalyzeSchemaWarnings`: lookup key warnings — type mismatch (D1) and missing lookupKey (D1b); update scaladoc.
- [x] 1.6 Service-level failing-then-green case in `PipelineAnalyzeSchemaWarningsSpec`: a source-secondary lookup surfaces rename + key-mismatch warnings on full and concise analyze, and the pipeline stays `canRun` (C1 guard extension).
- [x] 1.7 Fix `PipelineAnalyzeSchemaWarningsSpec` header pointer (D5) and append the correction note to archived HEL-1235 `tasks.md` 1.3 (D5).

### Frontend

## 2. StepCard warning display (frontend)

- [x] 2.1 RED-FIRST StepCard / PipelineRiverView tests (C2) for the warned-step scenarios (indicator + count, collapsed indicator, message list, both error+warning); "no warnings" and "not errored" are LABELLED GUARDS (pass pre-fix).
- [x] 2.2 `getAnalyzeWarnings(stepId)` memoised callback in the pipeline detail hook/page; thread through `PipelineRiverView` → `RootColumn` → `LaneColumn` → `StepCard` (every StepCard call site).
- [x] 2.3 StepCard header warning indicator + warning region after header / before OutputsRail when expanded (D6), CSS via combined selector with the truncation banner, warning tokens only, no errored class (C3).
- [x] 2.4 Verify in the running app (dev 6846 / backend 9753, throwaway user, record + delete ids by exact id) in light and dark; screenshots to `.concertino/runs/HEL-1414/evidence/`.

### helio-mcp

## 3. Workspace context + tool wording (helio-mcp)

- [x] 3.1 RED-FIRST `context.test.ts` cases (C2): full and concise per-step `warnings`; LABELLED GUARDS: omitted when none, missing `warnings` on the response treated as none, concise `omittedDetailKinds` unchanged.
- [x] 3.2 `context.ts` + its types: attach warnings by step id (D3); update the `get_workspace_context` description.
- [x] 3.3 `analyze_pipeline` concise wording (D4) and lookup mention in both analyze tools' `join-key-type-mismatch` text (D1); update any test pinning the old text.

### Tests

## 4. Gates

- [x] 4.1 Backend: targeted specs, then `sbt testFull` (`-J-Xmx3g`, `nice -n 19`); HEL-1235 guard specs + HEL-1279 auto-run specs green unmodified (C1).
- [x] 4.2 Frontend: `npm run lint` (typescript-eslint recommended), `npm run typecheck`, `npm test`, `npm run format:check`.
- [x] 4.3 helio-mcp: its own test, typecheck and lint scripts.
- [x] 4.4 `openspec validate analyze-warnings-followups --type change`.
