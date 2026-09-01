## Skeptic Report — final gate (round 7, axis: deletion-sweep completeness)

HEAD verified `1e56bc0493d8a46a46704db97ba73c47fa467b31`, `git status --porcelain` empty. Every
command below re-run fresh by me in this worktree. Round 6's report and `execution-progress.md`
were read as claims to re-test, not as fact.

### What I verified (with evidence)

**1. Round-6 CR2 (`DashboardAuthoringPrompt` stale panel kinds) — GENUINELY FIXED.**
Read the file as it exists now:
- `:27` `"type": "one of: text | markdown | image | output"` — exactly the proposal schema's own
  enum (`dashboard-proposal.schema.json:34`), and a strict subset of what
  `PanelType.fromString` accepts (`text|markdown|image|divider|output`; `divider` is correctly
  excluded for create_panel parity, per that schema's own description).
- `:28` `dataTypeId` — "REQUIRED for output panels; must be one of the pipeline-output Output ids
  listed below (the field is named dataTypeId for wire-schema stability, but the value is
  actually an Output id)". Accurate: `ProposalPanelSupport.buildCreateRequest` sets
  `bindingKey = "outputId"` when `type == "output"` and `buildDataConfig` emits
  `JsObject(Map("outputId" -> JsString(dataTypeId)))`.
- Every deleted-kind-only field (`fieldMapping`/`aggregation`/`chartType`/`xAxisLabel`/
  `yAxisLabel`/`seriesColors`/`label`/`unit`/`sort`) is gone; `content`/`url`/`layout` kept.
- `Instructions` (`:41-46`) now say "Every output panel's dataTypeId MUST be one of the
  pipeline-output Output ids listed below" and "Only use the output panel kind …".
- `groundingSection` retargeted: `:58` `Output id=`, `:60` `"Available pipeline Outputs:"`.

**2. Compatibility with the validator, traced end to end (not superficially).**
`DashboardAuthoringService.scala:143/151-154` — `initialUserMessage` really does call
`DashboardAuthoringPrompt.userMessage(...)` and wrap it as the `ClaudeRole.User` turn, so this is
the live prompt text. A proposal following the corrected instructions now passes
`ProposalPanelSupport.validatePanel`: `PanelType.fromString("output")` → `Right`;
`DashboardProposalService.scala:159` `DataPanelKinds = Set("output")` requires `dataTypeId`, which
the prompt marks REQUIRED for exactly that kind; the `divider`-orientation branch never fires
because `divider` is not offered; and the deleted chart/timeline/metric predicates are gone
(`ProposalPanelSupport` task-3.10a comment). Guidance and validator are genuinely aligned.

**3. The new `DashboardAuthoringPromptSpec` pin is real and non-vacuous.**
`DashboardAuthoringPromptSpec.scala:113-129` renders the actual prompt via `userMessage` and (a)
asserts the exact literal `"\"type\": \"one of: text | markdown | image | output\""`, (b) asserts
`should not include` for each of `metric|chart|table|collection|timeline` **over the whole rendered
message**, (c) round-trips each mentioned kind through `PanelType.fromString` expecting `Right`.
(a) is an exact-string pin — any regression to the old kind list fails it immediately; (b) is a
broad backstop over the entire prompt, not just the one line. Confirmed the test actually executes:
`sbt7.log:2497` shows it running and passing (not compiled-but-unrun).

**4. `RefinementPrompt.scala`'s HEL-907 deferral is REAL, not phantom — verified two ways.**
- Path: `backend/src/main/scala/com/helio/services/patchsets/RefinementPrompt.scala` — the
  patch-set/refinement surface.
- I pulled HEL-907 from Linear directly. Its Scope states verbatim: *"**This ticket owns both sides
  of the proposal and patch-set contracts** — `schemas/dashboards/dashboard-proposal.schema.json`,
  `schemas/pipelines/pipeline-proposal.schema.json`, `schemas/patch-sets/*`, the backend proposal
  services…"* and *"Patch-set inverse builders rewritten for nodes/outputs/placements"* and
  *"Refinement targeting: a chart-create with an implied Output must not mistarget a follow-up
  edit"*. The refinement/patch-set prompt surface is squarely named. Corroborated in-repo by
  `tasks.md:245` ("Adding real `output`-kind patch-set support is P1.4/HEL-907's job") and
  `execution-progress.md:2352`. **This is a genuine deferral**, unlike the phantom-deferral class
  this ticket hit repeatedly. `RefinementPrompt.scala:35-38` and `RefinementEditShape.scala`'s
  five worked kind examples are correctly out of scope.

**5. Schema + code comment corrections are accurate.**
- `dashboard-proposal.schema.json` `fieldMapping`: now "Legacy field, decoded but never applied:
  buildDataConfig emits only {outputId} for an `output` panel … fieldMapping is not passed
  through." **TRUE** — verified against `buildDataConfig` (above) and `OutputPanelConfig`.
- `ProposalPanelSupport.scala` comment (the task-3.10 block) now reads "`fieldMapping` is NOT
  meaningful on any current panel kind -- corrected cycle-9 …". **TRUE.** Round-6 CR1 closed.

**6. AC 6.1 grep, run verbatim and fresh.** 82 lines in `backend/src/main` after excluding
`db/migration/**`, `hel904-real-dump.sql`, `backend/src/test`; **16 non-comment lines across the
same 6 files** rounds 2–6 found (`WorkspaceContextProtocol`, `PipelineProposalProtocol`,
`PipelineProposalService`, `WorkspaceContextService`, `CombinedProposalService`, plus the one
history sentence in `services/panels/README.md`). Byte-identical wire-field-NAME set, all covered
by design.md Exemptions 1–4. **AC 6.1 holds.**

**7. All gates green, fresh, by me.**
- `sbt -batch 'set Test/parallelExecution := false' clean compile Test/compile test` from
  `backend/` → `Total number of tests run: 3367`, `Suites: completed 225, aborted 0`,
  `Tests: succeeded 3367, failed 0`, `All tests passed.`, `EXIT=0`. (+2 vs round 6's 3365,
  matching the two claimed new regression tests.)
- `openspec validate outputs-model-migration --type change --strict` → valid, exit 0.
- `node scripts/check-schema-drift.mjs` → in sync (60 protocols / 46 files; 7 panel-type surfaces).
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.
- `npm run check:scala-quality` → clean (131 pre-existing soft warnings, no hard failures).

**8. The broad "one more instance" sweep — this is where round 7 found something.**
Ran the requested sweep across `services/proposals/`, `services/patchsets/`, `services/assistant/`
and manually triaged every hit:
- `services/proposals/` — `ProposalPanelSupport` + `DashboardProposalService`: comment-only
  tombstones recording the deletions. Benign (two stale scaladoc lines noted below).
- `services/patchsets/` — 9 files. `PatchSetApplyRollback`/`PatchSetUndoInverse`/`PatchSetApply
  Types`/`PatchSetUndoTypes`/`PatchSetApplyResolvers`/`PatchSetPreviewProjection`/`PatchSetUndo
  ConflictCheck` hits are either `appearance.chart` (a **surviving** panel-appearance field, not a
  panel kind) or removal tombstones. `RefinementPrompt`/`RefinementEditShape` → genuine HEL-907
  deferral (item 4). All benign/deferred.
- `services/assistant/` — one file, `AssistantSystemPrompt.scala`. **Live and wrong.** See CR1.
- Also re-checked the adjacent `AssistantProposalToolSchemas.scala` (round-6 note 3): its panel
  `type` enum WAS correctly narrowed to `("text","markdown","image","output")` at `:51`, so the
  machine-checked surface is fine; its residual `metricId`/`fieldMapping`/`aggregation`/
  `chartType`/`label`/`unit`/`sort` properties and worked-example keys remain inert. Non-blocking.

### Verdict: REFUTE

Everything round 6 asked for landed and is accurate, all five gates are green, the AC grep is
unchanged, and the new prompt pin is a real regression guard. But the broad sweep the ticket asked
for turned up the tenth instance of the same class, in a **third** Claude-facing prompt file that
no previous round inventoried and that carries **no deferral note anywhere** in the change dir
(`grep -rn "AssistantSystemPrompt" openspec/changes/outputs-model-migration/` → zero hits).

**Explicit classification, as requested:** CR1 raises **no DESIGN question** — the correct target
shape is fully determined by the same three facts that settled round 6's CR2 (`PanelType.fromString`,
`DataPanelKinds = Set("output")`, and `AssistantProposalToolSchemas`' already-corrected enum at
`:51`). It is a text-only edit to static prompt prose, mechanically identical to the fix the
executor just performed on `DashboardAuthoringPrompt`. It **is** live shipped runtime behavior
(not documentation), but it is smaller and more contained than round 6's finding — it needs no new
tests beyond an optional pin, no schema change, and no semantics decision. Per the orchestrator's
standing instruction, this is a defect the orchestrator may reasonably close out without another
full round-trip.

### Change Requests

1. **`AssistantSystemPrompt.scala` still instructs the in-app assistant with a deleted panel kind
   and with retired Metrics/DataType concepts — it is live, and it now directly contradicts the
   tool schema shipped beside it.**
   `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala` is folded into
   the first `user` turn of every assistant conversation by
   `AssistantService.scala:116` (`val turnText = if (history.isEmpty) AssistantSystemPrompt.text +
   "\n\n" + message else message`), so this is shipped runtime prompt text on `converse`, not docs.

   - **`:40-45` (`WorkedExamplesSection`) — the worked `propose_dashboard` mini-transcript emits a
     deleted kind.** It literally instructs: `propose_dashboard({... "panels": [{"title": "Total
     Orders", "type": "metric", "dataTypeId": "dt_a1b2c3", "fieldMapping": {"value": "amount"},
     "aggregation": {"value": "amount", "agg": "sum"}}]})`. `"metric"` was deleted by this ticket;
     a proposal shaped after this example is rejected by `ProposalPanelSupport.validatePanel` →
     `PanelType.fromString` with `"Unknown panel type: 'metric'. Valid values: text, markdown,
     image, divider, output"`. This is the *only* worked `propose_dashboard` example the model
     sees, and it now **contradicts** the sibling tool schema
     (`AssistantProposalToolSchemas.scala:51`, `enum ["text","markdown","image","output"]`) that
     this same ticket already corrected — the two halves of the same prompt disagree.
     Fix: retarget the example to `"type": "output"` with `dataTypeId` as an Output id, and drop
     the `fieldMapping`/`aggregation` keys (inert on an `output` panel — exactly the correction
     just applied to `dashboard-proposal.schema.json`).
   - **`:63-65` — the `find` tool description in the prompt is now factually false.** It says find
     searches "data sources, DataTypes, pipelines, dashboards, **and metrics**". This ticket's own
     **task 3.2 already removed `"metric"`** from the real tool: `WorkspaceAssistantTools.scala:22`
     `ResourceTypeEnum = Vector("dataSource", "dataType", "pipeline", "dashboard")`, and that
     tool's own `description` was correctly updated to drop metrics. The static prompt beside it
     was not. Drop "and metrics".
   - **`:103` — "Never fabricate a resource id (a dataTypeId, sourceId, pipelineId, dashboardId,
     panelId, or metricId)"**: `metricId` no longer exists as a resource id. Drop it.
   - Lower severity, same pass: `:66-68` `get_resource`'s "For a DataType, the result also includes
     a panelCapabilities menu — only propose a panel kind that menu marks bindable" and `:78-79`
     `propose_dashboard`'s "bound to EXISTING pipeline-output DataTypes" should be retargeted to
     Outputs for consistency with the `DashboardAuthoringPrompt` wording just fixed, and `:87-89`
     `propose_patch_set`'s target list still names "a … DataType" as an editable kind, which
     `PatchSetProtocol.recognizedKinds` no longer accepts (task 3.3 removed `"dataType"` outright,
     so the model is being offered a target that is now hard-rejected).

   **Why this is in scope and not a HEL-907 deferral** (I tested the counter-argument): HEL-907's
   Linear scope covers helio-mcp, the proposal/patch-set *schemas and services*, and the review
   pages — it does not name the in-app assistant's static system prompt. More decisively, this
   ticket **already swept this exact package**: task 3.2 edited `WorkspaceAssistantTools`' `find`
   tool and task 3.10a-era work narrowed `AssistantProposalToolSchemas`' panel-type enum. The
   static prose file sitting between them was simply missed, and the machine gate could not catch
   it — `check-schema-drift.mjs` verifies "panel-type enums in sync … (7 surfaces checked)", and
   this file has no enum, only prose.

### Non-blocking notes

1. Round-6 non-blocking note 1 was **not** closed. `ProposalPanelSupport.scala:46-53`
   (`preValidateBindings` scaladoc) still describes *"OR (HEL-316) a non-`DataPanelKinds` panel's
   `config.dataTypeId`"* (removed — `bindingCandidate` is `panel.dataTypeId` alone) and *"THEN
   (HEL-549) that a panel carrying a `metricId` resolves to a caller-owned, non-deprecated
   metric"* (`validateMetricBinding` deleted, per the tombstone 40 lines below it). Doc-only.
2. New, same file: `ProposalPanelSupport.validatePanel`'s own scaladoc (`:28-31`) still says
   *"and — for a **chart** panel's `chartType`, a divider panel's `orientation`, or a **timeline**
   panel's `sort` — value validity"*, four lines above the task-3.10a comment recording that those
   very branches were deleted. Only the `divider` clause is still true. Doc-only.
3. Round-6 note 3 (`AssistantProposalToolSchemas.scala`'s inert `metricId`/`fieldMapping`/
   `aggregation`/`chartType`/`label`/`unit`/`sort` properties at `:60-73` and the
   `fieldMapping`/`aggregation` keys in its `DashboardProposalExample` `:90-91` and
   `CombinedProposalExample` `:209-210`) remains open. Its `type` enum is correct, so nothing is
   broken — but the two worked examples teach the model to emit keys that are silently dropped.
   Natural to fold into CR1's pass, since it is the same belief in a fourth place.
4. Round-6 note 2 (`tasks.md`'s justification for KEEPING `PatchSetApplyContext.dataTypeRepo`/
   `dataTypeService`, both halves of which are false) and note 5 (`metric-crud-api/spec.md`
   duplicate Migration sentences) remain, unchanged.
