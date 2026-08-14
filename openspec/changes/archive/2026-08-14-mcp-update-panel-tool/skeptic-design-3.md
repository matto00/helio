## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read all planning artifacts fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-edit-in-place-tools/spec.md`, plus round 1's and round 2's skeptic reports
  (`skeptic-design-1.md`, `skeptic-design-2.md`) — treated as claims to verify, not as given fact.
- Primary focus per this round's brief: independently re-derived `chart.chartOptions`'s and
  `collection.baseType`/`collection.layout`'s merge semantics directly from source and compared
  line-by-line against the *current* `design.md`/`tasks.md` text (not round 2's report text):
  - **`ChartPanelConfig.Patch.decode`** (`backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala:281-286`):
    `chartOptions` — absent → `None` (unchanged); `Some(JsNull)` → `Some(None)` (clear);
    `Some(o: JsObject)` → `Some(ChartOptions.parse(o, strict = true))`. `ChartOptions.parse`
    (`ChartPanel.scala:84-95`) returns `None` when the parsed composite carries no populated
    `line`/`bar`/`pie`/`scatter` sub-field — including a bare `{}` — so a non-null-but-empty object
    also collapses to a clear via the outer `Some(None)`. `design.md` lines 38-43 and `tasks.md`
    lines 29-32 both state exactly this, including the "an agent sending `chartOptions: {}` 'just
    to be safe' silently wipes existing display options" risk framing. Matches source exactly —
    round 2's change request 1 is correctly and precisely resolved.
  - **`CollectionPanelConfig.applyPatch`** (`backend/src/main/scala/com/helio/domain/panels/CollectionPanel.scala:180-188`):
    `baseType = patch.baseType.fold(config.baseType)(_.getOrElse(CollectionPanelConfig.DefaultBaseType))`
    and `layout = patch.layout.fold(config.layout)(_.getOrElse(CollectionPanelConfig.DefaultLayout))`,
    with `DefaultBaseType = "metric"` / `DefaultLayout = "grid"` (`CollectionPanel.scala:30-31`) —
    an explicit `null` on either resets to the *named* default, not a generic clear; `layout` is
    additionally enum-validated (`ValidLayouts = Set("grid", "list")`) on a non-null value, 400ing
    on an invalid string (`CollectionPanel.scala:128-131`). `itemOptions` clears on `null` **or**
    an empty object (`Some(o: JsObject) if o.fields.isEmpty => Some(None)`,
    `CollectionPanel.scala:136`). `design.md` lines 49-55 and `tasks.md` lines 43-46 state exactly
    this, naming `"metric"`/`"grid"` explicitly. Matches source exactly — round 2's change request 2
    is correctly and precisely resolved.
- Extended the cross-check beyond the two flagged fields to re-verify every other patchable kind's
  documentation against its current domain source, since a design gate should not re-trust round 1's
  and round 2's now-stale per-kind verification once the document has since been edited around it:
  - `MetricPanelConfig`/`.Patch` (`MetricPanel.scala:25-135`) — `unit`/`label`/`dataTypeId`/
    `fieldMapping`/`aggregation`/`metricId` all standard absent/null-clear/set. Matches
    `tasks.md` line 26.
  - `TablePanelConfig`/`.Patch` (`TablePanel.scala:24-144`) — `columnWidths`/`columnOrder`/
    `dataTypeId`/`fieldMapping`/`metricId` standard; `density` 400s on an invalid enum value via
    `RequestValidation.validateTableDensity` rather than silently dropping it
    (`TablePanel.scala:114-123`). Matches `tasks.md` lines 33-35.
  - `TextPanelConfig`/`.Patch` (`TextPanel.scala:10-83`) — `content` is a bare `String` (no
    `Option[Option[_]]` wrapper): absent → unchanged, `JsNull` → `Some("")` (clears to empty
    string, not "removed"); `dataTypeId`/`fieldMapping` standard. Matches `tasks.md` lines 36-38.
    (`MarkdownPanel.scala` mirrors this shape per design.md's own citation; not re-read verbatim
    this round since `TextPanel.scala`'s identical pattern was directly confirmed and design.md
    explicitly notes the mirror.)
  - `ImagePanelConfig`/`.Patch` (`ImagePanel.scala:14-93`) — `imageUrl` absent/`null`→`""`/set;
    `imageFit` absent=unchanged/`null`→default `"contain"`/set-with-allowlist-validation via
    `RequestValidation.validateImageFit`; `caption` absent=unchanged/`null` or blank/whitespace→
    clear/non-blank→set (`ImagePanel.scala:82-88`). Matches `tasks.md` lines 39-42.
  - `TimelinePanelConfig`/`.Patch` (`TimelinePanel.scala:15-128`) — `dataTypeId`/`fieldMapping`
    standard; `timelineOptions.sort` absent=unchanged, `null` **or** an empty object (line 119:
    `Some(o: JsObject) if o.fields.isEmpty => Some(None)`) → resets to default `"asc"` via
    `applyPatch`'s `_.getOrElse(TimelineOptions.Default)` (`TimelinePanel.scala:168`). Matches
    `tasks.md` lines 47-48.
  - `DividerPanelConfig`/`.Patch` (`DividerPanel.scala:11-85`) — `orientation` absent=unchanged
    (`Option[String]`, not `Option[Option[_]]`: `Patch.decode`'s `None` case leaves it out of the
    result, and `applyPatch`'s `.getOrElse(config.orientation)` preserves the stored value),
    `null`→resets to default `"horizontal"` (decode returns `Some(DefaultOrientation)` directly on
    `JsNull`), enum-validated via `RequestValidation.validateDividerOrientation` on a non-null
    value; `weight`/`color` standard absent/null-clear/set. Matches `tasks.md` lines 49-50.
  - `PanelConfigCodec.applyConfigPatch`/`encodeConfig` (`PanelConfigCodec.scala:29-38`, `82-91`) —
    re-confirmed dispatch covers all nine kinds identically (metric/chart/table/text/markdown/
    image/divider/collection/timeline), no kind bypasses the codec.
  - `PanelServiceHelpers.resolvePatch` (`PanelServiceHelpers.scala:21-48`) — re-confirmed: blank
    `title` rejected, `type` mismatch vs. stored `kind` 400s, `configPatch` preserved as raw JSON
    for later dispatch, "at least one field required" gate. Matches `design.md`'s Context verbatim.
  - `helio-mcp/src/tools/updateSchemas.ts` header comment and `buildUpdateDataTypeBody`/
    `buildUpdatePipelineStepBody` — re-confirmed present and shaped exactly as `design.md` D2/D3
    describe (include a key only when the caller supplied it; `fields`/`computedFields` replace
    wholesale, stated explicitly in the module's own doc comment).
  - `helio-mcp/src/tools/write.ts` — re-confirmed `update_panel_appearance` at line 627 and the
    `## Edit-in-place (HEL-328)` block (`update_data_type`/`update_pipeline_step` etc.) starting
    at line 781, consistent with design.md D1's placement decision to put `update_panel`
    immediately after `update_panel_appearance` rather than inside that fixed four-tool block.
- Scanned all four planning artifacts plus the spec delta for `TODO`/`TBD`/"figure out later"/
  deferred decisions — none found.
- Confirmed the worktree has no code changes yet (`git status --short` shows only the untracked
  `openspec/changes/mcp-update-panel-tool/` directory, `git diff --stat` empty) — appropriate for
  a design gate, work has not started.
- Confirmed every AC in `ticket.md` maps to a concrete tasks.md item: AC1 (tool registered/callable)
  → §1.1-1.4; AC2 (`title` editable) → §1.4's field list + spec's first scenario; AC3 (metric
  `unit`/chart `annotation`/markdown `content` editable in place) → spec's three dedicated
  scenarios + tasks.md's per-kind field lists; AC4 (merge semantics stated precisely, verified not
  assumed) → tasks.md §1.4's full nine-kind enumeration, now independently re-verified above; AC5
  (README + `dist/` rebuilt) → tasks.md §3.1-3.2.

### Verdict: CONFIRM

Both round-2 change requests are resolved precisely and correctly, verified against the current
source rather than trusted from either prior report. My own fresh, independent re-derivation of
every one of the nine patchable panel kinds' merge semantics (not just the two rounds 1/2 flagged)
matches `design.md`/`tasks.md`'s current text field-for-field, with no new gap. The plan is
complete against AC4's "verified against the backend rather than asserted" bar, internally
consistent across `proposal.md`/`design.md`/`tasks.md`/`spec.md`, free of placeholders or deferred
decisions, and scoped tightly to the ticket (thin MCP-layer pass-through, no backend changes).
Sound enough to implement.

### Non-blocking notes

- The design's own "Risks / Trade-offs" section already names "per-kind config field list going
  stale" as an accepted, precedent-matching risk (same as `create_panel`'s) — no action needed, but
  worth the executor keeping this doc block accurate if a tenth panel kind or a new field on an
  existing kind lands before this ships.
- Same environmental note as rounds 1 and 2: this worktree's `scripts/concertino/` directory is
  still missing the gitignored, `concertino sync`-generated helper scripts present in the main
  checkout (`next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`, etc.). I routed around
  this by invoking the main checkout's copies directly against this worktree's paths, as both prior
  rounds did — they are pure path-parameterized utilities with no repo-state dependency, so this is
  safe. Flagging for awareness only, not a design defect in this change.
