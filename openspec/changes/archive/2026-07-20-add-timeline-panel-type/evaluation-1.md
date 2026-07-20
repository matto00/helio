## Evaluation Report — Cycle 1

Commit reviewed: `102d5a43` (HEL-317 Add Timeline panel type)

### Phase 1: Spec Review — PASS
Issues: none.

- All 5 ticket ACs addressed: (1) `timeline` card in the creation type picker with icon (`faTimeline`) + one-line description — verified live in browser; (2) binds to a DataType via `dataTypeId`/`fieldMapping` with configurable `time`/`event` slots (`PANEL_SLOTS.timeline`, `TimelineEditor`) — verified live; (3) renders a vertical chronological list (marker/connector/time/description), visually distinct from a chart — verified live and via `TimelineRenderer.test.tsx`; (4) size-proportional scaling (container-query rules in `TimelineRenderer.css`) and graceful degradation (empty/single-row/long-description) — covered by tests, but see Phase 3 for a real degradation gap found on the mobile phone stack; (5) stretch AC — helio-mcp `create_panel`/`bind_panel` enums widened with `"timeline"` and updated tool descriptions.
- No AC silently reinterpreted; `sort` option (asc/desc) matches design.md's documented decision, not an ad hoc addition.
- `tasks.md` all 43 items marked done; spot-checked against the diff — every checked item has a corresponding code change (no items marked done without matching implementation).
- No scope creep: the diff is entirely `timeline`-kind wiring plus the previously-scoped 8th-card/picker update; no unrelated refactors.
- No regressions: `sbt test` 1433/1433 and `npm test` 1161/1161 pass fresh (see Phase 2 evidence), including pre-existing suites for other panel kinds.
- API contracts updated in lockstep: `schemas/panel.schema.json` (`type` enum + `TimelineConfig`/`TimelineOptions` `$defs`), `schemas/create-panel-request.schema.json`, `schemas/update-panels-batch-request.schema.json`, `schemas/dashboard-proposal.schema.json`, helio-mcp `write.ts`/`proposal.ts`/`types.ts`/`helioApi.ts`.
- Planning artifacts (proposal/design/tasks) reflect the final implementation; the design.md's load-bearing-wiring call-outs (parallel `PanelType` trait, both `PanelServiceHelpers` match sites, V58 column, mapper round-trip) were all independently verified present and correct (see Phase 2).

### Phase 2: Code Review — PASS
Issues: none blocking. One non-blocking suggestion below.

Fresh gate evidence (all re-run by the evaluator, not taken from the executor's report):
- `sbt test` (backend, from a clean run in this worktree): **1433/1433 passed**, 73 suites, 0 failed.
- `npm test` (frontend): **1161/1161 passed**, 111 suites.
- `npm run lint`: clean (zero warnings).
- `npm run format:check`: clean.
- `npx openspec validate add-timeline-panel-type --strict`: `Change 'add-timeline-panel-type' is valid`.
- `npm run check:schemas`: `schemas in sync with JsonProtocols`, `panel-type enums in sync with backend canonical sets (7 surfaces checked)`.
- `npm run check:scala-quality`: clean (45 pre-existing soft file-size warnings, none introduced by new files — `TimelinePanel.scala` is 182 lines, well under the 250-line soft budget; no inline-FQN violations).

Load-bearing backend wiring (design.md's specific gate) — all verified by reading the diff directly, not inferred:
- `domain/model.scala`: `PanelType.Timeline` case object added, with `"timeline"` wired into both `fromString` and `asString` (`model.scala:68,81,94`).
- `PanelServiceHelpers.buildNewPanel`: `TimelineCreate(c) => TimelinePanel(...)` case present (`PanelServiceHelpers.scala:123`) — would otherwise be a `MatchError` at create time.
- `PanelServiceHelpers.dataTypeIdFromCreateConfig`: `TimelineCreate(c) => Option(c.dataTypeId)...` case present (`PanelServiceHelpers.scala:170`) — confirmed this feeds the V41 `rejectCompanionBinding` guard, closing the same binding-safety gap class HEL-316 fixed for Text/Markdown.
- `V58__panel_timeline_options.sql`: additive nullable `timeline_options JSONB` column; migrated cleanly in the fresh `sbt test` run (`Migrating schema "public" to version "58 - panel timeline options"`).
- `PanelRowMapper`: both directions wired — `timelineConfig(row)` (row→domain, tolerant decode of a malformed/legacy blob to defaults) and `timelineOptionsColumn(config)` (domain→row) — plus `PanelRepository`'s `configColumnsOf`/`configColumnValuesOf`/`PanelRow` tuple widened to 26 columns (HList, correctly avoiding the 22-tuple ceiling).
- `DashboardSnapshotRepository` (export/import path) and `DashboardProposalService.DataPanelKinds` both updated — dashboard import and `apply_proposal` paths won't `MatchError`/reject `timeline`.
- `schemas/panel.schema.json` `TimelineConfig`/`TimelineOptions` defs and helio-mcp `create_panel`/`bind_panel` zod enums both include `"timeline"` — confirmed by diff read, not just the handoff doc's claim.

DRY / readability / modularity:
- `TimelinePanel.scala`, `TimelineRenderer.tsx`, `TimelineEditor.tsx` all mirror the `Collection` precedent file-for-file; no invented patterns. `TimelineEditor` reuses `DataTypePicker`, `FieldMappingSlots`, `InlineError` — no duplicated form logic.
- `TimelineRenderer.css` uses only `--app-*`/`--space-*`/`--text-*` design tokens (spot-checked every declaration); no magic hex/px values. Container-query breakpoints match the established compact/spacious pattern used elsewhere in the codebase.
- Empty/no-data states reuse the exact `panel-content--state` / `panel-content__state-label` shared classes from `CollectionRenderer`, not a new invented empty-state pattern.

Type safety / error handling:
- `TimelinePanelConfig.decodeCreate` raises `deserializationError` (→ 400) for an invalid `sort` value on the create path; `decode` (tolerant, storage/response path) always resolves to a default rather than throwing — verified this dual-path split exists and is exercised by `PanelSpec.scala` and `ApiRoutesSpec.scala`.
- No `any`/untyped escape hatches found in the new TS files.

Tests meaningful:
- `TimelineRenderer.test.tsx`: exercises exactly the risk surface called out in the ticket/design — asc/desc ordering, last-entry connector suppression, unbound/empty/single-row/long-description states. These would catch a real regression (e.g. reversing the sort comparator, or losing the last-entry class).
- `TimelineEditor.test.tsx`, `PanelRowMapperSpec` (NULL-column default + round-trip), `PanelSpec` (decode/patch/round-trip + invalid-sort 400), `ApiRoutesSpec` (create + type-echo + invalid-sort 400 + export→import round-trip) all present and pass.

No dead code / no over-engineering: no leftover TODO/FIXME in the new files; `TimelineOptions` deliberately modeled as a typed case class (not a raw `JsObject`) per design.md's stated rationale, consistent with the `ChartPanel.scala` precedent — not over-engineered for a single-field options object.

Non-blocking suggestion: `backend/src/test/scala/com/helio/infrastructure/PanelRowMapperSpec.scala` is now 277 lines, just over the 250-line soft budget (informational-only per `check:scala-quality`, does not block). Not new to this change's scope to fix, flagging for awareness only.

### Phase 3: UI Review — FAIL
Servers started via `scripts/concertino/start-servers.sh` and confirmed healthy via `scripts/concertino/assert-phase.sh servers` (`PASS servers`) before testing. Zero console errors across every flow tested.

**Verified working (desktop, ≥1440px and ~1100px, RGL grid):**
- Happy path end-to-end: type picker → "Timeline" card (icon + "Show a chronological sequence of time-stamped events") → template step → DataType picker (data-bound flow correctly triggered by `DATA_BOUND_TYPES` including `timeline`) → name → create. Live preview correctly showed the unbound placeholder ("Bind a data type to populate this timeline") before a binding existed.
- `TimelineEditor` in the panel-detail modal: DataType picker, `time`/`event` field-mapping selects (`ui-select` popovers), and an "Order" segmented control (Oldest first / Newest first) all render and are operable; saving a `time=amount`/`event=name` mapping persisted and the panel re-rendered with three entries, ascending by `amount` (10, 20, 30), each with a marker + connector, exactly matching the design.
- Rendered panel card is visually distinct from a chart/table (marker/connector/time/description list) and carries the `TIMELINE` type badge.

**Bug found — mobile phone-stack breakpoint (390×844, one of the four required checkpoints):**
The Timeline panel's content collapses to **zero visible height** in the mobile read-only stack (`MobilePanelStack`), even though the DOM contains the correct entries. Confirmed via computed styles: `article.mobile-panel-stack__item--timeline` resolves to `height: 30px`, its `.panel-content--timeline` to `height: 24px`, and the inner `<ol class="panel-content__timeline-list">` to `height: 0px` — the three timeline entries are present in the accessibility tree (`10/Alpha`, `20/Beta`, `30/Gamma`) but invisible on screen. Screenshot evidence captured at `.playwright-mcp/page-2026-07-20T02-16-58-719Z.png`.

Root cause, confirmed by injecting the missing override and re-screenshotting (fix reproduces the correct rendering, `.playwright-mcp/page-2026-07-20T02-17-40-402Z.png`): `frontend/src/features/panels/ui/MobilePanelStack.css` was **not** updated for `timeline` despite `mobilePanelHeights.ts`'s `computeMobilePanelHeight` correctly classifying it as intrinsic (`{ height: null, scrollsInternally: false }`, matching `collection`). The CSS half of that policy was never wired:
- `.mobile-panel-stack__item--collection` is included in the `container-type: inline-size; height: auto; flex-shrink: 0;` override block (`MobilePanelStack.css:43-51`) that restores intrinsic sizing under the card's `container-type: size` containment — `.mobile-panel-stack__item--timeline` is **not** in that selector list.
- There is also no `.mobile-panel-stack__item--timeline .panel-content--timeline { height: auto; overflow: visible; }` rule mirroring the analogous collection rule at `MobilePanelStack.css:85-88` (needed because `TimelineRenderer.css` sets `overflow-y: auto` for the desktop fixed-height case, which — like collection's own CSS — must be overridden back to `visible`/`auto` height in the intrinsic mobile-stack context).

This is a mechanical, reproducible functional bug, not a subjective design call: it directly violates the ticket's AC4 ("degrades gracefully") and the `timeline-panel-rendering` spec's "Rendering scales with panel dimensions" requirement on a supported breakpoint. A user opening any dashboard containing a Timeline panel on a phone sees an effectively empty card.

Other checks:
- No console errors in any flow tested (create, edit/save, desktop render, mobile render).
- Accessible names present on all new interactive elements (Time/Event field comboboxes, Order segmented buttons all correctly labelled).
- Did not additionally re-test 768px in isolation given the phone-stack breakpoint threshold is `< 768` (`PanelGrid.tsx:49`, `isPhone = width < panelGridConfig.breakpoints.sm`) — 768 itself renders the desktop grid, already covered by the 1100/1440 checks above.

### Overall: FAIL

### Change Requests
1. **Fix the mobile phone-stack intrinsic-height wiring for `timeline`** in `frontend/src/features/panels/ui/MobilePanelStack.css`:
   - Add `.mobile-panel-stack__item--timeline` to the `container-type: inline-size; height: auto; flex-shrink: 0;` selector group at `MobilePanelStack.css:43-47` (alongside `--table`, `--markdown`, `--text`, `--image`, `--collection`).
   - Add a rule mirroring `MobilePanelStack.css:85-88` (`.mobile-panel-stack__item--collection .panel-content--collection { height: auto; overflow: visible; }`) for `.mobile-panel-stack__item--timeline .panel-content--timeline`.
   - Re-verify at 390×844 (and ideally add/extend a `MobilePanelStack.test.tsx` case, or a Jest DOM assertion, for a `timeline` panel's computed intrinsic sizing, consistent with the existing `collection` coverage there) that the timeline list is visible with nonzero height and all entries render.

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/infrastructure/PanelRowMapperSpec.scala` is 277 lines, slightly over the 250-line soft budget (informational only per `check:scala-quality`; not a gate failure). Consider a split if touched again.
