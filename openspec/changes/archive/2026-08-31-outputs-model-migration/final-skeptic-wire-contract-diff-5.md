## Skeptic Report — final gate, axis: wire-contract diff (round 5, LAST authorized round)

HEAD `d12b19b2` vs `main`. `git status --porcelain` empty. Fresh cold derivation; round 4's
report and `execution-progress.md` were read as claims to verify, not as facts.

Note: `AssistantProposalToolSchemas.scala` now lives at
`backend/src/main/scala/com/helio/api/protocols/assistant/` (round 4 cited it as `protocols/`);
that move predates this round's delta and is not new drift.

### What I verified (with evidence)

1. **Round-4 CR 1 — both worked examples ARE fixed.**
   - `AssistantProposalToolSchemas.scala:87` `DashboardProposalExample` → `"type": "output"`,
     `"dataTypeId": "dt_example_from_find"`. Correct kind: `output` is the sole member of
     `DashboardProposalService.DataPanelKinds`, and `ProposalPanelSupport.buildDataConfig:168-170`
     routes an `output` panel's `dataTypeId` into `{"outputId": …}`, so the id field stays valid.
   - `:207` `CombinedProposalExample` → `"type": "output"`, `"dataTypeId": "$pipelineOutput"`.
     Consistent with `CombinedProposalService.flatIsBlessed:113` (flat slot is the blessed slot).
   - `grep -n -i "metric" AssistantProposalToolSchemas.scala` returns only the explanatory comment at
     `:45` and the inert `metricId` property declaration at `:60`. No live `"type": "metric"` remains.
   - Enum at `:51` still `text|markdown|image|output`; the file is no longer self-contradicting.

2. **`AssistantProposalToolSchemasSpec` passes fresh.**
   `sbt "testOnly *AssistantProposalToolSchemasSpec"` → `Tests: succeeded 10, failed 0`,
   `[success]`. (See finding B below on what this pin still cannot catch.)

3. **Round-4 CR 2 — all 9 named `dashboard-proposal.schema.json` descriptions ARE rewritten.**
   Full-file fresh read (133 lines, `cat -n`). `metricId:43`, `aggregation:51`, `chartType:69`,
   `xAxisLabel:73`, `yAxisLabel:77`, `seriesColors:84`, `label:88`, `unit:92`, `sort:97` now all read
   "Legacy field, decoded but never applied … deleted by the pipelines-and-outputs remodel
   (HEL-903/904). Retained on the wire for schema stability only." Verified accurate against ground
   truth: `ProposalPanelSupport.validatePanel:41-44` and `buildDataConfig:153-175` confirm the
   label/unit/aggregation/timeline/chart folding branches are gone. `config:104`'s retired-surface
   sentence and `type:35`'s divider note are likewise accurate.

4. **Full wire-surface re-sweep vs current HEAD — no scope creep.**
   `git diff --stat main...HEAD -- 'backend/src/main/scala/com/helio/api/**' 'schemas/**'` = **55
   files**, identical inventory to rounds 1–4. No new routes, no new schema files. This round's own
   delta (`git diff --stat 139bea00..HEAD`) touches exactly two wire files
   (`AssistantProposalToolSchemas.scala` 4 lines, `dashboard-proposal.schema.json` 24 lines); the
   splice-insert fix (`PipelineStepRepository`, `PipelineService`, `PatchSetPreviewProjection`) is
   non-wire. **Confirmed no scope creep.**

5. **`node scripts/check-schema-drift.mjs` fresh:** `EXIT=0`, "60 checked across 46 protocol files",
   "panel-type enums in sync with backend canonical sets (7 surfaces checked)". Green. Still
   structurally blind to `description` strings and `.scala` tool schemas (HEL-926's gap, third
   confirmation).

6. **My own fresh broad sweep** (`grep -rln "DataType\|Metric\b" schemas/ .../protocols/`, 31 hits)
   plus a targeted `metric|chart|timeline|table` description grep across the Claude-facing schemas.
   All hits are either the documented `dataType`/`dataTypeId` wire-NAMING exemptions (design.md),
   correct history-describing comments (`panel.schema.json:102`, `patch-set.schema.json:5` — both
   verified accurate), or finding A below.

### Verdict: CONFIRM

Both round-4 change requests are done and independently verified against ground truth, the wire
diff is unchanged in scope, and the mechanical gate is green. Nothing found this round carries a
**design question**, and there is **no scope creep** — so per the coordinator's standing
instruction, the residual items below are the "ordinary, smaller, more contained documentation
defect" class the orchestrator is authorized to close out directly without a further round.

### Residual defects — authorized for direct close-out (no design question, no new scope)

**A. `schemas/authoring/combined-proposal.schema.json:5` — one stale sentinel-rule sentence.**
The top-level `description` still says the `config.dataTypeId` sentinel slot is blessed "only for a
panel type **outside metric/chart/table/collection/timeline**". Ground truth is
`CombinedProposalService.configIsBlessed:122-125`: the gate is
`!DashboardProposalService.DataPanelKinds.contains(panel.type)`, and `DataPanelKinds` is now
`Set("output")`. Correct text: "outside `output`" (i.e. text/markdown/image). Same class as round 4's
CR 2, one string, in a live Claude-facing schema.

**B. `dashboard-proposal.schema.json` — 3 remaining strings assert a text/markdown data binding that
no longer exists.** Ground truth: `TextPanel.scala:14` / `MarkdownPanel.scala:14` are now
`case class …PanelConfig(content: String)` — no `dataTypeId`, no `fieldMapping` — and
`ProposalPanelSupport.bindingCandidate:101-109` removed the `config.dataTypeId` fallback outright
(`validateDataTypeBinding:95` returns `Right(())` unconditionally for non-`output` kinds).
  - `:39` "Optional for text/markdown panels (a real dataTypeId binding, HEL-244)" — false, and it
    disagrees with the Scala mirror's `:55-57` ("Omitted for text/markdown/image"), which is correct.
  - `:47` `fieldMapping` "For text/markdown panels, binds to a data column when the panel also
    carries a dataTypeId" — false.
  - `:104` `config` "text/markdown {content, dataTypeId, fieldMapping}" and "A text/markdown
    config.dataTypeId is a real binding attempt (HEL-244) and is validated against the same
    pipeline-only rule — a source-companion or non-owned DataType is rejected (400); a valid
    pipeline-output DataType succeeds" — false on both halves; that path is now silently inert.

**C. `ProposalPanelSupport.scala:156-157` — an in-file self-contradiction.** The comment says
`dataTypeId`/`fieldMapping` are "still meaningful for Text/Markdown's own binding (design.md:
TextPanel carries dataTypeId/fieldMapping exactly like MarkdownPanel)", which contradicts the same
file's `:102-107` and the current `TextPanelConfig`/`MarkdownPanelConfig`. One comment edit.

**D. Round-4 CR 1's second half was not done: `AssistantProposalToolSchemasSpec` still has no
`PanelType.fromString` / `validatePanel` pin** (`grep -n "validatePanel|PanelType|fromString"` on the
spec returns nothing). The pin remains decode-only, so `ProposalPanel.type` being a plain `String`
means a stale kind literal in an example still cannot turn the suite red. This is exactly why the
class recurred across three rounds. Worth adding here or filing alongside HEL-926.

### Non-blocking notes

- `dashboard-proposal.schema.json:64` documents `orientation` "for divider panels" while `divider` is
  excluded from `:34`'s enum — consistent with `:35`'s explicit note, so benign, but the property is
  unreachable through this schema.
- `scripts/concertino/next-report-number.sh` still does not model this change's multi-axis
  `final-skeptic-<axis>-<n>` convention (round 4's note). Orchestrator supplied the path explicitly;
  `ls` confirmed no `-5` file existed, so no collision risk. Worth reconciling upstream in Concertino.
