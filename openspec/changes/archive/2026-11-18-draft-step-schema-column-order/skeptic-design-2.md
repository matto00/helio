## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD e83f216b0a6b84da100e465517d210c13da52ab5. The planning artifacts are untracked.

### Round 1 change requests: were they addressed?

1. **Server `step`-line `schema` dropped: addressed.** D1 no longer uses it. Context and proposal record the hash-order fact (`Map[String, Any]`, more than 4 entries means a `HashMap`). The Non-Goals list server-side ordering as a follow-up.
2. **Draft projection as the primary order, request shared: addressed in intent.** D1 sets the precedence: current projection, then the last settled projection, then saved analyze, then `[]`. It reuses `buildAnalyzeProposalRequest` and `schemaAtNode`, and the rejected-alternative paragraph has been rewritten. The way the request is shared (D2) is unsound as specified. See CR1 and CR2 below.
3. **RED test with the realistic shape: addressed.** D4 (a)-(e) uses 6 columns with row keys out of order, a rename, a descendant step and a draft-added step, with mocks shaped like the real server responses.
4. **Running-app check on a server-resolved step: addressed.** Tasks 1.1 and 6.2 both cover it.
5. **Spec delta: addressed.** The requirement now states the projection rule, and the "server-resolved step" scenario describes rows arriving in hash order.

The premise evidence `/home/matt/Development/helio/.concertino/runs/HEL-1732/evidence/premise-validation.md` now exists.

### What I verified this round (with evidence)

- **The projection's `outputSchema` is in declared order for the relevant ops.**
  - `PipelineAnalyzeService.analyzeNodes` collects results into a `mutable.LinkedHashMap` (`PipelineAnalyzeService.scala:299`). Each step's schema is a `Vector[SchemaField]`.
  - I grepped every inference file (`StepSchemaInference`, `ColumnSchemaInference`, `ReshapeSchemaInference`, `MultiInputSchemaInference`, `TextSchemaInference`). Every `toMap`/`toSet` there is a lookup only, and the output vectors are built in order:
    - compute: `inputSchema :+ field` (`ColumnSchemaInference.scala:66-74`)
    - aggregate: `groupByFields ++ aggFields` (`:145`)
    - lookup: `inputSchema ++ requested...` (`MultiInputSchemaInference.scala:49`)
    - unpivot: `idFields :+ var :+ value` (`ReshapeSchemaInference.scala:131-132`)
  - One exception: pivot projects only its `index` columns (`ReshapeSchemaInference.scala:61`). Its dynamic value columns become extras and sort by code unit. That is consistent with HEL-1705's rule. It is not a defect, but it is worth one line in the PR.
- **Draft-added steps are in the request.** `buildAnalyzeProposalRequest` leaves out only `isTempStepId` ids (`/^step-\d+$/`, `stepNarrowing.ts:408`). Draft-added steps use the `draft-` prefix (`draftOps.ts:78-82`), so they are sent and come back under their `clientId`. Scenario (c) is achievable. Temp `step-N` steps never render a grid ("Saving step…", `StepPreviewTable.tsx:193`).
- **Host for the grid hook.** All three `StepPreviewTable` call sites get `draft` from `usePipelineDraftPresentation.previewDraftFor`:
  - `PipelineSpineLayout.tsx:292`
  - `MobilePreviewTab.tsx:109`
  - `MobileStepSheet.tsx:113`

  That hook has `page.pipelineName`, `page.roots` and `page.steps`, the same inputs the sheet passes (`PipelineDetailDialogs.tsx:33`, `useOutputSheetNode.ts:48-56`). So one request per draft key is feasible, and phone and desktop share one host.
- **Fallback precedence against the AC.** At steady state the order is the projection's. The fallbacks are transient (D1.2 to D1.4) and the Risks section discloses them. This meets "columns follow the step's output schema".
- **Shared memo soundness: the sheet's tests share one request key.** `OutputEditorSheet.draft.test.tsx` renders the same draft in every case: `roots`, `threeSteps()` and `pipelineName: "Revenue rollup"` (lines 28-48). Each case mocks a different `http.post` result:
  - (a) an integer `duration_s` (`:101`)
  - (b) a string `duration_s` (`:117`)
  - (g) asserts `http.post` is called at all (`:127`)
  - (e) and its sibling are rejections (`:141`, `:184`)

  D2's module-level ("page-independent") memo keeps "the latest settled response" keyed by `JSON.stringify(request)`. With that memo, (b) gets (a)'s cached response, and (g) sees no POST. Task 3.2's claim that the sheet's "existing tests stay green unchanged" is false as designed.
- **Why a settled cache is needed at all.** The sheet requests at once on every key change (`useDraftNodeCapabilities.ts:59-73`, no debounce). The grid waits ~250 ms. A local `analyze-proposal` normally settles inside 250 ms, so sharing only the in-flight promise would not deliver "one request per draft definition". The settled cache is load-bearing, so its semantics must be specified, not left to the executor.

### Verdict: REFUTE

These are narrow fixes to D2, task 3.2 and D4. The order source, the precedence and the round 1 items are sound.

### Change Requests

1. **D2: specify what the memo caches and what clears it.** Without this, a competent implementer can build two incompatible caches, and one of them causes a regression. State all four rules:
   - (a) A rejected request is evicted. Never cache a rejection or keep a rejected promise, or one transient failure leaves the HEL-1733 sheet stuck in `unavailable` for that draft and blocks Save on chart kinds, where today reopening the sheet re-requests.
   - (b) Only successes are kept, and the bound is concrete (e.g. the last 8 keys).
   - (c) The scope. Prefer scoping the memo to the pipeline page instance, for example created in `usePipelineDetailPage` and passed on the page state that both `usePipelineDraftPresentation` and the sheet already read, over a module singleton. A page scope:
     - resets on navigation;
     - cannot serve one signed-in user's cached projection to another after an account switch in the same SPA session (the key holds source ids, not the user);
     - isolates tests naturally.

     If a module singleton is kept, export a reset and say which test files must call it.
   - (d) Saving or discarding the draft does not need to clear the cache, because the key changes. Say so, or say otherwise.
2. **Task 3.2 / D2: correct the "existing tests stay green unchanged" claim.** It is false for a module-level settled cache (see the evidence above: `OutputEditorSheet.draft.test.tsx` cases (a), (b), (e) and (g) share one key). Either:
   - adopt the page-scoped cache from CR1 (c), so each `render` gets a fresh cache and the claim holds; or
   - list the test files that need a reset in `beforeEach`.

   Editing those tests' expectations to make them pass is not acceptable. It would be the fixture-change symptom.
3. **D4 "Shared request": add the failure case.** With the sheet and the grid on the same draft and the first `analyzeProposal` rejected, a later same-key request (the sheet remounting, or the grid's debounced call) issues a new POST. This is the RED test for CR1 (a).

### Non-blocking notes

- Task 6.2 "one `analyze-proposal` per settled edit": with the Output sheet open, the sheet still sends one request per keystroke (existing behavior, which D2 leaves unchanged). Phrase the check as "the grid adds no request beyond the sheet's for the same draft key, and sends none without a draft". The evaluator must not read the existing per-keystroke sheet requests as a regression.
- Pivot's projected schema is only its `index` columns, so pivoted value columns follow in code-unit order. This is consistent with HEL-1705. Mention it in the PR so it is not reported as a bug.
- D1.2 ("last settled projection for that step id") can briefly put a just-renamed column at the end until the new projection settles. It is disclosed in Risks and acceptable.
