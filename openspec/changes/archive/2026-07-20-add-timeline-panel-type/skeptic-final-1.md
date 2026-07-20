## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Planning artifacts read fresh:** `ticket.md` (5 ACs), `design.md`, `tasks.md`, and all three spec deltas
(`specs/panel-type-picker-cards`, `specs/timeline-panel-rendering`, `specs/timeline-panel-type`).

**Gate suite — re-run myself, not trusted from evaluation-2.md:**
- `sbt test` (backend/): **1433/1433 passed, 73 suites**, clean run including Flyway migrating to V58.
- `npm test` (frontend/): **1164/1164 passed, 111 suites**.
- `npm run lint`: zero warnings.
- `npm run format:check`: clean.
- `npx openspec validate add-timeline-panel-type --strict`: `Change 'add-timeline-panel-type' is valid`.

**Backend wiring — read the actual source, not the design doc's claims:**
- `domain/model.scala:58-96` — `PanelType` sealed trait has `case object Timeline`, wired into both
  `fromString`/`asString`.
- `services/PanelServiceHelpers.scala:106-124` (`buildNewPanel`) and `:162-172`
  (`dataTypeIdFromCreateConfig`) both have a `TimelineCreate` case — confirmed the V41
  pipeline-only-binding guard (`rejectCompanionBinding`) actually sees a timeline panel's
  `dataTypeId`, closing the HEL-316 bug class for this new kind.
- `domain/panels/TimelinePanel.scala` — full config/patch/decode implementation: tolerant `decode`
  (defaults `sort: "asc"` on malformed/absent), strict `decodeCreate` (rejects invalid `sort` via
  `deserializationError`), `Patch` with correct absent-vs-null semantics (`Option[Option[X]]`).
- `infrastructure/PanelRowMapper.scala:45-46,82,94,169-187,240-246` — row→domain and domain→row both
  handle `timeline_options`; malformed/legacy blobs decode to defaults tolerantly.
- `infrastructure/PanelRepository.scala:261,282,310,339,348` and `Panel.scala:121,155` and
  `PanelConfigCodec.scala:33,51,66,89` — every dispatch site touched consistently.
- `V58__panel_timeline_options.sql` — additive nullable JSONB column, matches the V57 precedent.
- `schemas/panel.schema.json`, `schemas/create-panel-request.schema.json` — `"timeline"` enum + full
  `TimelineConfig`/`TimelineOptions` `$def`s present.
- `helio-mcp/src/tools/write.ts:256,289` and `proposal.ts:22,34` — `"timeline"` in both `create_panel`
  and `bind_panel` zod enums, with fieldMapping help text for `time`/`event`.

**AC-by-AC trace:**
1. Type picker card — verified live: "Timeline" button with description "Show a chronological
   sequence of time-stamped events" appears in parity with the other 7 cards. MET.
2. Configurable field mapping — verified live: created a fresh timeline panel bound to `skeptic-output`,
   mapped `time→amount`, `event→name` via the `Time field`/`Event field` comboboxes, confirmed the
   API round-trip via `fetch('/api/dashboards/.../panels')`: `config.fieldMapping = {event: "name",
   time: "amount"}`. MET.
3. Vertical chronological rendering — confirmed visually (markers, connector lines, time+description
   per entry) on both the pre-existing "Story Timeline" panel and my freshly created one; visually
   distinct from the adjacent line chart and table panels on the same dashboard. MET.
4. Scales with size / degrades gracefully — `TimelineRenderer.tsx` handles unbound (invite message),
   zero-row (`No data`), single-row (`--last` class suppresses trailing connector), and long-text
   (`overflow-wrap: break-word`) paths; `TimelineRenderer.test.tsx` has dedicated non-vacuous
   assertions for each (read the file — real DOM queries, not smoke tests). CSS has two container
   queries (`max-height: 179px` compact, `min-height: 280px` spacious) for proportional scaling. MET.
5. (Stretch) MCP create/bind — confirmed in schema + MCP grep above. MET.

**Sort direction round-trip (live, not just unit-tested):** toggled "Newest first" in the editor,
saved, and the panel re-rendered `30/Gamma, 20/Beta, 10/Alpha` (descending) — API response confirmed
`timelineOptions: {sort: "desc"}` persisted.

**Mobile phone-stack breakpoint (390×844) — the Cycle-1 bug, re-verified fresh:**
Resized to 390×844, full-page screenshot: both timeline panels ("Skeptic Timeline Check" — my fresh
panel — and "Story Timeline") render with visible nonzero height, all entries visible, markers and
times legible, no 0px collapse. `MobilePanelStack.css:48,96-98` — `.mobile-panel-stack__item--timeline`
is in the intrinsic-height override group and the content-body override
(`.mobile-panel-stack__item--timeline .panel-content--timeline { height: auto; overflow: visible; }`)
is present, exactly as evaluation-2.md claimed. Confirmed by direct file read, not just trusting the
prior report.

**Desktop + theme parity:** dark mode (default) and light mode (toggled) both render the Timeline
panel correctly — marker/connector/time/description, `TIMELINE` type badge matching sibling badges'
style. `TimelineRenderer.css` uses only design tokens (`--space-*`, `--text-*`, `--app-accent`,
`--app-border-subtle`, `--app-text-muted`, `--app-radius-pill`, `--font-mono`) — no hardcoded colors
or spacing found. `TimelineEditor.tsx` reuses `DataTypePicker`, `FieldMappingSlots`, and the shared
`panel-detail-modal__*` classes rather than inventing new UI — consistent with the Collection
precedent design.md specifies.

**Investigated and ruled out as out-of-scope:** while live-testing, newly-created and pre-existing
Timeline panels showed a resolved appearance override (`background: "#1a1816"`) instead of the
`"transparent"` default after an editor Save. I chased this to confirm it was not a Timeline-specific
regression: (a) `updatePanelTimeline`'s PATCH body (`panelService.ts:169-180`) sends only `{ config }`,
never `appearance`; (b) `git diff main...HEAD -- .../PanelDetailModal.tsx` shows only mechanical
dispatch wiring (`isTimelinePanel` narrowing + ref), no appearance-handling changes; (c) reproduced the
identical clobbering on the unrelated Chart panel's appearance (including a full `chart` options
object) without ever touching its editor in that session. This is a pre-existing, app-wide
appearance-persistence quirk in the shared `PanelDetailModal` save flow, orthogonal to this diff —
not something to hold HEL-317 accountable for, and it does not affect any of the 5 ACs.

### Verdict: CONFIRM

### Non-blocking notes
- The pre-existing appearance-persistence quirk noted above (editor Save silently converting a
  panel's `"transparent"`/`"inherit"` default appearance into resolved concrete hex values, observed
  on both Timeline and Chart panels) is real and worth a follow-up ticket, but it is not introduced by
  this diff and does not block delivery of HEL-317.
- Carried over from evaluation-2.md: `PanelRowMapperSpec.scala` is 277 lines, slightly over the
  250-line soft budget — informational only, not blocking.
