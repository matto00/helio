## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

**Round-2 CR1 (D5 targeted the dead single-PATCH path, missed the live batch path) — now genuinely resolved, not just re-worded.**

I re-read design.md D5, tasks.md 1.3/1.4, the `panel-appearance-settings` spec delta, and re-derived
the claims from the actual backend code (cold, not trusting the artifacts):

- `backend/src/main/scala/com/helio/services/PanelService.scala:176-214` (`batchUpdate`) — confirmed
  the exact call site design targets: `validateBatchTypeMatch(items.zip(panels))` already runs at
  line 202, immediately before `panelRepo.batchUpdate(items, now)` at line 206, inside the single
  `Future` chain and *before* the transactional DBIO write. This is precisely the location D5/task
  1.4 propose to add a parallel `validateChartType` step ("pre-DBIO ... before building the single
  `transactionally` action"). The pattern already exists in this file for a structurally identical
  per-item validation (`validateBatchTypeMatch`), so the plan is not hypothetical — it reuses an
  established idiom in the same function.
- `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala:67-73` (`PanelBatchItem`) and
  `:10-14` (`PanelAppearancePayload`) — confirmed `item.appearance: Option[PanelAppearancePayload]`
  and `PanelAppearancePayload.chart: Option[ChartAppearance]`, so
  `item.appearance.flatMap(_.chart).flatMap(_.chartType)` is a real, available extraction — the
  per-item chartType check design proposes is mechanically constructible with existing types, no new
  shape needed.
- `backend/src/main/scala/com/helio/domain/model.scala:101-109` — `ChartAppearance.chartType:
  Option[String]`, `PanelAppearance.chart: Option[ChartAppearance]` — confirms the field path used
  throughout design/spec (`appearance.chart.chartType`) is accurate to the domain model.
- `backend/src/main/scala/com/helio/api/RequestValidation.scala:83-88` (`validateChartType`) —
  confirmed signature `Option[String] => Either[String, Option[String]]`, callable per-item with no
  DB lookup required — validation can genuinely run before the transactional write, as claimed.
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:21-46` (`resolvePatch`) —
  re-confirmed line 38 (`chart = p.chart`, no validation) still matches D1/D5's premise for the
  single-item PATCH path task 1.3 also patches, for parity.
- `schemas/create-panel-request.schema.json` — confirmed `additionalProperties: false` at root and no
  `appearance` property currently exists, so task 1.5 (schema update) is a real, required task, not
  redundant.
- `frontend/src/features/panels/state/panelPayloads.ts:33-56` (`buildCreatePanelBody`,
  `seedCreateConfig`) — confirmed current state matches design's Context section exactly:
  `CreatePanelBody` has no `appearance` field; the chart/metric arms of `seedCreateConfig` seed
  nothing beyond `dataTypeId ?? ""`; only the image arm honors `typeConfig`. Matches D1/D2's premise
  verbatim.

**Conclusion on round-2 CR1:** design chose option (a) from my round-2 CR (extend D5 to cover the
batch path with a corresponding task and test), not the weaker option (b) narrowing the claim. The
revision now names all three appearance-write paths explicitly in D5, task 1.3 (single PATCH), task
1.4 (batch, pre-DBIO, targeting the correct file — `PanelService.batchUpdate`, not the dead
`resolvePatch`-only fix from round 2), and the `panel-appearance-settings` spec delta (which now
states "on all three panel appearance write paths" and includes a no-partial-write batch scenario).
This is accurate to the codebase and closes the gap the round-2 report identified.

### New-issue check (round-3 revision only)

- No placeholders/TBDs introduced in the new tasks/design text.
- Task 1.4's placement ("pre-DBIO ... before building the single `transactionally` action") is
  consistent with where `validateBatchTypeMatch` already runs in the same function — not a made-up
  location.
- Spec scenarios (batch invalid → 400 + no partial write; batch valid → persists) map 1:1 to task
  3.2's ScalaTest list; no orphaned requirement or untested scenario found.
- No scope creep: D5's fix stays confined to validation (reject invalid values), doesn't touch
  `PanelMutationRepository.batchUpdate`'s merge logic itself, consistent with "small, low-risk" claim.
- AC trace: all three ticket ACs remain covered by D1/D2 (chart type + typeConfig fields), D6/tasks
  3.1 (payload tests), D4 (copy fix) — unchanged from round 2, still intact after this revision.

### Verdict: CONFIRM

### Non-blocking notes

- Design is now internally consistent across proposal.md, design.md, tasks.md, and all three spec
  deltas — each independently names the same three write paths and the same validation approach,
  which is good hygiene for the eventual implementer.
- Minor, non-blocking: task 1.4's wording ("in `PanelService.batchUpdate`") doesn't pin an exact line
  number, but the design section's placement instruction ("before building the single
  `transactionally` action") is unambiguous enough for a competent implementer given the existing
  `validateBatchTypeMatch` precedent in the same function.
