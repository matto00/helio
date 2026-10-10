## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 365d824c8f2eba017e150e9b5f67743920f56619 (branch feature/analyze-warnings-followups/HEL-1414; change dir untracked, no source edits). Spawn-cwd guard: READY.

### What I verified (with evidence)

**Round-1 CR1 (D1 vs D1b contradiction): resolved.**
- D1 now ends "(The missing-`lookupKey` case is D1b.)".
- D1b states that the `missingMessage` `key '...'` condition is widened from `secondary && op == "join"` to join-or-lookup.
- Confirmed against the tree: AnalyzeSchemaWarnings.scala `missingMessage` has `if (secondary && op == "join")`, so the widening is a real, necessary edit.
- Task 1.5 covers D1 and D1b together, and the spec ADDED requirement "Lookup key missing from the secondary input warns" matches.

**Round-1 CR2 (red-first vs guards): resolved.**
- Task 1.1 (red-first) holds only cases that fail on the pre-fix tree. No lookup key check exists today (`compute` only calls `joinWarnings` for `join`). A source-secondary lookup has `sec = None` today because `sourceDependencyOf` is join-only (PipelineAnalyzeService.scala:215-219), so `lookupRenames` returns nothing.
- Task 1.1b labels the pass-pre-fix cases as GUARDS and names the failability mutation: "D2 implemented without the `viaLane` check".
- I checked that mutation is real. Without `viaLane`, `typesPreserved("lookup")` = `sec.exists(s => s.flags.types && lookupColumnsResolved(...))` becomes true for a source `Secondary` with `Flags(true,true)`. The downstream join then compares the `"string"` placeholder as trusted and warns, so the guard turns red.
- Tasks 2.1 and 3.1 are split the same way.

**Round-1 CR3 (D6 placement): resolved.**
- D6 now pins the region as: rendered only when `expanded`, as a sibling after the header row and before `<OutputsRail>`, outside `step-card-body`. The `validationError` `InlineError` stays inside the body.
- Tree: StepCard.tsx renders `<OutputsRail>` at :363 (always visible), `{expanded && <div className="...step-card-body">}` at :370-371, and the `InlineError` at :394.
- I viewed `.concertino/runs/HEL-1414/evidence/mockups/optionA-light.png`. The warning block sits between the header and the "+ Output" rail, and the header shows a warning triangle with count "2". The pinned placement matches the ruled mockup.
- The header indicator sits "beside where the error chip sits". That is inside the toggle button at StepCard.tsx:264-272 (`role="img"` + `aria-label`), so the a11y precedent exists.

**Round-1 CR4 (concise-mode contract): resolved via option (b).**
- D3 keeps warnings in full in concise mode, so `CONCISE_OMITTED_DETAIL_KINDS` (context.ts:276) and `mcp-concise-response-modes` are untouched.
- The spec ADDED scenario asserts that `omittedDetailKinds` is unchanged, and task 3.1 holds it as a guard.

**Fresh checks on the whole design**
- **D3 join key is real.** `analyzed.steps[]` carries `id` (helio-mcp/src/types.ts:635-643), and the context map at context.ts:534-545 has `step` in scope, so grouping by `stepId` is implementable.
- **D3 drops no warnings.** Full analyze's response `steps` covers every enabled step (PipelineService.scala ~:1012-1016), and warnings are emitted only for enabled steps, so every warning has a matching step entry.
- **D2 leaves projections unchanged.** Widening `resolveSecondarySourceSchemas` (PipelineService.scala:1102-1109; call sites :363, :974, :1130, :1348, :1446) only adds map entries. `analyzeNodes` (:269) still resolves via the join-only `sourceDependencyOf`, so those entries are never read for a lookup.
- **No new cross-tenant read.** Lookup source secondaries are cross-owner checked at write time via `PipelineStepConfigCodec.secondaryDataSourceId` (covers `LookupConfig`, PipelineStepConfigCodec.scala:114-118; enforced at PipelineService.scala:456, :1883, :2232). The proposal path keeps `findByIdOwned`. Persisted paths use the same `findByIdInternal` + pipeline-ACL model join already uses.
- **D1 runtime basis holds.** LookupStep.scala:98-100 indexes `refRows.groupBy(_.getOrElse(lookupKey, null))` and probes it with the raw `sourceKey` value, the same `Map[Any,_]` equality `family()` models.
- **Spec deltas keep existing scenarios.** The MODIFIED deltas retain every existing scenario of "Join key type mismatch warns", "Join column rename warns" and "MCP analyze tools expose warnings" (compared against openspec/specs/pipeline-analyze-schema-warnings/spec.md). `openspec validate analyze-warnings-followups --type change` prints "Change 'analyze-warnings-followups' is valid".
- **C1 / never-blocks.** No new path from `AnalyzeSchemaWarnings` into validationError, costVerdict, stepConfigProblem, validateRawConfig or RunConfigGate. Task 1.6 extends the canRun guard, and task 4.1 requires the HEL-1235 and HEL-1279 guard specs to stay green unmodified.
- **Owner ruling.** `escalation.answered` with answer `optionA` and `answer_source: human` is recorded at `.concertino/runs/HEL-1414/events.jsonl` line 8.
- **Frontend prop chain.** `getAnalyzeValidationError` is threaded at PipelineRiverView.tsx:378/441/519, RootColumn.tsx:131 and LaneColumn.tsx:166/223/275. Task 2.2 says "every StepCard call site", which covers all three `<StepCard` usages (PipelineRiverView:367, LaneColumn:212, :264).
- **CSS recipe exists.** The `.pipeline-detail-page__truncation-banner` recipe (PipelineDetailPage.css:1913-1923) uses `--app-warning-surface`, `--app-warning` and `color-mix(... 35%)`, as D6 cites.

### Verdict: CONFIRM

### Non-blocking notes
- **Spec wording.** The `pipeline-step-warning-display` scenario "Warned step shows indicator and messages" says "S's body lists both messages". The requirement text and D6 pin the region outside `step-card-body`. At final gate, judge placement against D6 and the mockup, not the word "body".
- **Banner margin.** The truncation banner's `margin: var(--space-3) 0` will not give the horizontal inset the mockup shows inside a card. Expect a card-local override next to the combined selector. Check this in both themes at final gate.
- **Scope beyond ACs.** D1b (missing `lookupKey` warning) goes beyond the ticket's ACs (absorbed on a driver ruling). Final gate should check it as such.
- **D2 risk is real.** Mismatches downstream of a source-secondary lookup stay unreported, by design.
