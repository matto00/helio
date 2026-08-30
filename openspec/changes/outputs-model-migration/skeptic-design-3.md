## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `skeptic-design-2.md`, then re-derived every conclusion from the live repo.
- **Coverage (round-2 finding 1 — the repeat).** Independently reproduced the enumeration:
  `grep -rl "DataType\|Metric" openspec/specs | sed 's|openspec/specs/||;s|/spec.md||' | sort`
  → **115**. `ls openspec/changes/outputs-model-migration/specs | sort` → **71**.
  `comm -12` → **65** covered; `comm -13` → the **6** non-grep-matched delta dirs
  (`node-snapshot-persistence`, `output-panel-placement`, `outputs-model`,
  `panel-batch-update`, `pipeline-step-tree`, `rls-policy-guard`) — exactly the 6 the
  checklist claims; `comm -23` → **50** uncovered. I then parsed the checklist's three
  deferral lists + the no-op line straight out of the markdown (9 + 18 + 22 + 1 = 50),
  `uniq -d` → no duplicates, `comm -13`/`comm -23` against the 50 uncovered → **both empty**.
  The partition is exact, exhaustive and non-overlapping, independently of the checklist's
  own arithmetic. **This finding is CLOSED — it did NOT recur a third time.**
- Spot-checked deferrals against their spec text (`mcp-metric-tools`,
  `nl-dashboard-proposal-authoring`, `authoring-error-telemetry`, `conversational-refinement`
  → P1.4; `panel-creation-datatype-step`, `metric-authoring-ui`, `panel-type-rendering`
  → P1.5/P1.6): each is genuinely MCP/NL-grounding or UI surface, matching its stated owner.
  `page-shell-primitives:68-69` verified as a real no-op — it already excludes
  `TypeRegistryPage`/`MetricsPage` from its own scope.
- Every capability round 2 named as wrongly-uncovered now carries a delta (`acl-enforcement`,
  `pipeline-execution`, `pipeline-run-execution`, `patch-set-apply/-preview/-undo`,
  `workspace-context-assembly`, `schema-inference-facade`, `rls-privileged-bypass`,
  `resource-tagging`, and all the "also plausibly in-scope" ones).
- `npx openspec validate outputs-model-migration --type change --strict` → **valid**.
- Re-read `scripts/check-schema-drift.mjs` end to end (338 lines) and cross-checked each of
  the five pieces design.md/tasks 5.4 now names against the real source.
- `grep -rn "PanelCapabilityService" backend/src/main/scala backend/src/test/scala` — see
  finding 5; the orchestrator's round-3 correction is **confirmed**.
- Read the real definitions the plan says it will edit: `proposalValidation.ts:19`,
  `ProposalReview.tsx:29,60,146`, `proposal.ts:28,66`,
  `DashboardProposalService.scala:211`, plus `DataPanelKinds`' real consumers.

### Verdict: REFUTE

The coverage repeat is genuinely closed and the `PanelCapabilityService` correction is
right. But the round-3 `check-schema-drift.mjs` answer contains one substantive error
(#1) that would ship a silent behavior inversion in live backend validation, plus four
smaller precision defects.

### Change Requests

1. **`DataPanelKinds` is not a "mechanical constant edit" — retargeting it as planned
   inverts a live backend validation predicate.** Tasks 3.10/5.7 and design.md item 5 set
   `DashboardProposalService.DataPanelKinds` to the Output-kind set
   `(metric, chart, table, collection, timeline, markdown)` and assert "No other change to
   these files' logic/UX in this ticket." That is false. `DataPanelKinds` is not a passive
   list the drift script reads — it is a predicate over `panel.type`:
   - `ProposalPanelSupport.scala:37` — `if (DataPanelKinds.contains(panel.`type`) && panel.dataTypeId.isEmpty)` (rejects unbound data panels)
   - `ProposalPanelSupport.scala:157` — binding-vs-config precedence
   - `CombinedProposalService.scala:123` — `!DataPanelKinds.contains(panel.`type`) && …` dangling-ref guard
   - covered by `CombinedApplyProposalDanglingRefSpec.scala:39` ("… on a DataPanelKinds
     (chart) panel"), which task 6.4 requires green.
   After tasks 3.6/5.2 the panel discriminator is `kind ∈ {output, text, markdown, image,
   divider}`. So `DataPanelKinds.contains(panel.kind)` becomes **false for every data panel**
   (they're all `output`) and **true only for `markdown`** — the unbound-panel rejection stops
   firing and markdown panels start being told they need a binding. Identical inversion in the
   two `.ts` mirrors (`proposalValidation.ts:44`, `ProposalReview.tsx:60,146`).
   Required revision: make this an explicit design decision, not a constant edit. Either
   (a) `DataPanelKinds` becomes the *panel-kind* set requiring an Output binding (i.e.
   `Set("output")`, with the `.ts` mirrors following), or (b) the three predicate call sites
   are rewired to test the Output binding directly — and either way name the affected backend
   specs (`CombinedApplyProposalDanglingRefSpec` at minimum) as tasks, and drop 5.7's "no
   other change to logic" claim.

2. **All four cross-surface line citations added in round 3 are wrong** — they are
   `check-schema-drift.mjs`'s own line numbers pasted as if they were the target files'.
   `helio-mcp/src/tools/proposal.ts` is 211 lines long, so `:275-280` cannot exist. Real
   locations: `proposal.ts:28` (`PANEL_TYPES`), `proposalValidation.ts:19`
   (`DATA_PANEL_TYPES`), `ProposalReview.tsx:29` (`DATA_PANEL_TYPES`),
   `DashboardProposalService.scala:211` (`DataPanelKinds`). Since line-level precision was
   this round's entire remit, fix them (design.md `:86-89`, `:152-154`; tasks 5.7).

3. **design.md still contains the superseded round-2 "Decision", which directly contradicts
   the round-3 revision.** `design.md:94-104` instructs updating *all four* cross-surface
   arrays to `output | text | markdown | image | divider`; round-3 item 5 (`:152-164`)
   instructs updating the two `DATA_PANEL_TYPES` arrays to `metric, chart, table, collection,
   timeline, markdown` instead. Both are presented as decisions; an executor can read either.
   Delete/rewrite `:94-104` (and section 0 of tasks.md, per round 2's non-blocking note).

4. **Round-2 finding 4 was not actually applied.** `tasks.md:1.1` still says
   `Pipeline.outputDataTypeId` "is removed in task 3.5", and 3.5's text is still only
   "`PipelineRepository.create` stops minting a type; `PipelineService.create` drops
   `outputDataTypeName`" — no domain-field removal. Same for 1.4 → 3.1 (`targetDataTypeId`;
   3.1 is only the `evaluateForDataType` → `evaluateForOutput` rename). Add the two domain-model
   field removals to the text of 3.5 and 3.1, as round 2 required.

5. **Task 3.11's KEEP is correct — I confirm the orchestrator's correction and refute round 2 —
   but its test-side blast radius is unowned.** `PanelCapabilityService` is a live constructor
   parameter of `RefinementGrounding.scala:46`, `AssistantService.scala:43`,
   `AssistantToolExecutor.scala:46`, `DashboardAuthoringService.scala:53`; round 2's
   "only two deleted-route callers" claim was wrong. However **12 backend spec files**
   construct `new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)` with the two
   repositories task 4.1 deletes (`AssistantToolExecutorSpec:66`, `AssistantServiceSpec:139`,
   `RefinementRoutesSpec:114`, `RefinementServiceSpec:127`, `DashboardAuthoringRoutesSpec:112`,
   `DashboardAuthoringServiceSpec:120`, `AuthoringTelemetrySpec:117`, `ResourceTaggingSpec:125`,
   `DataTypeDataSourceAclSpec:128`, `PipelineRunServiceSpec:1092`,
   `PanelCapabilityServiceSpec:58`, `DataTypeRoutesSpec:78`). Task 4.5 only covers specs *of
   deleted files*; these belong to kept services and must be rewired to the new constructor.
   Add that to 3.11 (or a new 4.7), and also note the stale doc comments at
   `PanelBindingSpec.scala:32,103-119` and `PanelCapabilityProtocol.scala:8`.

### Non-blocking notes

- `openspec-coverage-checklist.md`'s prose says "13 wholesale REMOVED" while 18 delta files
  contain a `## REMOVED Requirements` section (the extra 5 are partial removals plus
  `panel-type-field`, listed elsewhere in the covered list). The per-file partition I verified
  is correct; only the summary prose is loose.
- Checklist heading "Round 1/2 (16 capabilities)" enumerates ~35 names. Cosmetic.
- `proposal.md` still lists `data-source-persistence` under "Modified Capabilities" while its
  delta is `## ADDED Requirements` (carried over from round 2, unfixed).
