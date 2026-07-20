## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all three spec deltas
  (`specs/timeline-panel-type/spec.md`, `specs/timeline-panel-rendering/spec.md`,
  `specs/panel-type-picker-cards/spec.md`), and `skeptic-design-1.md` (round 1's REFUTE) from
  scratch, treating round 1's claims as things to re-verify rather than facts.
- Re-read the four backend files round 1 flagged as missing wiring points, against the *current*
  (unmodified-by-this-round) source, to confirm both that round 1's diagnosis was accurate and that
  the revised plan's fix is correctly targeted:
  1. `backend/src/main/scala/com/helio/domain/model.scala:58-93` — confirmed the independent
     `PanelType` sealed trait (`Metric/Chart/Text/Table/Markdown/Image/Divider/Collection`) with
     `fromString`/`asString`, still missing `Timeline`. Task 1.5 now adds it explicitly, and
     design.md's "Decisions" section correctly names this as the first gate
     (`POST /api/panels` 400s at `validatePanelType` otherwise).
  2. `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:106-123`
     (`buildNewPanel`) — confirmed the `match` over `CreateConfig` subtypes is non-exhaustive
     without a `TimelineCreate` arm (would `MatchError` at runtime). Task 2.1 now adds this
     explicitly, named by file/function in both design.md and tasks.md.
  3. `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:159-168`
     (`dataTypeIdFromCreateConfig`) — confirmed the match falls through to `case _ => None` for any
     kind not listed, which would silently disable the V41 `rejectCompanionBinding` guard for
     timeline panels (same bug class HEL-316 closed for Text/Markdown, per the code's own comment).
     Task 2.2 now adds this, and design.md's Decisions section correctly frames it as a
     binding-safety requirement, not mere wiring — matching round 1's Change Request #3 verbatim.
  4. `backend/src/main/scala/com/helio/services/DashboardServiceValidation.scala:49-58`
     (`validatePanelEntries`, dashboard import) — read in full: it calls only
     `PanelType.fromString(entry.type)` then `PanelConfigCodec.decodeCreateConfig(...)`. Confirmed
     task 2.3's claim ("no code change expected beyond 1.5") is accurate — once `PanelType` (1.5)
     and the codec (1.3) cover `timeline`, import works with no separate fix. Task 7.2 adds the
     export→import round-trip test round 1 found missing (previously only `duplicate` was tested).
- Confirmed migration numbering is still correct: latest existing migration is
  `V57__panel_collection_options.sql` (`ls backend/src/main/resources/db/migration | sort -V | tail`),
  so task 3.1's `V58__panel_timeline_options.sql` is correctly slotted.
- Read `backend/src/main/scala/com/helio/domain/panels/CollectionPanel.scala` in full — confirms the
  tolerant-decode/strict-create/absent-vs-null-Patch shape the design claims to mirror for
  `TimelinePanelConfig` is accurate and directly analogous (config, companion, `Kind` string, wire
  codec via `Panel.Registry`).
- Checked for any *additional* dispatch sites beyond the four already flagged, to make sure round 2
  didn't just patch the named holes while missing a fifth: grepped `PanelProtocol.scala` and
  `JsonProtocols.scala` for per-kind `Collection`/`"collection"` dispatch — neither has any; both are
  generic (`type` string + `JsValue config`), so task 1.4's "any JsonProtocols panel dispatch"
  phrasing is a correct (harmless) hedge, not a hidden gap. Also checked `DashboardService.scala`
  (export path) — no per-kind dispatch there either, so export is generic and needs no explicit task.
- Checked `DashboardProposalService.scala:342` (`DataPanelKinds`, the `apply_proposal` path) — still
  omits `timeline`, same as round 1's finding. This remains correctly scoped as non-blocking: the
  ticket's stretch AC names only `create_panel`/`bind_panel`, and omitting `timeline` here routes it
  through the same code path as `text`/`markdown` (functional, just not flat-field-optimized), not a
  400 or a security gap. Flagging again as a non-blocking follow-up note, consistent with round 1.
- Cross-checked the frontend union/exhaustiveness claims: `PANEL_SLOTS: Record<PanelType, PanelSlot[]>`
  (`frontend/src/features/panels/state/panelSlots.ts`) is a `Record` over the full `PanelType` union —
  TS-compile-enforced, so task 5.3 (`panelSlots.ts`) is self-checking. `computeMobilePanelHeight`'s
  `switch (kind)` in `mobilePanelHeights.ts` has no `default` case and covers every current `PanelKind`
  member — also compile-enforced for task 5.3's `mobilePanelHeights.ts` addition, matching the design's
  implicit claim that these surfaces can't silently omit `timeline`. `panelNarrowing.ts` is a plain
  set of type-guard functions (not exhaustive-by-construction), correctly left as an explicit task (5.2).
- Read all three spec deltas end-to-end: scenarios are concrete and testable (specific request/response
  shapes, specific error conditions, specific degradation cases for empty/single-row/long-text), and
  consistent with design.md's decisions (tolerant decode + strict create-path rejection, absent-vs-null
  PATCH semantics, two-slot `time`/`event` binding, contract-surface enumeration). No placeholders,
  TBDs, or internally contradictory statements found across proposal/design/specs/tasks.
- Traced all four ticket ACs to concrete tasks: AC1 (picker card) → tasks 4.2/6.1 + spec
  `panel-type-picker-cards`; AC2 (configurable field mapping) → tasks 1.1/5.3/6.3 + spec
  `timeline-panel-type`/`timeline-panel-rendering`; AC3 (vertical chronological rendering) → task 6.2 +
  spec `timeline-panel-rendering` requirement 1; AC4 (size scaling + degradation) → task 6.2 + spec
  requirement 3; AC5/stretch (MCP) → tasks 3.2 + spec `timeline-panel-type` requirement 5. No AC is
  left uncovered by any task, and no task represents scope drift beyond the ticket.

### Verdict: CONFIRM

### Non-blocking notes

- `DashboardProposalService.DataPanelKinds` (`DashboardProposalService.scala:342`) still doesn't
  include `timeline`, meaning agent-driven `apply_proposal` dashboards will route a timeline panel
  through the `config.dataTypeId` passthrough path (like text/markdown) rather than the flat-field
  fast path other data panels use. This is functionally correct, not a blocker, and out of the
  ticket's literal stretch-AC wording — but worth a follow-up ticket alongside the existing
  `helio-mcp/src/tools/proposal.ts` `DATA_PANEL_TYPES` gap noted in round 1, for parity with
  metric/chart/table/collection.
