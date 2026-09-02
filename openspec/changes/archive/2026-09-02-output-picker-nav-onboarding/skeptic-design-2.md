## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `skeptic-design-1.md`, then the updated `ticket.md`, `design.md`, `tasks.md` and all 20 `specs/*/spec.md` deltas.
- **Re-ran the AC grep myself** (`grep -rln "dataTypeId\|metricId\|/registry\|/metrics\|fetchDataTypes\|dataTypesSlice\|metricsSlice" frontend/src`) → **134** files, and diffed the full path list against the updated Axis A–D enumeration + the new "Round-1 design-gate revisions" section, file by file. **All 15 previously-unenumerated files are now covered**, including `features/panels/services/panelService.ts` (Axis C, with its :46/:58/:134/:150 line refs — I confirmed those params are real). No file in my 134 is now outside an axis.
- CR3 dependents are **real**, verified by grep: `useBoundOrLiteralState.ts` (imported by `TextContentEditor`, `CollectionEditor`, `BindingEditor`, `ChartDisplayFields`), `BoundOrLiteralField.tsx` (same set), `fieldOptions.ts` (`TimelineEditor:15,147`; a separate same-named prop on `ChartDisplayFields`/`MetricValueEditor` — the design's "check for any literal-only remainder" caveat is warranted), `updatePanelTextBinding` (`panelsSlice.ts:20,196`, `panelThunks.ts:320`, `TextContentEditor.tsx:16,87`).
- CR6 endpoints verified against the live backend, not asserted: `backend/.../api/routes/pipelines/OutputRoutes.scala:51-98` mounts `GET/PATCH/DELETE /api/outputs/:id`, `GET /api/outputs/:id/panels`, `/assertion-status`, `/rows`; `OutputProtocol.scala:18,67` confirms the `:id` response carries `pipelineId`, so the design's link contract is satisfiable. `OutputService.listPanels` (`:194-201`) returns `(panelId, dashboardId)` pairs.
- CR4 spot-check (3 of 6, plus 3 more read in full): every `### Requirement:` header in the `frontend-panel-creation`, `panel-starter-templates`, `panel-type-picker-cards` deltas matches the existing `openspec/specs/*/spec.md` headers **exactly** (`:6/:18/:32`, `:6/:23/:35`, `:7/:49/:58`). Quality is high — `frontend-panel-creation` correctly re-ADDs the two behaviors (refresh-on-success, explicit feedback) that survive the payload change rather than silently dropping them; `markdown-panel-content-source` explicitly lists the three unaffected image/upload requirements. Not rubber-stamped deltas.
- CR5 verified: `ls openspec/specs | grep -i registry` → only `acl-resource-type-registry` / `command-action-registry` / `connector-registry` / `nav-section-registry` / `pipeline-shape-registry`. No frontend type-registry capability exists; the vacuous-satisfaction record is correct.
- **Ran `npx openspec validate output-picker-nav-onboarding --type change` myself** → `Change 'output-picker-nav-onboarding' is valid`, exit 0.

**Round-1 items 1, 2, 4, 5, 6 are genuinely resolved** — verified against ground truth, not accepted as claimed. Item 3's *decision* is resolved; its *contradicting prose* is not.

### Verdict: REFUTE

Two mechanical, stale-text edits only. Nothing substantive remains; this should close in one pass.

### Change Requests

1. **The CR3 decision is contradicted by the text the executor actually works from.** `design.md`'s Axis B still reads verbatim: *"confirm via read which parts of each file are dataType-keyed vs. literal-content before deleting; **may need a split rather than a deletion**"* — the exact sentence round 1 named as "the deferred decision that produces a wrong executor call" — and `tasks.md` **2.5** repeats it: *"Handle the TextContentEditor/MarkdownEditor split (dataType-keyed vs. literal-content) explicitly — do not delete wholesale without confirming which parts survive."* The resolution appears only later, in design.md's revisions section ("strip the Source/bound mode entirely… not 'confirm which parts survive'"), and in task **8.4**. An executor reading 2.5 does the superseded thing. Delete/replace the Axis B caution and rewrite tasks 2.5's last sentence to point at 8.4 and the "TextContentEditor / MarkdownEditor — resolved" section (or merge 2.5's editor handling into 8.4 outright).

2. **`ticket.md`'s acceptance criterion still carries the superseded wording.** The SCOPE EXPANSION section was correctly updated, but the AC bullet is unchanged: *"`PanelDetailModal`'s panel-editing flow is re-pointed at capabilities-at-node (or an equivalent Output-sheet-derived data source)"*. The AC list is what the final gate is checked against; leaving `capabilities-at-node` there invites an evaluator to look for a `GET /api/pipelines/:id/capabilities` call that the design explicitly forbids. Reword that bullet to the resolved contract (`outputId` + `GET /api/outputs/:id` + `GET /api/outputs/:id/panels`, no capabilities call).

### Non-blocking notes

- `GET /api/outputs` (a paginated all-Outputs list) **does exist** — `OutputRoutes.scala:109-124`. design.md's Output picker section leaves it as "or a combined list endpoint if one exists — check `outputsService.ts` first"; naming it now would save the executor a lookup. Not blocking (the per-pipeline route works and grouping is by pipeline anyway).
- "Used on N dashboards": `listPanels` returns one row **per panel placement**, carrying `dashboardId`. Two panels of the same Output on one dashboard would make a raw `length` overcount the dashboard number. Count distinct `dashboardId`s, or say "N panels".
- Axis B's orphan cascade correctly reaches beyond the 134 grep hits (`ChartDisplayFields.tsx`, `ChartAggregationFields.tsx`, `FieldMappingSlots.tsx`, `MetricValueEditor.tsx`, `TableDisplayFields.tsx`, `editorTypes.ts` match no AC term but are reachable only from the retired path). The stated "delete only once `grep -rl` for its own export returns zero importers" rule covers them procedurally — good; no enumeration change needed.
