## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read all planning artifacts fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-edit-in-place-tools/spec.md`, and round 1's `skeptic-design-1.md` (as a claim to
  verify, not a given).
- Confirmed both round-1 change requests are addressed in the artifacts:
  1. **Scope-completeness gap (4 missing kinds)** — `tasks.md` §1.4 now lists all nine kinds
     (metric/chart/table/text/markdown/image/collection/timeline/divider). I independently
     re-derived the field lists and merge semantics for the four previously-missing kinds
     directly from source and cross-checked every claim in `tasks.md`/`design.md` against it:
     - `ImagePanelConfig`/`ImagePanelConfig.Patch` (`backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala:14-93`)
       — `imageUrl` absent/`null`→`""`/set (lines 66-70 match); `imageFit` absent/`null`→default
       `"contain"`/set-with-allowlist-validation (lines 72-80 match); `caption` absent/`null` or
       blank/whitespace→clear/non-blank→set (lines 82-88 match) — all three claims in `tasks.md`
       lines 35-38 are accurate.
     - `CollectionPanelConfig`/`.Patch` (`CollectionPanel.scala:21-144`) — `dataTypeId`/
       `fieldMapping` standard clear-to-empty-sentinel (lines 107-118 match); `itemOptions`
       clears on `null` OR an empty object (lines 133-139 match `tasks.md` line 40 exactly).
     - `TimelinePanelConfig`/`.Patch` (`TimelinePanel.scala:15-128`) — `dataTypeId`/`fieldMapping`
       standard; `timelineOptions.sort` resets to default `"asc"` on `null` OR an empty object
       (lines 116-123 match `tasks.md` lines 41-42 exactly).
     - `DividerPanelConfig`/`.Patch` (`DividerPanel.scala:11-85`) — `orientation` resets to
       default `"horizontal"` on `null`, enum-validated on set (lines 59-67 match); `weight`/
       `color` standard clear-to-`None` (lines 69-80 match `tasks.md` lines 43-44 exactly).
     Also re-verified `PanelConfigCodec.applyConfigPatch` (`PanelConfigCodec.scala:80-91`) still
     dispatches all nine kinds identically, and re-spot-checked the five previously-verified
     kinds' domain files (`MetricPanel.scala`, `ChartPanel.scala`, `TablePanel.scala`,
     `TextPanel.scala`, `MarkdownPanel.scala`) — all still accurate.
  2. **`bind_panel` cross-reference gap** — `design.md` D6 and `tasks.md` §1.4's fourth bullet
     now both explicitly require the tool description to state that `config.dataTypeId`/
     `config.fieldMapping` are technically patchable but `bind_panel` is preferred. Present in
     both artifacts, not just the design note. Resolved.
- Re-verified the architectural/precedent claims fresh (not assumed from round 1): `write.ts`
  still has `update_panel_appearance` at line 627 and the `## Edit-in-place (HEL-328)` block
  starting ~788 (`grep -n` confirms), consistent with design.md D1's placement decision.
  `updateSchemas.ts`'s header comment and `buildUpdateDataTypeBody` still exist as claimed,
  consistent with D2. `PanelProtocol.scala:70`/`PanelRoutes.scala:64-68` still match the
  `UpdatePanelRequest`/route shape the design's Context describes.

### New gap found in this round's own revision: an undocumented "empty-object-clears" exception on chart `chartOptions`

Cross-checking `ChartPanelConfig.Patch.decode` (`ChartPanel.scala:259-304`) line-by-line — a kind
`design.md`'s Context section explicitly claims to have fully verified — turned up a real,
source-confirmed exception that neither `design.md` nor `tasks.md` documents anywhere:

```scala
// ChartPanel.scala:279-286
// Absent = leave unchanged; null = clear; object = strict-validate and
// replace (an empty object normalizes to a clear via `parse` → None).
val chartOptions = fields.get("chartOptions") match {
  case None              => None
  case Some(JsNull)      => Some(None)
  case Some(o: JsObject) => Some(ChartOptions.parse(o, strict = true))
  ...
```

`ChartOptions.parse` (`ChartPanel.scala:84-95`) returns `None` whenever the parsed composite
carries no populated sub-field across `line`/`bar`/`pie`/`scatter` — i.e. sending
`config: { chartOptions: {} }` (or any object whose nested per-type keys don't end up populating
a value, e.g. `{"line": {}}`) silently **clears** the panel's existing `chartOptions`, exactly the
same shape as the `itemOptions`-clears-on-empty-object exception `tasks.md` already documents for
`collection` and the `timelineOptions`-resets-on-empty-object exception it documents for
`timeline`. But `tasks.md`'s chart bullet (line 27) bundles `chartOptions` into the plain
`"(standard)"` group alongside `dataTypeId`/`fieldMapping`/`aggregation`/`metricId`, and only
carves out `annotation` as an exception. `design.md`'s Context section (lines 34-35) mirrors this
same omission — it names only the `annotation` exception for chart, not `chartOptions`.

This is a real risk in exactly the direction the ticket exists to close: an agent calling
`update_panel` to patch one chart field (say, `annotation`) while defensively also sending
`chartOptions: {}` — believing an empty object is a harmless no-op, as it would be for e.g.
`aggregation` or `fieldMapping` (which have no such collapse-to-clear rule) — would silently wipe
any previously-set bar/line/pie/scatter display options. AC4 requires merge semantics "verified
against the backend rather than asserted" for exactly this reason; this specific field's
behavior was asserted (implicitly, via omission) rather than verified, despite the source
comment stating the exception in plain language immediately adjacent to the code this design
doc cites as already-read.

### Secondary, lower-severity gap: collection `baseType`/`layout` don't name their reset value

`tasks.md` line 39 labels `collection`'s `baseType` and `layout` as `"(standard)"` (`layout` with
an enum-validation caveat, but no reset-value caveat). Per `CollectionPanel.scala:184-185`:

```scala
baseType = patch.baseType.fold(config.baseType)(_.getOrElse(CollectionPanelConfig.DefaultBaseType)),
layout   = patch.layout.fold(config.layout)(_.getOrElse(CollectionPanelConfig.DefaultLayout)),
```

Both are non-`Option` domain fields (like `divider.orientation`/`image.imageFit`/
`timeline.timelineOptions.sort`, all three of which `tasks.md` correctly documents as "resets to
default `X`, NOT a clear") — an explicit `null` resets them to the *named* defaults `"metric"`/
`"grid"` specifically, not to a generic empty/unset state. `tasks.md` names the specific default
value for every other field with this exact reset-to-default shape (orientation→`"horizontal"`,
imageFit→`"contain"`, timelineOptions.sort→`"asc"`) but not for `baseType`/`layout`, an
inconsistency in the same list. Lower functional risk than the `chartOptions` gap above (`layout`
only has two valid values and its default is also its natural fallback, so surprise is unlikely),
but still a fact the tool description should state precisely per AC4, for the same reason the
sibling fields already do.

### Verdict: REFUTE

Round 1's two change requests are fully and accurately resolved — that work is solid. This round's
REFUTE is narrower and specific to a new gap my own fresh source cross-check surfaced.

### Change Requests

1. **Document `chartOptions`'s empty-object-clears exception.** Add to `tasks.md` §1.4's chart
   bullet and `design.md`'s Context: `chartOptions` absent = unchanged, explicit `null` = clear,
   a non-null object = strict-validated and replaces — **but** an object that, after per-type
   validation, carries no populated `line`/`bar`/`pie`/`scatter` sub-field (including a bare `{}`)
   also normalizes to a full clear, not a no-op or "set to empty options." Source:
   `ChartPanel.scala:279-286` (`ChartPanelConfig.Patch.decode`), `ChartPanel.scala:84-95`
   (`ChartOptions.parse`).
2. **Name the reset value for `collection.baseType`/`collection.layout`.** Update `tasks.md`
   §1.4's collection bullet to state explicitly that `null` resets `baseType`→`"metric"` and
   `layout`→`"grid"` (not a generic clear), matching the treatment already given to `orientation`/
   `imageFit`/`timelineOptions.sort` elsewhere in the same list. Source:
   `CollectionPanel.scala:184-185`.

### Non-blocking notes

- The rest of the design remains sound: thin-passthrough architecture, no backend changes,
  `updateSchemas.ts` body-builder placement (D2), Zod shape choice (D3), `type` retained in the
  tool (D4), no new capability (D5) — all still verified against source this round.
- `ChartPanel.rejectsAggregation`'s scatter+aggregation 400 conflict (`ChartPanel.scala:370-373`)
  is a cross-field validation rule, not a per-field merge-semantics question, and is out of AC4's
  literal scope; flagging only as an FYI, not a required addition.
- Same environmental note as round 1: this worktree's `scripts/concertino/` directory is missing
  the gitignored, `concertino sync`-generated helper scripts present in the main checkout
  (`next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`, etc. all absent here). I
  routed around this by invoking the main checkout's copies directly against this worktree's
  paths, as round 1 did — they are pure path-parameterized utilities with no repo-state
  dependency, so this is safe. Flagging for awareness across rounds, not as a design defect in
  this change.
