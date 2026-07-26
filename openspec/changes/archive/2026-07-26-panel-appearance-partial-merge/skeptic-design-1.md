## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **`Option[Option[T]]` precedent is real and matches the description.**
   Read `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala:55-107`. `MetricPanelConfig.Patch` decodes
   directly from the raw `JsObject`, per-field `match { case None => ...; case Some(JsNull) => Some(None); case
   Some(validShape) => Some(Some(v)); case Some(x) => deserializationError(...) }`, and `MetricPanel.applyPatch`
   (`:144-152`) folds absent→keep/null→cleared-default/set→provided. This is exactly the idiom design.md Decision 2
   proposes to mirror for `PanelAppearance.Patch`/`ChartAppearance.Patch`.

2. **Current buggy replace-behavior is real, as described.**
   - `PanelServiceHelpers.normalizeAppearancePayload` (`PanelServiceHelpers.scala:51-61`) builds a fresh
     `PanelAppearance` via `RequestValidation.normalizePanelBackground/Color/Transparency`, all of which
     (`RequestValidation.scala:42-57`) fall back to hardcoded constants (`"transparent"`, `"inherit"`, `0.0`) on
     `None` — confirms "absent field → hardcoded default, not stored value."
   - `PanelPatchApplier.applyAppearance` (`PanelPatchApplier.scala:37-44`) just persists `spec.appearance` verbatim
     — no merge logic there today.
   - `PanelMutationRepository.batchUpdate` (`PanelMutationRepository.scala:84-93`) already does an ad hoc top-level
     merge (`ap.background.getOrElse(current.background)`, ..., `ap.chart.orElse(current.chart)`) — confirms
     design's claim that batch is "narrower — chart is all-or-nothing" while single-item is "worse — drops
     everything."
   - `PanelProtocol.scala:10-15,151` — `PanelAppearancePayload` is `jsonFormat4`, and `chartAppearanceFormat` is
     `jsonFormat5(ChartAppearance.apply)` requiring `seriesColors`/`legend`/`tooltip`/`axisLabels` — confirms a
     bare `{"chart": {"chartType": "bar"}}` fails JSON decode (400) before either path sees it, as claimed.
   - `PanelProtocol.scala:66-71,74-80` confirms `UpdatePanelRequest.appearance`/`PanelBatchItem.appearance` are
     currently `Option[PanelAppearancePayload]` (not raw `JsValue` like `config` already is at `:181,209`) — so the
     "mirror `config`'s existing raw-passthrough pattern" plan is grounded in real, already-proven code in the same
     file.

3. **Shallow-vs-deep merge scoping matches the actual ACs.**
   Ticket AC #2 (`ticket.md:28`) and spec.md scenario "Partial chart payload sets only the provided field"
   (`specs/panel-appearance-settings/spec.md:57-63`) only require chart-field-level granularity
   (`seriesColors`/`legend`/`tooltip`/`axisLabels`/`chartType` each independently settable). No AC or spec scenario
   asks for merging inside `legend`/`tooltip`/`axisLabels` themselves. The Non-Goal is correctly justified against
   the actual acceptance bar, not just asserted.

4. **Backward compatibility for full-payload callers holds.**
   `frontend/src/features/panels/ui/PanelDetailModal.tsx:207-212` — the appearance PATCH payload always sends
   real `background`/`color`/`transparency` string/number values (never `null`), and only includes `chart` when
   `panel.type === "chart"` (never sends `chart: null`). No frontend caller relies on the explicit-null-clears
   semantics or on omission-wipes-to-default. `helio-mcp/src/tools/write.ts:427-439` — `update_panel_appearance`'s
   `inputSchema` is `z.record(z.unknown())` (arbitrary passthrough), already claims "Partial — only the provided
   fields change" (currently false; this ticket makes it true) — no schema coupling to break.

5. **`resolvePatch` genuinely already has `existing: Panel` at the point Decision 4 proposes to merge, and this
   occurs after ACL.**
   `PanelService.scala:237-249` — `update()` calls `panelRepo.findByIdInternal` → `authorizeEditorOnDashboard` →
   only then `resolvePatch(request, existing)`. `PanelServiceHelpers.resolvePatch` (`PanelServiceHelpers.scala:21`)
   already takes `existing: Panel` as a parameter today. `PanelPatchApplier.scala` doc comment
   ("Applies a validated patch... by composing per-field repository updates") matches design's characterization of
   it as a "dumb persist" layer with no validation of its own to skip. Leaving it unchanged is sound.

6. **Dashboard-appearance-PATCH-has-the-same-bug claim verified, and spinoff correctly filed.**
   `DashboardServiceValidation.normalizeAppearance` (`DashboardServiceValidation.scala:99-103`) rebuilds
   `DashboardAppearance` from `RequestValidation.normalizeDashboardBackground/GridBackground`, both defaulting
   an absent field to `"transparent"` (`RequestValidation.scala:42-46`) — identical bug shape. Confirmed via Linear
   `get_issue(HEL-625)` that the spinoff exists, is parented under `HEL-344`, and its scope/ACs match design.md
   Decision 5's description exactly (2 flat fields, same `Option[Option[T]]` idiom referenced for consistency).
   Scoping it out is reasonable: the ticket's AC list, "Out of scope" section, and test list are 100% panel-only.

7. **Schema plan is coherent and the "no request schema exists for single-item PATCH" claim holds.**
   `schemas/panel-appearance.schema.json` (`required: [background, color, transparency]`, `chart.required:
   [seriesColors, legend, tooltip, axisLabels]`) is referenced by `create-panel-request.schema.json` and
   `panel.schema.json` (confirmed via `grep -rl`) — the latter is the **response** schema
   (`id`/`meta`/`ownerId`/`dataAsOf` present), which is correctly left alone since responses are always
   fully-resolved. `schemas/update-panels-batch-request.schema.json:39` currently `$ref`s
   `panel-appearance.schema.json` directly — confirms the planned `$ref` swap to a new patch schema is a real,
   necessary change, not invented. `grep -rn "schema\|Schema" backend/.../PanelRoutes.scala` returned nothing —
   confirmed there is no runtime schema validation on the single-item PATCH body (or the batch body either), so
   "no schema file currently exists / no runtime validation call to worry about" is accurate.

8. **Edge cases checked against the design's own stated rules, not just assumed:**
   - `{"appearance": {}}` — `Patch.decode` on an empty `JsObject` yields all-fields-absent → `applyPatch` is a
     no-op merge (returns `existing` appearance unchanged). `ResolvedPanelPatch.hasAnyField`
     (`PanelService.scala:28-29`) still evaluates `appearance.isDefined = true` (since `request.appearance` was
     `Some(JsObject.empty)`), so the request is accepted as a harmless no-op write (parallels
     `MetricPanelConfig.Patch.decode`'s existing `JsObject.empty → Patch.Empty` precedent) — not a foot-gun.
   - Fresh panel with `chart = None` receiving a partial chart patch: Decision 2 explicitly threads
     `existing.chart.getOrElse(ChartAppearance.Default)` as the merge base — spec.md scenario "Partial chart
     payload on a panel with no stored chart merges over the chart default" (`spec.md:65-69`) directly covers this.

### Non-blocking notes

- Decision 3's stated general rule ("null resets to `Default`'s corresponding value") has an unstated tension with
  its own carve-out: `ChartAppearance.Default.chartType = Some("line")` (`model.scala:132`), yet Decision 3 says
  `chartType: null` inside a chart patch resolves to `None`, not `Some("line")` — a deliberate, reasoned exception
  ("matches today's absent-chartType-renders-as-line fallback"), but it is not captured by any scenario in
  `specs/panel-appearance-settings/spec.md` or any task in `tasks.md §5`. Worth a scenario + test line so the
  exception doesn't quietly regress; trivial to add in a continuation round, not a design defect.
- The design doesn't explicitly address the top-level wire value `"appearance": null` (as opposed to a `null`
  *field inside* appearance). By the stated decode rule (mirroring `MetricPanelConfig.Patch.decode`'s `case _ =>
  Empty` fallback for non-`JsObject` input), this would silently no-op rather than error or reset-everything —
  inherited from existing precedent, plausibly fine, but not called out in writing. Same for the batch item
  equivalent.
- No test item explicitly covers a fresh (never-updated) panel receiving `{"appearance": {"chart": null}}` (chart
  already `None`, explicit-null is a no-op) — low risk, mentioned for completeness.

None of the above touch a stated acceptance criterion, contradict the proposal, or block implementation — per the
orchestrator's own escalation guidance these are consistency/coverage nits suitable for a continuation round if
they surface again, not grounds to REFUTE.

### Verdict: CONFIRM
