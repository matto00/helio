## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all 14 `specs/*/spec.md` deltas in the change dir.
- Read the source-of-truth spec `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`, lines 65-66, 76, 91, 164-168 (Dashboard UX, decisions 8/11/15; the Panel/Output/content-panel definitions).
- `premise-validation.md` is **not present** in this worktree (`find .concertino/runs -type f` → empty). I therefore verified the HEL-937 absorption claims directly against the tree rather than against that artifact.
- **Re-ran the ticket's own AC grep myself**: `grep -rln "dataTypeId\|metricId\|/registry\|/metrics\|fetchDataTypes\|dataTypesSlice\|metricsSlice" frontend/src | wc -l` → **134**. design.md's asserted count is correct.
- Diffed the 134 matched paths against the union of design.md's Axis A/B/C/D enumerations, file by file.
- Read `TextContentEditor.tsx`, `MarkdownEditor.tsx`, and all their importers (`grep -rn "TextContentEditor\|MarkdownEditor"`) to test the flagged split risk.
- Grepped the actual match lines in the un-enumerated files to classify them (real reference vs. comment).
- Read the six existing `openspec/specs/*` capabilities I suspected were contradicted with no delta.

**Positive findings (things that hold up):** the count is real; the axis-based approach is the right method and is a genuine improvement over file-by-file discovery; decision 15 is specified correctly and unusually well (`specs/output-picker/spec.md` mandates no `layout` in the POST and explicitly forbids optimistic/frontend-computed layout, so the "no frontend copy of the constants" AC is covered); the removal-with-Reason/Migration style of the 14 deltas is high quality; the "prove each rewritten test red first" discipline is stated in ticket, design, and tasks consistently.

### Verdict: REFUTE

The method is sound but the enumeration — the one artifact whose entire purpose is completeness — is **not complete**, and three of the gaps are load-bearing.

### Change Requests

1. **Axis enumeration misses ~13 matched files, including two central ones.** Diffing my 134-file grep against design.md's own Axis A-D lists, these matches are in **no** axis:
   `features/panels/services/panelService.ts`, `features/panels/hooks/usePanelData.test.ts`,
   `features/panels/ui/PanelCardBody.predispatch.test.tsx`, `features/panels/ui/grid/MobilePanelStack.test.tsx`,
   `features/panels/services/…`; `features/pipelines/state/pipelinesSlice.ts`,
   `features/pipelines/ui/outputEditor/outputConfigTypes.ts`, `features/pipelines/ui/outputEditor/useOutputTableColumns.ts`,
   `features/pipelines/ui/PipelineDetailPage.test.tsx`; `features/patchSets/state/patchSetsSlice.test.ts`,
   `features/proposals/state/combinedProposalsSlice.test.ts`, `features/settings/state/settingsSlice.test.ts`,
   `features/sources/ui/SourceDetailPanel.test.tsx`, `shared/chrome/SaveStateIndicator.test.tsx`, `hooks/README.md`.
   The worst omission is **`features/panels/services/panelService.ts`** — it carries `dataTypeId?: string` (:46, :58) and `metricId?: string | null` (:134, :150) as live API-payload parameters. That is the panel service layer, arguably the single most central file in this migration, and no axis names it. Add it to Axis C explicitly with its own task. Same for `usePanelData.test.ts`/`PanelCardBody.predispatch.test.tsx`, which encode `config.dataTypeId` fixtures throughout.
   Also add the test-sibling rule the enumeration currently applies inconsistently: `SaveStateIndicator.test.tsx:8` and `PipelineDetailPage.test.tsx:12` import `dataTypesReducer` from the slice Axis A deletes, and `SourceDetailPanel.test.tsx:3` imports `fetchDataTypes` from the service Axis A deletes — these will break at deletion time and are in no axis.

2. **The AC as written is unsatisfiable without gutting correct comments — design.md must decide this, not the executor.** Four of the un-enumerated matches are matches *inside deliberate explanatory comments written by P1.5*, e.g. `outputConfigTypes.ts:3` ("carry no `dataTypeId` — a bound field is just a column name resolved…"), `useOutputTableColumns.ts:4` ("bound to `panel.config.dataTypeId` -- not applicable here, since an Output…"), `pipelinesSlice.ts:111,320` ("mirrors `dataTypesSlice`'s 409-branching precedent"), `MobilePanelStack.test.tsx:202`. A literal reading of AC "grep returns nothing" forces deletion of accurate documentation on the *surviving* surface. State the resolution in design.md: either scope the final grep to non-comment code (and give the exact command the executor will run at task 11.1), or explicitly sanction rewording those four comments. Do not leave this to be discovered at the final gate.

3. **The `TextContentEditor`/`MarkdownEditor` risk is real, but design.md defers a question the source-of-truth spec has already answered.** Verified real: both files import `fetchDataTypes`/`selectPipelineOutputDataTypes` from `dataTypesSlice` and gate a `DataTypePicker` behind a Source/Static mode toggle (`TextContentEditor.tsx:13-24, 34-40, 106-123`; `MarkdownEditor.tsx:13, 32-38, 101-118`). But the remodel spec line 76 already rules: *"today's data-bound text **and** markdown panels … data-bound text panels migrate to `markdown` Outputs. Content panels (literal text, literal markdown, image, divider) remain dashboard-native and carry no Output."* So the answer is not "confirm which parts survive" — it is **strip Source/bound mode entirely; the surviving editor is literal-only.** Say that in design.md, cite line 76, and name the dependents the current text omits: `useBoundOrLiteralState.ts`, `BoundOrLiteralField.tsx`, `fieldOptions.ts`, and `updatePanelTextBinding` in `panelsSlice` (all reachable only from the retired bound path). As written, "may need a split rather than a deletion" is exactly the deferred decision that produces a wrong executor call.

4. **Five existing capability specs are directly contradicted by this change and have no delta.** The 14 deltas present are good, but `openspec/specs/` still contains:
   - `frontend-panel-creation` — mandates the create request include `type` and, for data-bound types, "`dataTypeId` selected in the DataType picker step". Directly contradicted by the decision-15 payload `{dashboardId, kind:"output", outputId, title?}`.
   - `panel-starter-templates` — "Each panel type has 2-3 hardcoded starter templates … rendered for the template-select step". `panelTemplates.ts` and `TemplateSelectStep` are both deleted by this ticket.
   - `panel-type-picker-cards` — scoped to "the panel creation modal … at the type-select step", which ceases to exist. (Note `panel-type-selector` has a delta; this is a *different* capability and does not.)
   - `text-panel-content-source` and `markdown-panel-content-source` — both define the Source/Static DataType-bound content mode retired by CR 3.
   - `panel-config-field-or-literal-pattern` — defines the "bind to a DataType field" toggle pattern itself.
   Add REMOVED/MODIFIED deltas for each (or, per item, state in design.md why it survives unchanged). Without this, `check:openspec` green means nothing about contract accuracy.

5. **Ticket AC names a "type registry" OpenSpec delta that has no target — resolve it explicitly.** There is no `data-type`/`type-registry` frontend capability under `openspec/specs/`; the only near-match is `acl-resource-type-registry`, which is backend ACL and out of this ticket's frontend scope. Record in design.md that this AC clause is satisfied vacuously (no such capability exists) so the evaluator does not chase a phantom deliverable — or name the real capability if it is `acl-resource-type-registry` after all.

6. **HEL-937 absorption under-specifies the target data source.** Both ticket.md and design.md say `PanelDetailModal` is re-pointed at "capabilities-at-node (**or an equivalent Output-sheet-derived data source**)". For a rebuilt Panel sheet whose entire content is title/appearance/Output link/Swap output/placement count, `GET /api/pipelines/:id/capabilities` is not obviously needed at all — the sheet needs the panel's `outputId`, the Output's pipeline id for the link, and `GET /api/outputs/:id/panels` for the count. Pick one and state it, with the endpoints the sheet actually calls. As written the executor must re-derive the sheet's data contract, which is precisely the deferred-decision failure mode this design gate exists to catch.

### Non-blocking notes

- `premise-validation.md` is absent from this worktree; the orchestrator's brief cites it as the record of the human ruling. Worth persisting into `.concertino/runs/HEL-909/evidence/` so the ruling survives worktree teardown.
- design.md's instruction to *verify* rather than trust the `sections.ts`-cascade header comment (Nav section) and to check `useChartDisplayState`/`useTableDisplayState` ownership before deleting are both good calls — keep them.
- The "134 vs the human's 37" reconciliation in design.md is honest and correct; 37 is the `dataTypesSlice`/`/api/types` subset.
