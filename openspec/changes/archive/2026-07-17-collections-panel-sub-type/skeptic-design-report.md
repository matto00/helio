## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all six `specs/*/spec.md` deltas in
  `openspec/changes/collections-panel-sub-type/`.
- Diffed every MODIFIED spec delta against the current base spec (`openspec/specs/<cap>/spec.md`)
  for `panel-type-field`, `mobile-panel-sizing`, `panel-creation-datatype-step`, `panel-type-picker-cards`:
  all four deltas are faithful partial copies (only the changed requirement + added scenarios are
  present; OpenSpec's MODIFIED-block convention means the untouched requirements stay as-is on
  archive) — no textual drift introduced by this proposal in those four.
- Confirmed the 7-kind baseline and precedent chain against real files: `backend/.../domain/panels/`
  has exactly 7 `*Panel.scala` files; `V53/V54/V55/V56` migrations exist as claimed; `MetricPanel.scala`
  matches the config/Patch/companion shape design.md D8 describes; `PanelRowMapper.scala` confirms the
  `rowToDomain` match + `domainToRow` pattern-match BOTH-directions structure the design targets;
  `PanelRepository.configColumnsOf`/`configColumnValuesOf` tuple (15 cols today, Slick's 22-tuple cap
  headroom is fine for a 16th); `schemas/panel.schema.json`'s `oneOf`/`$defs` pattern confirms the
  schema-extension mechanism; `PanelConfigCodec.scala` confirms the "three dispatch points"
  (`encodeConfig`, `decodeCreateConfig`, `applyConfigPatchUnsafe`) design.md D8 names.
- Confirmed `BoundOrLiteralField`/`useBoundOrLiteralState` exist as described (HEL-243 family) and
  `PanelDetailModal.tsx`'s `activeEditorRef()`/`renderSubtypeEditor()` dispatch pattern (needs a new
  arm — consistent with task 5.2). Confirmed the `@media (max-width: 768px)` ≥44px block and its
  `PanelDetailModal.css.test.ts` CSS-lock test exist as claimed.
- Confirmed `mobilePanelHeights.ts`'s `computeMobilePanelHeight` is a non-default `switch` over
  `PanelKind` (TS exhaustiveness) — D5's "explicit case, not fall-through default" claim is accurate
  and enforceable.
- Confirmed `panelSlots.ts`'s `PANEL_SLOTS: Record<PanelType, PanelSlot[]>` requires a `collection` key
  (TS exhaustiveness) — D2/task 3.4's claim is accurate.
- Confirmed the HEL-305 `buildCreatePanelBody`/`seedCreateConfig` bug: the current `metric`/`chart`/`table`
  arm in `panelPayloads.ts` seeds only `dataTypeId`, dropping any `typeConfig` fields (e.g. chart's
  `chartType`) — the design's explicit dedicated `collection` arm (D6/task 3.3) correctly avoids
  reusing that lossy pattern.
- **Traced the actual `POST /api/panels` / `PATCH /api/panels/:id` validation path** (not just the
  `PanelConfigCodec`/`Panel.Registry` system the design describes) and found a second, independent
  panel-kind enumeration that gates panel creation *before* `PanelConfigCodec` is ever reached — see
  Change Request 1, this is the headline finding.

### Verdict: REFUTE

### Change Requests

1. **Blocking — a second, independent panel-kind enum gates `POST/PATCH /api/panels` and is entirely
   unaddressed by design.md/tasks.md/proposal.md's Impact section.**
   `backend/src/main/scala/com/helio/domain/model.scala:58-84` defines `sealed trait PanelType` with
   hardcoded `case object`s (`Metric`/`Chart`/`Text`/`Table`/`Markdown`/`Image`/`Divider`) and
   hand-written `fromString`/`asString` — this is **separate from** `Panel.Registry`/`PanelKind.All`
   (`Panel.scala:109-153`), which design.md's D8 and tasks 1.2/1.3 correctly target.
   `PanelServiceHelpers.scala:97-106` (`validatePanelType`/`validatePanelTypeOpt`) calls
   `PanelType.fromString(t)` directly, and `PanelServiceHelpers.scala:53`
   (`resolveCreateConfig`) is the function `PanelService.create` calls to build a panel — i.e. this
   *is* the live gate on `POST /api/panels`. As specified, `type: "collection"` would be rejected with
   400 `"Unknown panel type: 'collection'. Valid values: metric, chart, text, table, markdown, image,
   divider"` before `PanelConfigCodec`/`Panel.Registry` are ever consulted, regardless of how correctly
   tasks 1.1–1.6 are implemented. This directly contradicts the ticket DoD ("Collection panel type
   appears in panel-creation modal… ships and renders correctly") and the `collection-panel-type` spec
   delta's own "Create a collection panel" scenario.
   Required revisions:
   - Add `case object Collection extends PanelType` + `"collection"` arms to `fromString`/`asString`
     in `domain/model.scala`.
   - `PanelServiceHelpers.buildNewPanel` (`PanelServiceHelpers.scala:70-84`) pattern-matches
     `PanelConfigCodec.CreateConfig` (a `sealed trait`); once task 1.3 adds `CollectionCreate`, this
     match becomes non-exhaustive and must gain a `case PanelConfigCodec.CollectionCreate(c) =>
     CollectionPanel(...)` arm or it will not compile / will `MatchError` at runtime.
   - `DashboardServiceValidation.validatePanelEntries` (`DashboardServiceValidation.scala:53`) also
     calls `PanelType.fromString(entry.type)` on **dashboard import** — without the above fix, importing
     a dashboard containing a collection panel fails validation, directly contradicting the
     `collection-panel-type` spec delta's "Collection config survives duplication and export"
     requirement/scenario.
   - `DashboardProposalService.DataPanelKinds` (`DashboardProposalService.scala:271`,
     `Set("metric", "chart", "table")`) gates the agent-native "propose → apply" path's requirement that
     a data-bound panel type must carry a `dataTypeId`. Add `"collection"` to this set so an
     AI-authored collection proposal gets the same binding-required validation metric/chart/table get
     (a collection is meaningless unbound per the ticket's own D6).
   - Update `backend/src/test/scala/com/helio/domain/PanelTypeSpec.scala` to cover
     `PanelType.fromString("collection")`/`asString` round-trip alongside the existing 7.
   - Add these four files (`domain/model.scala`, `PanelServiceHelpers.scala`,
     `DashboardServiceValidation.scala`, `DashboardProposalService.scala`) to tasks.md §1 and
     proposal.md's Impact/Backend list — they are currently absent from every planning artifact.

2. **Missed page-size surface for the "N-row expansion" use case.**
   `frontend/src/features/panels/hooks/usePanelData.ts:97-103` chooses the initial `fetchPanelPage`
   size via a `switch` on `panel.type`: `chart` → 200, `table` → 50, else → 10. `collection` is not
   listed anywhere in design.md, tasks.md, or proposal.md's Impact section, so it silently falls into
   the `else` (10-row) bucket — the same bucket as `metric`/`text`/`markdown`, which only ever need
   one row. The ticket's own motivating examples ("one metric per region," "one tile per active
   deployment") plausibly exceed 10 items, and D4's "v1 renders the first fetched page of rows" risk
   note discusses tall-panel scrolling but never says what that page size actually resolves to. Given
   this ticket's own bar elsewhere (explicit, commented per-kind entries in `mobilePanelHeights.ts` and
   `PANEL_SLOTS`, "not a fall-through default"), a collection silently capping at 10 items is
   inconsistent with that bar and should be a deliberate, documented decision (a larger page size, e.g.
   matching `table`'s 50) rather than an accidental default. Add `usePanelData.ts` to the design's
   Decisions (a case in the pageSize switch) and to tasks.md §4/proposal.md's Impact list.

### Non-blocking notes

- `openspec/specs/panel-creation-datatype-step/spec.md` (base, pre-existing) says markdown is
  "non-data-bound" and skips the DataType step, but `PanelCreationModal.tsx:45`'s live
  `DATA_BOUND_TYPES` already includes `"markdown"` — a pre-existing spec/code drift this proposal did
  not create and whose delta faithfully (if now slightly confusingly) preserves. Worth a follow-up spec
  correction ticket, not a blocker for HEL-247.
- `panelTemplates.ts`'s Planner Note ("collection gets the minimal 'blank' template entry so the
  template step doesn't dead-end") is unnecessary — `TemplateSelectStep.tsx` always renders a
  "Start blank" button regardless of whether a type has template entries (`PANEL_TEMPLATES` is a
  `Partial<Record<...>>`), so there is no dead-end risk either way. Harmless if kept, just not
  load-bearing.
