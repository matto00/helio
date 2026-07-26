## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

1. **Round-2 item 1 (CollectionEditor.tsx false "live derivation" claim) is now fixed correctly.** Read
   `frontend/src/features/panels/ui/editors/CollectionEditor.tsx` in full. Confirmed: no `PANEL_SLOTS`
   import anywhere in the file (only `DataTypePicker`, `BoundOrLiteralField`, etc. are imported); line 35
   is a doc comment only ("shared metric item slots derived from `PANEL_SLOTS.metric`"); the actual fields
   are hardcoded independently — `initialValueField = initialFieldMapping.value` /
   `initialLabelField = initialFieldMapping.label` / `initialUnitField = initialFieldMapping.unit` at
   lines 55-57, and the outgoing `fieldMapping` is built with literal `value`/`label`/`unit` keys at lines
   113-116 (`outgoingFieldMapping`, `value:`/`label:`/`unit:` object-spread keys). design.md's current D2
   text (lines 55-64) and spec.md's requirement text (lines 48-51) now correctly describe this as "the doc
   comment and the real map agree today by coincidence, not by wiring" and cite the cross-check target as
   "the literal hardcoded key set `{value, label, unit}` transcribed from `CollectionEditor.tsx:55-57`, not
   `PANEL_SLOTS.metric`" — this matches the file exactly, including the specific line numbers cited. Fixed.

2. **Round-2 item 2 (proposal.md/design.md route-placement contradiction) is now fixed.** proposal.md's
   Impact section (line 40) now reads "a new route added to the existing `DataTypeRoutes.scala` (see
   design.md D6 — folded into the existing DataType-scoped router rather than a new route file, matching
   its `/rows` and `/validate-expression` sub-paths)" — matches design.md D6/Planner Notes and tasks.md 2.2
   ("Add `GET :id/panel-capabilities` under the existing `pathPrefix("types")` block in
   `DataTypeRoutes.scala`"). All three artifacts now agree. Fixed.

3. **V41 literal string** — re-confirmed verbatim in `backend/src/main/scala/com/helio/services/PanelService.scala:305-306`
   (`rejectCompanionBinding`): `Left(ServiceError.BadRequest("Panels can only bind to pipeline-output data types"))`.
   design.md D3 quotes this exact string and cites line 306 correctly.

4. **Multi-tenancy 404-not-403 pattern** — re-confirmed against current code.
   `DataTypeService.findById` (`DataTypeService.scala:25-28`) maps `dataTypeRepo.findByIdOwned(id, user)`'s
   `None` to `ServiceError.NotFound("DataType not found")`. `DataTypeRoutes.scala` shows the existing
   `.../rows` and `.../validate-expression` sub-paths hanging off `pathPrefix("types")` exactly as D6
   describes, and D5's proposed reuse of `findByIdOwned` is the same pattern `listRows`/`findById` already
   use in `DataTypeService.scala:25-35`.

5. **HEL-292 aggregation / no row-count gate** — design.md D3's claim ("metric/collection require ≥1
   numeric column ... no row-count gate") is unchanged from rounds 1-2, which already verified this against
   `usePanelData.ts:156-187`. No new contradiction found on this pass.

6. **HEL-624 handled by omission** — spec.md's response requirements (lines 1-31) never mention
   aggregation or chart sub-shape/pie/scatter at all; design.md D4 states the response reports `chart` as
   one undifferentiated bindable kind and never emits an aggregation-capability claim. Confirmed the
   spec.md scenarios don't promise anything HEL-624 would falsify.

7. **`DataFieldType` matches the column-eligibility claims.** `backend/src/main/scala/com/helio/domain/model.scala:445-458`:
   `IntegerType`/`FloatType` (numeric), `TimestampType` (orderable) exist as claimed for D2's
   `value`/`yAxis` → numeric, `time` → orderable rules.

8. **Scope discipline** — re-grepped all planning docs for HEL-364/370/366/367/368: only appear in
   ticket.md/proposal.md/design.md as explicitly out-of-scope/queued dependencies, never in tasks.md.
   Confirmed clean.

9. **Worktree state** — `git status --short` is clean; `git diff main...HEAD --stat` shows only the 9
   planning-artifact files (ticket/proposal/design/spec/tasks/workflow-state/skeptic reports +
   `.openspec.yaml`) across 3 commits — no premature implementation exists ahead of the design gate.

### Verdict: CONFIRM

Both round-2 REFUTE items are genuinely fixed against the real files, not just reworded. My fresh pass over
the rest of the design (V41 mechanism, HEL-292, HEL-624-by-omission, D1 HEL-399 reconciliation, D5
multi-tenancy, D6 route placement, scope discipline) found no new substantive defect — all claims trace to
real code at the cited lines.

### Non-blocking notes

- `DataType.computedFields` (flagged non-blocking in round 1, still unaddressed) remains an open minor
  question for the column-eligibility discussion — not blocking, implementer can resolve at execution time
  or explicitly scope it out in a one-line addition.
