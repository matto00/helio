## Skeptic Report — final gate (round 6, axis: deletion-sweep completeness)

HEAD verified `0ac6c4ec`, `git status --porcelain` empty. Every command below re-run fresh in this
worktree. Round 5's report was read as a set of claims to re-test, not as fact.

### What I verified (with evidence)

**1. Round-5 note 3 (`pipeline-compute-op/spec.md` `ComputeStep` correction) — LANDED and ACCURATE.**
`specs/pipeline-compute-op/spec.md:7` now reads ``ComputeStep.apply`` (was
`InProcessPipelineEngine.applyCompute`). Verified against source, not taken on trust:
`domain/steps/ComputeStep.scala:52` calls `ComputeStep.apply(rows, config)` and `:55` declares
`object ComputeStep`, so the named symbol genuinely exists and is genuinely the op's entry point.
`grep -rn "applyCompute" backend/src` returns only `SourceService.applyComputedFields` mentions (a
different, unrelated method) — no `applyCompute` anywhere. `git show 0ac6c4ec -- .../pipeline-compute-op/spec.md`
is a clean 1-line change. Correct.

**2. AC 6.1 grep, run verbatim and fresh.** 7503 raw hits; excluding `db/migration/**`,
`hel904-real-dump.sql` and `backend/src/test` leaves 82 lines in `backend/src/main`, of which
**exactly 15 are code (non-comment) hits in 6 files** — `WorkspaceContextProtocol.scala:56,58,126`,
`PipelineProposalProtocol.scala:117`, `PipelineProposalService.scala:325,416,446`,
`WorkspaceContextService.scala:357,878,880,888`, `CombinedProposalService.scala:82,163,165,167` —
plus one history sentence in `services/panels/README.md:6`. Byte-for-byte the same wire-field-NAME
set rounds 2–5 found, all covered by design.md's Exemptions 1–4. **AC 6.1 holds.**

**3. `openspec validate outputs-model-migration --type change --strict`** → `Change
'outputs-model-migration' is valid`, exit 0, fresh.

**4. Compile + full suite, fresh clean single-threaded run (HEL-924 protocol).** First attempt
returned `doesn't appear to be an sbt project` — that was **my own measurement error** (invoked from
the worktree root, not `backend/`), not a build failure; re-run from `backend/`:
`sbt -batch 'set Test/parallelExecution := false' clean compile Test/compile test` →
`Total number of tests run: 3365`, `Tests: succeeded 3365, failed 0, canceled 0, ignored 0`,
`All tests passed.`, `EXIT=0`. (+11 vs round 5's 3354.)

**5. Repo quality gates, all fresh, all green.**
- `node scripts/check-schema-drift.mjs` → `schemas in sync with JsonProtocols (60 checked across 46
  protocol files)`, `panel-type enums in sync with backend canonical sets (7 surfaces checked)`, exit 0.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, exit 0.
- `npm run check:scala-quality` → `Scala code-quality check: clean (131 soft warning(s))`, exit 0.
  All 131 are pre-existing test-file soft line-budget warnings; no hard failures.

**6. Targeted sweep of everything `0ac6c4ec` touched (the "ninth instance" check).**
Non-test, non-report files in that commit are exactly four: `PipelineStepRepository.scala` (not my
axis), `ProposalPanelSupport.scala`, `schemas/dashboards/dashboard-proposal.schema.json`,
`schemas/authoring/combined-proposal.schema.json`, plus the compute-op spec line above. I checked
every new assertion in them against source:

- `combined-proposal.schema.json` — "`config.dataTypeId` only for a panel type outside `output`
  (i.e. text/markdown/image)". **TRUE.** `CombinedProposalService.configIsBlessed` (`:122-125`)
  gates on `!DashboardProposalService.DataPanelKinds.contains(panel.type)`, and
  `DashboardProposalService.scala:159` is now `DataPanelKinds: Set[String] = Set("output")`; the
  proposal panel `type` enum (`dashboard-proposal.schema.json:34`) is
  `["text","markdown","image","output"]`, so the parenthetical enumerates the complement exactly.
- `dashboard-proposal.schema.json` `dataTypeId` — "Omitted for text/markdown/image panels —
  TextPanelConfig/MarkdownPanelConfig no longer carry a data binding of any kind". **TRUE.**
  `TextPanel.scala:14` is `TextPanelConfig(content: String)`; `MarkdownPanel.scala:14` is
  `MarkdownPanelConfig(content: String)`. Neither has a `dataTypeId`.
- `dashboard-proposal.schema.json` `config` — "a `config.dataTypeId` on a text/markdown panel is
  silently inert, not a binding attempt". **TRUE.** `TextPanelConfig.decodeCreate` (`:33`) delegates
  to `decode`, which reads only `fields.get("content")` and ignores every other key; same for
  Markdown. And `ProposalPanelSupport.bindingCandidate` is now just `panel.dataTypeId` — the
  `config.dataTypeId` fallback really is gone.
- `dashboard-proposal.schema.json` `metricId` — "Legacy field, decoded but never applied". **TRUE**;
  `validateMetricBinding` is gone (`ProposalPanelSupport.scala:101-102` records the removal) and no
  build path reads it.
- **One new assertion is FALSE — see CR1.**

**7. Wider deletion-sweep pass over agent-facing prompt/doc surfaces not previously inventoried.**
This is where the axis found something the previous five rounds did not look at: the *live Claude
prompt text*. `DashboardAuthoringPrompt` appears nowhere in `tasks.md` or `design.md`; per
`execution-progress.md:3285` it was touched exactly once, for the mechanical
`WorkspaceContextDataType` → `WorkspaceContextOutput` class rename. Its prompt **content** was never
audited. See CR2 — and note this one is **not** documentation: it is shipped runtime behavior.

### Verdict: REFUTE

The compute-op correction landed and is accurate, the AC grep is unchanged from rounds 2–5,
`openspec --strict` passes, all three repo gates are green, and the suite is 3365/3365 on a fresh
clean single-threaded run. But CR2 is a live functional break in shipped code that the deletion
sweep missed, and CR1 is the ninth instance of the stale-assertion class — written *this cycle*, in
a line the executor was editing to fix that very class.

**Explicit classification, as requested:** CR2 is **not** an ordinary documentation defect. It is a
live-execution behavior break on `POST /api/authoring/dashboard` — but it raises **no DESIGN
question**: the correct target shape is already fully determined by `PanelType.fromString`,
`DataPanelKinds = Set("output")`, and the proposal schema's own enum, all of which this ticket
already settled. It is a straightforward "finish the migration on a surface that was never
inventoried", not a decision anyone needs to make. CR1 is inert documentation.

### Change Requests

1. **`schemas/dashboards/dashboard-proposal.schema.json:46` asserts something the code does not do**
   (line edited in `0ac6c4ec`). The `fieldMapping` description opens: *"For an `output` panel,
   passed through into config.fieldMapping alongside dataTypeId"*. It is not.
   `ProposalPanelSupport.buildDataConfig` (`:174-180`) for `panel.type == "output"` emits
   **`JsObject(Map("outputId" -> JsString(dataTypeId)))` and nothing else** — `panel.fieldMapping`
   is read only in the `else` (non-output) branch, which is now unreachable for any proposal panel
   kind that has a binding. `OutputPanelConfig` (`OutputPanel.scala:18`) is `(outputId: OutputId)`
   only, and its `decodeCreate` ignores every other key. So `fieldMapping` is inert on an `output`
   panel exactly as it is on text/markdown. The executor rewrote the second half of this sentence
   while leaving the false first half. Fix the description to say `fieldMapping` is decoded but
   never applied on any current panel kind (same treatment `metricId` just received two properties
   above).
   Same false claim, same cycle, in `ProposalPanelSupport.scala:155-157`: *"`dataTypeId`/
   `fieldMapping` remain meaningful ONLY for `"output"`-kind panels"* — `dataTypeId` is meaningful
   (it becomes `outputId`); `fieldMapping` is not meaningful anywhere. Correct both.

2. **`DashboardAuthoringPrompt.ProposalShapeDescription` still instructs the model to emit deleted
   panel kinds — `POST /api/authoring/dashboard` is functionally broken for any data-bound panel.**
   `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringPrompt.scala:27-39` is the
   live prompt body, composed into the user message by `userMessage` (`:120-126`) and sent by
   `DashboardAuthoringService.scala:154`. It currently tells Claude:
   - `:27` `"type": "one of: metric | chart | table | text | markdown | image | collection | timeline"`
     — five of those eight kinds were deleted by this ticket, and **`output`, the only kind that can
     now carry a binding, is not offered at all**.
   - `:28` `"dataTypeId": "... REQUIRED for metric/chart/table/collection/timeline; must be one of
     the pipeline-output DataType ids listed below"`.
   - `:29`–`:38` `fieldMapping` (`metric {value,label?,unit?}; chart {...}; table {columns}`),
     `aggregation`, `chartType`, `xAxisLabel`, `yAxisLabel`, `seriesColors`, `label`, `unit`,
     `sort` — every one of these belongs to a deleted kind or a deleted config surface.

   Behavioral consequence, traced end to end: any proposal the model returns following these
   instructions is rejected at `ProposalPanelSupport.validatePanel:33` →
   `PanelType.fromString` (`model.scala:132-138`), which now accepts only
   `text|markdown|image|divider|output` and returns
   `"Unknown panel type: 'metric'. Valid values: text, markdown, image, divider, output"`. The single
   repair round-trip (`repairMessage`, `:130`) re-points the model at *"the exact shape described
   above"* — i.e. the same wrong shape — so the repair cannot recover either. The endpoint therefore
   cannot produce a working data-bound dashboard at all.

   No test catches this: `DashboardAuthoringPromptSpec.scala` asserts nothing about the kind list
   (`grep -n "metric\|chart\|table\|timeline\|collection"` → no hits), which is why 3365 green tests
   coexist with the break. The file's own doc comment at `:19-20` is the standing warning that was
   not honoured: *"this is a hand-maintained mirror of that schema's fields — keep the two in sync
   by hand if `ProposalPanel`'s fields change."*

   Fix: retarget `ProposalShapeDescription` and `Instructions` to the shipped shape — `type` enum
   `text | markdown | image | output`; `dataTypeId` REQUIRED for `output` only, carrying an Output
   id; drop `fieldMapping`/`aggregation`/`chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors`/
   `label`/`unit`/`sort`; keep `content`/`url`/`layout`. Add a `DashboardAuthoringPromptSpec` case
   asserting the rendered prompt's kind list equals the set `PanelType.fromString` accepts, so this
   cannot silently re-drift. `groundingSection`'s agent-facing wording (`:69` *"Available
   pipeline-output data types:"*, `:67` `DataType id=`) should be retargeted to Output in the same
   pass — lower severity, but it is the same prompt.

   **Scope check, since "defer to HEL-907" is the obvious counter-argument and I tested it:** this
   ticket did *not* leave the proposal path alone — it retargeted `DataPanelKinds` to `Set("output")`,
   rewrote `buildDataConfig`'s output branch, and edited both proposal schema files in this very
   commit. `tasks.md:260` shows the executor knew how to write an explicit HEL-907 deferral when it
   meant one (it did exactly that for `RefinementEditShape`'s prompt text) and wrote **no such note**
   for `DashboardAuthoringPrompt`. This is an unfinished migration on an in-scope surface, not a
   deliberate deferral. `RefinementPrompt.scala:35-38`'s surviving `metric`/`chart` `config.aggregation`
   instructions are genuinely covered by the `RefinementEditShape`/HEL-907 deferral and are **not**
   part of this CR.

### Non-blocking notes

1. `ProposalPanelSupport.scala:47-54` (`preValidateBindings` scaladoc) is stale in two places, four
   lines above the comment the executor corrected this cycle: it still describes *"OR (HEL-316) a
   non-`DataPanelKinds` panel's `config.dataTypeId`"* (removed — `bindingCandidate` is now
   `panel.dataTypeId` alone, per that method's own corrected doc at `:101-107`) and *"THEN (HEL-549)
   that a panel carrying a `metricId` resolves to a caller-owned, non-deprecated metric"*
   (`validateMetricBinding` was removed outright, recorded at `:101-102`).
2. `tasks.md`'s trailing note (~`:266-268`) justifies KEEPING `PatchSetApplyContext.dataTypeRepo`/
   `dataTypeService` because *"`rejectCompanionBinding` … still legitimately reads `dataTypeRepo`
   for non-`"output"`-kind panel bindings (Text/Markdown panels bound to a legacy DataType)"*. Both
   halves are now false: `PatchSetApplyResolvers.scala:143` records
   `validatePanelBindingRefs`/`rejectCompanionBinding` as **removed**, and Text/Markdown panels
   carry no binding. Doc-only; verify whether the kept params are now actually dead.
3. Round-5 notes 1 and 2 (`AssistantProposalToolSchemas.scala`'s `fieldMapping`/`aggregation` keys
   on the worked `output` examples, and its `metricId` property) were **not** closed this cycle —
   the source file is absent from `0ac6c4ec`; only its Spec gained 40 lines. Still inert, still open.
   Worth folding into CR1's fix, since it is the same false "fieldMapping is meaningful on an output
   panel" belief expressed in a third place.
4. Round-5 notes 4 (`RefinementEditShape` worked examples → HEL-907) and 5 (`metric-crud-api/spec.md`
   duplicate Migration sentences) remain, unchanged and correctly scoped.
