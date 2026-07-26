## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **No backend fieldMapping slot/column-type validation today** — confirmed.
   `ChartPanelConfig.decodeInternal` (`backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala:202-211`)
   decodes `fieldMapping` as an opaque `JsObject` with no key/shape validation; same pattern in
   `MetricPanelConfig.decode` (`MetricPanel.scala:23-30`). design.md's cited line numbers
   (`ChartPanel.scala:208`, `MetricPanel.scala:32`) land exactly on the `fieldMapping` decode lines. Matches
   the design's context claim.

2. **V41 companion-rejection rule** — confirmed the mechanism (`PanelService.scala:297-309`
   `rejectCompanionBinding`, triggers on `dt.sourceId.isDefined`, all five kinds), but the design's claim that
   its proposed `reason: "not-pipeline-output"` is "the literal V41 message, not a paraphrase" is **false** —
   see Change Request 2 below.

3. **HEL-292 aggregation removes the row-count gate for metric** — confirmed. `usePanelData.ts:156-187`
   shows `metricAggregation` (when set) computes `computeAggregate(rows, ...)` over the full row set and
   overrides `mapped.value`, independent of `fieldMapping`. `getChartAggregation`/`getMetricAggregation`
   exist in `panelNarrowing.ts:127-134`. Matches the design's D3 claim that metric/chart/collection
   eligibility should not gate on row count.

4. **HEL-624 chart aggregation gated to bar/line** — confirmed verbatim:
   `frontend/src/features/panels/ui/ChartPanel.tsx:202`
   `const useAggregate = chartAggregate != null && (chartType === "bar" || chartType === "line");`.
   D4's claim that the response avoids the issue "by omission" (never enumerating chart sub-shapes or
   advertising aggregation capability) is consistent with the non-goals stated in proposal.md/ticket.md.

5. **HEL-399 `panelShapes.ts` vs this ticket** — confirmed D1's characterization is accurate.
   `frontend/src/features/panels/state/panelShapes.ts` is a curated `PanelType → shape-catalog-id[]` map
   used only to filter the pipeline-shape catalog during panel *creation* (`metric: ["single-row"]` etc.),
   genuinely a different question from "what can an existing DataType structurally bind to." No overlap
   hand-waved away.

6. **Multi-tenancy 404 pattern** — confirmed exactly. `DataTypeService.findById`
   (`DataTypeService.scala:25-29`) maps `dataTypeRepo.findByIdOwned(id, user)`'s `None` to
   `ServiceError.NotFound`; `DataTypeRepository.findByIdOwned` (`DataTypeRepository.scala:78-83`) filters by
   `r.id === id.value && r.ownerId === ownerUuid`, so cross-tenant existence is indistinguishable from
   nonexistence. D5's proposed reuse is real and correctly described.

7. **Scope discipline** — grepped ticket.md/proposal.md/design.md for HEL-364/370/366/367/368: only
   referenced as explicitly out-of-scope/queued, never absorbed into tasks.md. Confirmed clean.

8. **D6 route placement** — confirmed `DataTypeRoutes.scala:25-57` already hosts `.../rows` and
   `.../validate-expression` sub-paths under `pathPrefix("types")`; the plan to add a third sibling path
   there rather than a new router file is consistent with the existing pattern.

### Verdict: REFUTE

### Change Requests

1. **The D2 "one source of truth" cross-check plan is not implementable as stated against the real
   `frontend/src/features/panels/state/panelSlots.ts`, and the AC/spec.md requirement built on it
   ("Slot definitions share one source of truth" / task 5.6) currently promises something the file's actual
   shape can't deliver.** Concretely (all read from the file):
   - `panelSlots.ts`'s `PanelSlot` type is `{key: string; label: string}` — there is **no required/optional
     distinction** anywhere in the file. Design.md D2 says the test "asserts the required-slot sets match,"
     but there's no stated rule for deriving "required" from a flat key list.
   - `panelSlots.ts`'s `chart` entry is `[xAxis, yAxis, series]` — it **omits `annotation` entirely**, even
     though `annotation` is a real, currently-working, currently-documented optional chart `fieldMapping`
     slot: `schemas/panel.schema.json:95` and `:102-104` document `fieldMapping.annotation` as a reserved
     slot; `helio-mcp/src/tools/write.ts:439-440` documents `chart → {xAxis, yAxis, series?, annotation?}`;
     and `frontend/src/features/panels/ui/editors/BindingEditor.tsx:246-255` actually merges an
     `annotation` key into the bind-time `fieldMapping` payload. `panelSlots.ts` is demonstrably stale
     relative to real behavior for this slot — design.md D2's eligibility table (line 45,
     "...xAxis,series,annotation,event,content...") itself lists `annotation` as a real slot, which
     directly conflicts with what its own proposed cross-check fixture contains.
   - `panelSlots.ts`'s `collection` entry is `[]` by the file's own design (its comment states collection
     derives shared item slots from `PANEL_SLOTS[baseType]` at runtime) — a literal "required-slot-set
     match" against the raw parsed file would treat collection's required set as empty, directly
     contradicting D3's own claim that collection requires `value`. Design.md does not mention the
     baseType-indirection needed to test this correctly.
   Required: design.md must specify exactly what the fixture-parse/cross-check compares — how "required" is
   derived from a file with no required/optional field, how collection's baseType-indirected slots are
   validated, and how the `annotation` gap is resolved (either reconcile `panelSlots.ts` in this change,
   which then needs to be added to scope/Impact despite "does not touch frontend," or explicitly narrow the
   cross-check's claims so the AC doesn't promise a match that the current frontend file can't provide).

2. **D3's claim that `reason: "not-pipeline-output"` is "the literal V41 message, not a paraphrase" is
   false and self-contradicting.** The actual V41 rejection in `PanelService.scala:305-306`
   (`rejectCompanionBinding`) emits `ServiceError.BadRequest("Panels can only bind to pipeline-output data
   types")` — that sentence is the literal message; `"not-pipeline-output"` is a paraphrase/slug of it, not
   an exact quote. This isn't fatal to the design's intent (a stable machine-readable reason code is
   arguably better than string-matching a human sentence), but the design document's own stated rationale
   for the choice is factually wrong, and an implementer following the "literal, not paraphrase" instruction
   literally would introduce a second mismatched copy of the V41 text. Required: correct D3 to either (a)
   use the actual literal string, or (b) explicitly state the reason is an intentionally distinct
   machine-readable code (not a literal quote) so a future reader isn't misled into re-deriving/duplicating
   the human-facing error text.

### Non-blocking notes

- `DataType.computedFields` (`model.scala:513`) is not addressed anywhere in design.md's column-eligibility
  discussion. If computed fields are actually selectable via `fieldMapping` at bind time (unclear from the
  domain code alone), the capability response's "eligible columns per slot" should probably include them;
  worth a one-line clarification in design.md's D2/D3 even if the answer is "out of scope for v1."
