## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Root cause claim, verbatim match against code.** Read
  `backend/src/main/scala/com/helio/infrastructure/PanelMutationRepository.scala:105-108` —
  the batch config-patch `.map(...)`/`.update(...)` tuple is exactly
  `(typeId, fieldMapping, content, imageUrl, imageFit, dividerOrientation, dividerWeight,
  dividerColor, lastUpdated)` — `aggregation` is genuinely absent, matching the ticket's
  evidence quote character-for-character.
- **Parity comparison target, verbatim match.** Read `PanelRepository.scala:199-209` — `replace`
  writes `(typeId, fieldMapping, content, imageUrl, imageFit, dividerOrientation, dividerWeight,
  dividerColor, aggregation, lastUpdated)`, confirming `aggregation` was fixed there (HEL-292)
  and not in `batchUpdate`.
- **`aggregation` is a real, populated column.** `PanelRepository.scala:253/274` (`PanelRow` /
  `PanelTable`) declare `aggregation: Option[String]`; `PanelRowMapper.scala:74-75`
  (`domainToRow`) populates it from `MetricPanel.config.aggregation` /
  `ChartPanel.config.aggregation` for those two subtypes. Confirms `domainToRow(patched)` at
  `PanelMutationRepository.scala:104` computes the value correctly in memory — it's the
  write-back list that drops it, exactly as claimed.
- **In-memory patch path is correct (validates the "non-goal": don't touch
  `applyConfigPatch`).** `MetricPanel.scala` and `ChartPanel.scala` both define
  `Patch.aggregation: Option[Option[JsObject]]`, decode it from wire JSON, and apply it via
  `aggregation = patch.aggregation.fold(config.aggregation)(identity)`. So
  `PanelConfigCodec.applyConfigPatch` → `mp.applyPatch(...)` genuinely produces an updated
  `Panel` with the new aggregation spec; the bug is isolated to the write-back whitelist, not
  the patch logic. This is a probe-confirmed root cause, satisfying `systematic-debugging.md`.
- **No third write path with the same whitelist.** `grep -rn "dividerColor"
  backend/src/main/scala` returns only `PanelRepository.scala` and
  `PanelMutationRepository.scala` (plus unrelated `PanelRowMapper`/`Panel.scala` mentions) — the
  design's scope (fix these two call sites) is complete; no forgotten third path.
- **Wire shape assumptions in the spec scenarios are accurate.** `PanelBatchItem` in
  `PanelProtocol.scala:67-72` has `config: Option[JsValue]`, matching the
  `fields: ["config"], panels: [{ id, config: {...} }]` shape used in the spec's scenarios and
  the ticket's fix description.
- **No migration needed, confirmed.** `aggregation` column already exists in `PanelTable`/`PanelRow`
  (added by V43 per the ticket, present in the code as of this worktree) — the proposal's "no
  new migrations" claim checks out.
- **Shared-helper approach is technically reasonable.** `PanelTable`/`PanelRow` live in the
  `PanelRepository` companion object (`PanelRepository.scala:213-278`), which is exactly where
  the design proposes adding `configColumnsOf`/`configColumnValuesOf`, and `PanelMutationOps`
  already does `import PanelRepository._` (`PanelMutationRepository.scala:18`), so both call
  sites can reach the new helpers without new plumbing. The design also names a fallback (keep
  flat-tuple return shapes) if Slick's nested-tuple `.map`/`.update` proves awkward — an
  appropriately scoped risk mitigation for a change this size.
- **File-size soft budget not at risk.** `PanelRepository.scala` is currently 278 lines
  (`wc -l`); `CONTRIBUTING.md:24` sets a soft ~250-line budget and only asks for a split
  proposal past ~400. Adding two small helper functions won't approach that threshold.
- **AC-to-task traceability.** All three ticket ACs map cleanly to tasks: AC1 (regression test,
  fails before / passes after) → tasks 2.1/2.2; AC2 (shared column list) → tasks 1.1-1.3 (the
  stronger single-source-of-truth choice, not merely a sync-assertion test, which the design
  itself explicitly considered and rejected as weaker); AC3 (`sbt test` green) → task 2.3.
- **Spec delta convention check.** The base spec at
  `openspec/specs/panel-batch-update/spec.md` has no existing requirement describing
  config-patch column persistence (only appearance/title/type batch behavior is documented), so
  the change's spec delta correctly uses `## ADDED Requirements` for a requirement that is new
  to the documented spec, even though it modifies existing runtime behavior. Consistent with
  OpenSpec conventions, not a contradiction with `proposal.md`'s "Modified Capabilities" framing
  (capability-level modification via a newly-documented requirement).
- **No placeholders/TBDs/hand-waving** found in `proposal.md`, `design.md`, `tasks.md`, or
  `specs/panel-batch-update/spec.md`. No scope drift — proposal's Non-goals section explicitly
  excludes `applyConfigPatch`/domain-model changes and broader refactors, and the tasks respect
  that boundary.

### Non-blocking notes

- `design.md`'s "Regression test location" decision says to extend the suite "wherever
  `batchUpdate`'s config-patch path is already covered" — I could not find any existing test
  coverage of the batch endpoint's `fields: ["config"]` branch specifically (only appearance/
  title/404/empty-array batch tests exist in `ApiRoutesSpec.scala:1849-1900`; the `"config"`
  JSON snippets found elsewhere in that file target the single-panel `PATCH /api/panels/:id`
  endpoint, not the batch endpoint). This is a minor factual inaccuracy in the design doc's
  framing, not a blocking gap — the natural place to add the new tests is still right next to
  the other `updateBatch` tests in `ApiRoutesSpec.scala`, and tasks 2.1/2.2 already say to add
  new tests rather than assuming existing ones. Executor should not go looking for
  nonexistent "existing config-patch coverage" to extend.
- The AC's "persists across a reload" wording doesn't prescribe an HTTP mechanism, and there is
  no authenticated `GET /api/panels/:id`. The batch endpoint's own response already reflects a
  post-update DB re-read (`PanelMutationRepository.scala:116-121` re-queries `table` after the
  update, within the same transaction), so asserting against that response would technically
  catch the bug, but a stronger regression test would independently re-fetch via
  `GET /api/dashboards/:id/export` (confirmed to exist and return panel configs, per
  `ApiRoutesSpec.scala:1608`) as a genuinely separate request. Worth a nudge to the executor but
  not a design defect — implementation-level detail appropriately left to tasks.md's
  granularity.

### Verdict: CONFIRM
