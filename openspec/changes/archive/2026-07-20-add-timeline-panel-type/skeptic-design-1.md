## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all three spec deltas
  (`specs/timeline-panel-type/spec.md`, `specs/timeline-panel-rendering/spec.md`,
  `specs/panel-type-picker-cards/spec.md`) in full.
- Read the `collection` precedent end-to-end
  (`backend/src/main/scala/com/helio/domain/panels/CollectionPanel.scala`) — confirms the
  config/patch/tolerant-decode/strict-create shape the design claims to mirror is accurate.
- Confirmed the next Flyway migration slot is free:
  `backend/src/main/resources/db/migration/` latest is `V57__panel_collection_options.sql`, so
  `V58__panel_timeline_options.sql` (task 2.1) is correctly numbered.
- Grepped every backend file referencing `collection`/`CollectionPanel`/`collection_options` to
  build the full "collection literal checklist" the design itself proposes as its drift-mitigation
  strategy (design.md "Risks" section). This surfaced **three backend files, all load-bearing for
  the ticket's core (non-stretch) acceptance criteria, that neither `design.md`'s Impact section
  nor `tasks.md`'s task list mention**:

  1. **`backend/src/main/scala/com/helio/domain/model.scala:58-93`** — a *second*, independent
     `PanelType` sealed trait (`Metric/Chart/Text/Table/Markdown/Image/Divider/Collection`) with
     `fromString`/`asString`, parallel to and NOT superseded by `Panel.Registry`. This is directly
     gated by `PanelServiceHelpers.validatePanelType`/`validatePanelTypeOpt`
     (`PanelServiceHelpers.scala:131-141`), which is called at the very top of
     `PanelService.create` (`PanelServiceHelpers.scala:86-87`) — i.e. **`POST /api/panels` with
     `type: "timeline"` returns 400 "Unknown panel type: 'timeline'. Valid values: metric, chart,
     ..., collection" before it ever reaches `PanelConfigCodec.decodeCreateConfig`.** This directly
     breaks AC #1 (timeline creatable) and the design's own primary spec requirement/scenario
     ("Timeline is a persisted panel kind" → "Create a timeline panel",
     `specs/timeline-panel-type/spec.md:9-13`).

  2. **`backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:106-123`**
     (`buildNewPanel`) — a `match` over `PanelConfigCodec.CreateConfig` subtypes
     (`MetricCreate | ChartCreate | TableCreate | TextCreate | MarkdownCreate | ImageCreate |
     DividerCreate | CollectionCreate`) that constructs the actual `Panel` domain object. Without
     an added `TimelineCreate` case, this is non-exhaustive; even if it compiles with a warning, a
     create request that reaches this point (once #1 above is also fixed) throws a `MatchError` at
     runtime. Neither `design.md` nor `tasks.md` task 1.3/1.4 names this file.

  3. **`backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:159-168`**
     (`dataTypeIdFromCreateConfig`) — the function `PanelService.create` (`PanelService.scala:126`)
     uses to feed `rejectCompanionBinding`, the **V41 pipeline-only-binding security check**
     (companion/source-only DataTypes must not be bindable to panels). The match currently covers
     `Metric/Chart/Table/Collection/Text/Markdown` and falls through to `case _ => None` for
     anything else — the same class of gap the code's own comment says was fixed for Text/Markdown
     under **HEL-316** ("a source-companion... DataType could be bound to a
     text/markdown panel's `config.dataTypeId`... bypassing the V41 pipeline-only-binding rule").
     Timeline binds to a multi-row DataType exactly like `collection` (design.md Decision 1,
     ticket AC #2), so omitting it here silently **disables the V41 binding-safety guard for
     timeline panels** — an unflagged security/data-integrity gap, not just a wiring nit.

  4. (Related, same root cause) **`backend/src/main/scala/com/helio/services/DashboardServiceValidation.scala:49-58`**
     (`validatePanelEntries`, used by dashboard **import**) calls `PanelType.fromString(entry.
     `type`)` per panel and rejects the whole import on failure. Once a timeline panel exists on a
     dashboard, exporting and re-importing it (a real, documented product feature —
     `GET /api/dashboards/:id/export` / `POST /api/dashboards/import` per `CLAUDE.md`) will fail
     with "Unknown panel type: 'timeline'" until item #1 is fixed. This regression is not called
     out anywhere in the design's specs.

  All four points trace back to the same root cause: the design's stated drift-mitigation ("grep
  for the `collection` literal as the checklist of touch points" — design.md line 57) was evidently
  not actually run against the full codebase, since a plain `grep -rn "collection" backend/src`
  turns up all four files immediately (verified live in this review).

- Cross-checked the frontend surfaces the design lists (`types/panel.ts`, `panelSlots.ts`,
  `panelNarrowing.ts`, `TypeSelectStep.tsx`) — these are accurate and complete; the frontend has a
  single `PanelType` union (`frontend/src/features/panels/types/panel.ts`) with no split-enum
  hazard analogous to the backend's `PanelType`/`Panel.Registry` duplication. `PANEL_SLOTS: Record
  <PanelType, PanelSlot[]>` (`panelSlots.ts`) confirms the `timeline: [time, event]` slot plan
  (design.md Decision 2) is directly actionable as described.
- Confirmed `schemas/panel.schema.json` currently enumerates `["metric", "chart", "text", "table",
  "markdown", "image", "divider", "collection"]` (line 14) — task 3.1's plan to widen this is
  correctly scoped.
- Confirmed the ticket's stretch AC text names only `create_panel`/`bind_panel`, matching
  `helio-mcp/src/tools/write.ts`'s `.enum([...])` usage (task 3.2 scope is accurate); the sibling
  `helio-mcp/src/tools/proposal.ts` `DATA_PANEL_TYPES` set and `DashboardProposalService.
  DataPanelKinds` (`DashboardProposalService.scala:342`) are out of the ticket's literal stretch-AC
  wording, so I'm not treating their omission as blocking — but note them below as a non-blocking
  follow-up risk.

### Verdict: REFUTE

### Change Requests

1. **Add `Timeline` to the backend `PanelType` sealed trait** (`domain/model.scala:58-93`):
   `case object Timeline extends PanelType`, plus `"timeline" => Right(Timeline)` in `fromString`
   and `Timeline => "timeline"` in `asString`. Without this, `POST /api/panels` with
   `type: "timeline"` 400s at `PanelServiceHelpers.validatePanelType` before reaching any of the
   codec/registry work tasks.md already plans. Add this as an explicit task under "1. Backend —
   domain + codec" (or its own subsection), and update `design.md`'s Impact list to name
   `domain/model.scala`.

2. **Add a `TimelineCreate` case to `PanelServiceHelpers.buildNewPanel`**
   (`PanelServiceHelpers.scala:106-123`) constructing `TimelinePanel(...)`, mirroring the existing
   `CollectionCreate` case. Name this file explicitly in tasks.md (it is currently only implied by
   the generic "Wire timeline into PanelConfigCodec" task 1.3/1.4, which does not cover this
   downstream consumer of `CreateConfig`).

3. **Add a `TimelineCreate` case to `PanelServiceHelpers.dataTypeIdFromCreateConfig`**
   (`PanelServiceHelpers.scala:159-168`), mirroring `CollectionCreate`/`MetricCreate` etc., so the
   V41 pipeline-only-binding guard (`PanelService.create`'s `rejectCompanionBinding`) actually runs
   against a timeline panel's `dataTypeId`. Call this out explicitly in `design.md`'s Decisions (it
   is a binding-safety requirement, not just wiring) and as its own task — this is the same bug
   class HEL-316 fixed for Text/Markdown; omitting it for a brand-new bound panel kind reintroduces
   it on day one.

4. **Confirm `DashboardServiceValidation.validatePanelEntries`** (`DashboardServiceValidation.
   scala:49-58`) works once #1 is fixed (it will, since it only calls `PanelType.fromString` +
   `PanelConfigCodec.decodeCreateConfig`), and add an export→import round-trip test for a timeline
   panel to task 6.1's list — the spec only tests `POST /api/panels/:id/duplicate`
   (`specs/timeline-panel-type/spec.md:73-76`), not the import path, which shares the same
   `PanelType`-gated failure mode.

### Non-blocking notes

- `helio-mcp/src/tools/proposal.ts` (`DATA_PANEL_TYPES`) and `DashboardProposalService.
  DataPanelKinds` (`DashboardProposalService.scala:342`) don't include `collection`'s sibling
  treatment for `timeline` either — out of the ticket's literal stretch-AC wording (which names
  only `create_panel`/`bind_panel`), so not a blocker, but worth a follow-up ticket so agent-driven
  `apply_proposal` dashboards can also derive a timeline panel's flat `dataTypeId`/`fieldMapping`
  the way collection/metric/chart/table already do.
- Everything else in the design — the `CollectionPanelConfig`-mirrored config/patch shape, the
  `timeline_options` V58 JSONB column, the two-slot `PANEL_SLOTS.timeline` plan, the
  `TimelineRenderer`/`TimelineEditor` split, and the schema/MCP tool-enum plan — checks out against
  the actual `collection` precedent and is sound to implement once the above backend wiring points
  are added to the task list.
