## Skeptic Report — final gate (round 1, axis: schema/OpenSpec consistency)

Ticket HEL-904 · change `outputs-model-migration` · HEAD `dc95ccc4`.
Axis-scoped: schema/OpenSpec consistency (tasks 5.1–5.7) only. Migration
correctness, deletion-sweep completeness, and the wire-contract diff are other
skeptics' axes and are deliberately not assessed here.

Posture note: I treated a green `check-schema-drift.mjs` as worthless until
proven load-bearing, per the briefing's credential-leak-gate precedent. The
central question was whether the gate is green because things are in sync or
because a check stopped checking. I answered it by mutation, not by reading.

### What I verified (with evidence)

**1. `check-schema-drift.mjs` is green AND still genuinely checks all five
Gate-Chain items.**

Fresh run:
```
schemas in sync with JsonProtocols (60 checked across 46 protocol files)
panel-type enums in sync with backend canonical sets (7 surfaces checked)
EXIT=0
```
Read the script end to end. All five design.md Gate-Chain items landed:

- (1) Arm-count guard: `:210` reads `if (canonicalPanelTypes.length < 5)` with
  message `(expected >= 5)` — the stale `< 8` is gone. `PanelType.fromString`
  (`backend/src/main/scala/com/helio/domain/model/model.scala:133-137`) has
  exactly 5 arms: `text, markdown, image, divider, output`.
- (2) `extractBetween` markers `"def fromString(s: String)"` /
  `"def asString(t: PanelType)"` both resolve in the current `model.scala`
  (confirmed by locating the file via the marker itself). `PanelType` was not
  renamed, so no marker update was required.
- (3) The three `panelTypeSurfaces` JSON pointers read
  `["properties","type","enum"]`, NOT `.kind.enum`. **This is correct, and I
  verified it rather than assuming either way** — the briefing flagged a real
  back-and-forth. Ground truth: `PanelProtocol`'s case classes still carry a
  backtick-quoted `` `type` `` field, and the Scala call sites still read
  `panel.`type`` (`ProposalPanelSupport.scala:35`,
  `CombinedProposalService.scala:123`). The round-3 `kind` rename premise never
  landed at the wire level; the script tracks reality, not the stale plan. This
  is documented honestly in task 5.2/5.4(c), not silently.
- (4) `dashboard-proposal.schema.json` `$defs.ProposalPanel.properties.type.enum`
  = `['text','markdown','image','output']` — the `agentFacingPanelTypes`
  carve-out (canonical minus `divider`). Correct.
- (5) The two `dataPanelTypeSurfaces` arrays are checked against
  `canonicalDataPanelKinds`, which the script **extracts live** from
  `DashboardProposalService.scala` rather than hardcoding.
  `DashboardProposalService.scala:159` reads
  `private[services] val DataPanelKinds: Set[String] = Set("output")` — the
  validation-inversion FIX, not the buggy six-visualization-kind retarget.
  Both mirrors follow: `proposalValidation.ts:20` and `ProposalReview.tsx:30`
  are each `new Set(["output"])`.

**2. The gate is load-bearing — proven by mutation, not by inspection.**
Four independent mutations, each restored afterward; baseline re-confirmed green
and the working tree left clean:

| Mutation | Result |
|---|---|
| Drop `output` from `panel.schema.json` `type.enum` | exit=1, `missing: output` |
| `proposalValidation.ts` `DATA_PANEL_TYPES` → `["chart"]` | exit=1, `missing: output / unexpected: chart` |
| `DataPanelKinds` → `Set("metric","chart")` (the inversion bug) | exit=1, `missing: metric, chart / unexpected: output` |
| Rename `type`→`kind` in `panel.schema.json` (pointer staleness) | exit=1, throws at `:249` |

`getEnumAt` and `extractBetween` both **throw** on a missing node/marker rather
than skipping — the script is fail-closed, so a silently-removed check would
surface as an error, not a pass. The third mutation specifically re-creates the
exact bug design.md item 5 was written to prevent, and the gate catches it.

**3. Task 5.1 — deletions/move.** `schemas/metrics/` and `schemas/data-types/`
are both absent (`ls`: No such file or directory). `data-type-assertion-status`
is present as `schemas/outputs/output-assertion-status.schema.json` with its
`$id` correctly updated to the new path.

**4. Task 5.2 — panel schema reshape.** `panel.schema.json`'s `$defs` are
exactly `[DividerConfig, ImageConfig, MarkdownConfig, OutputConfig, TextConfig]`
— the 5-kind placement model; the five retired bound configs are gone. All four
of `bound-panel-request`, `bound-panel-response`, `panel-capabilities-response`,
`panel-query` confirmed absent from `schemas/panels/`.

**5. Task 5.3 — alerts.** `grep` for `targetDataTypeId|dataTypeId|metricId`
across `schemas/alerts/` returns **zero** hits; `targetOutputId` is present in
`alert-rule`, `create-alert-rule-request`, and `alert-event`.

**6. Task 5.7.** `helio-mcp/src/tools/proposal.ts:28` reads
`export const PANEL_TYPES = ["text", "markdown", "image", "output"] as const;`
— the correct `agentFacingKinds` set, not the stale six visualization kinds.

**7. OpenSpec gates, fresh.** `npm run check:openspec` → `openspec/ is clean`.
`npm run check:openspec:selftest` → `17 passed, 0 failed, 17 total`.
`openspec validate outputs-model-migration --type change --strict` →
`Change 'outputs-model-migration' is valid` (all 71 deltas).

**8. The 115-file partition — re-derived exhaustively, not sampled.**
`grep -rl "DataType\|Metric" openspec/specs | wc -l` → **115**; 115 distinct
capabilities. `specs/` contains **71** delta dirs. I verified the full partition
mechanically rather than checking the requested 15–20 sample:

- Zero unlisted survivors: every one of the 115 capabilities is named in
  `openspec-coverage-checklist.md` (scripted check, missing count = **0**).
- Deferred buckets parse to exactly **50** real capabilities (9 + 18 + 22 + 1),
  every one a real dir under `openspec/specs/`.
- **Zero contradictions**: `comm -12 deferred deltas` is empty — no deferred
  capability also carries a delta.
- `115 − 50 = 65`, and **all 65 have deltas** (`comm -23` mismatch set empty).
- The 6 delta dirs not matched by the grep are genuinely new/unmatched
  capabilities: `node-snapshot-persistence`, `output-panel-placement`,
  `outputs-model`, `panel-batch-update`, `pipeline-step-tree`,
  `rls-policy-guard`. `65 + 6 = 71` deltas. The partition reconciles exactly.
- `external-run-hooks` (the one execution history records as initially
  unclassified) **is** now correctly classified as covered — checklist lines 4
  and 89 both record the cycle-29 correction, and it carries a delta.
- Spot-checked classification quality: `metric-crud-api`,
  `metric-usage-governance`, `bound-panel-composition` are delta'd here
  (backend surfaces — correct); `datasource-edit-delete`, `nav-section-registry`
  are deferred to HEL-909 (UI surfaces — correct).

**9. `check:scala-quality`** → `Scala code-quality check: clean (130 soft
warning(s))`. No hard violations, no inline FQNs; all 130 are pre-existing
test-file line-budget soft warnings.

**10. Task 5.5's framing is accurate — archive has NOT run early.**
`git diff --stat main...HEAD -- openspec/specs` is **empty** — `openspec/specs`
is untouched by this branch. Task 5.5 is correctly left `[ ]` unchecked. No
archive dir entry for this change. I initially flagged `panel-batch-update` and
`rls-policy-guard` as possibly pre-applied, then re-derived: both are
*pre-existing* capabilities being MODIFIED (their deltas open with
`## MODIFIED Requirements`), their live specs contain zero `Output`/`outputId`
mentions and were last touched by unrelated old commits (HEL-362, HEL-277).
That was my own heuristic's false positive, not a defect — reporting it as one
would have been wrong.

**11. No dangling `$ref`s.** My first crude resolver reported 6; on proper
verification all 6 resolve (the 5 `panel.schema.json#/$defs/*Config` targets all
exist, as does `dashboard-proposal.schema.json#/$defs/ProposalPanel`). Zero real
dangling refs.

### Verdict: CONFIRM

The schema/OpenSpec surface is genuinely coherent. Every one of design.md's five
Gate-Chain items landed in its correct final form — including the two that were
specifically corrected during design review (`DataPanelKinds` → `Set("output")`
rather than the inverting visualization-kind set, and the `type`-vs-`kind`
pointer question resolved to match actual wire reality). The drift gate is green
because the surfaces are in sync, not because a check was removed: four
mutations covering all three check families each drive it red, and both
extraction helpers are fail-closed. The 115-file OpenSpec partition is exact,
disjoint, and complete, verified by set operations rather than by trusting the
checklist's own prose.

### Non-blocking notes

1. `schemas/outputs/output-assertion-status.schema.json` still names its
   property `dataTypeId` (required) and its description still references "the
   DataType's owning pipeline" and `GET /api/types/:id/assertion-status`. This
   is a deliberate, documented scope decision in task 5.1 ("moving," not a
   content reshape) and stays drift-green because the backing
   `AssertionStatusResponse` case class is unchanged — which task 5.1 also
   records as now-dead code with zero constructor call sites. Worth folding into
   whichever P-ticket reshapes the Outputs response surface; not a P1.1 defect.
2. The checklist's "Partition proof" arithmetic literally sums to 116, not 115.
   The document self-documents this looseness and directs the reader to the
   exact claim ("zero unlisted survivors"), which I independently reproduced.
   Tightening the subtotals would remove a distracting inconsistency.
3. The arm-count guard uses `< 5` where design.md offered `!== 5` as the tighter
   option. `< 5` will not catch an accidentally *added* sixth arm. Given the
   kind set is now closed and small, `!== 5` would be a slightly stronger
   invariant. Cosmetic.
4. Residual `DataType`/`Metric` prose survives in descriptions of
   `schemas/patch-sets/*`, `schemas/pipelines/pipeline-proposal*`,
   `schemas/authoring/*`, and `schemas/dashboards/dashboard-proposal.schema.json`.
   These are the deferred P-ticket-owned surfaces and are outside 5.1–5.7's
   stated scope, but they are the residue a later reader is most likely to
   mistake for live contract.
