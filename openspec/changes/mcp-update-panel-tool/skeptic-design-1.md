## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-edit-in-place-tools/spec.md`, `workflow-state.md`.
- Cross-checked every backend claim in `design.md`'s "Context" section against the actual
  source, not the ticket's or design's prose:
  - `PanelServiceHelpers.resolvePatch` (`backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:21-48`)
    — confirmed: `title` trimmed + rejected if blank; a request `type` that differs from
    `existing.kind` is rejected (400); `configPatch` is preserved as raw JSON, decoded later;
    "at least one field required" gate matches design.md's description exactly.
  - `PanelConfigCodec.applyConfigPatch` (`backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:77-91`)
    — confirmed: dispatches to the panel's STORED kind's own `<Kind>PanelConfig.Patch.decode`,
    for **every** panel subtype (metric/chart/table/text/markdown/image/divider/collection/timeline),
    not just the five the ticket names.
  - `ChartPanelConfig.Patch.decode` (`ChartPanel.scala:259-304`) — confirmed the documented
    `annotation` exception verbatim: absent = unchanged, `null`/blank/whitespace = clear,
    non-blank = set (`ChartPanel.scala:288-294`).
  - `TextPanelConfig.Patch.decode` / `MarkdownPanelConfig.Patch.decode` (`TextPanel.scala:59-82`,
    `MarkdownPanel.scala:59-82`) — confirmed the documented `content` exception: absent =
    unchanged, `JsNull` → `""` (not "removed", correctly described as no-Option-wrapper).
  - `MetricPanelConfig`/`TablePanelConfig` field lists in `tasks.md` §1.4 (unit/label/
    dataTypeId/fieldMapping/aggregation/metricId; columnOrder/density/columnWidths/
    dataTypeId/fieldMapping/metricId) — confirmed against `MetricPanel.scala:25-33`,
    `TablePanel.scala:24-32` field-for-field.
  - Verified the design's every merge-semantics claim is accurate — none of it is asserted
    without grounding; this is genuinely well-researched.
- Read `helio-mcp/src/tools/updateSchemas.ts` (existing `buildUpdateDataTypeBody`/
  `buildUpdatePipelineStepBody`) and `helio-mcp/src/helioApi.ts`'s `bindPanel`/
  `updatePanelAppearance` — confirmed the proposed `buildUpdatePanelBody`/`updatePanel`
  shapes in `tasks.md` §1.1-1.3 are a faithful, low-risk mirror of the established pattern
  (include a key only when `!== undefined`; thin `PATCH /api/panels/:id` pass-through).
- Read `helio-mcp/src/tools/write.ts`'s `create_panel` registration (lines 423-476) — the
  precedent `design.md` explicitly says the new tool's per-kind config documentation
  "mirrors" — to check whether `tasks.md`'s actual documentation scope matches that claim.

### Gap found: tasks.md §1.4 documents config fields for only 5 of 9 patchable panel kinds

`create_panel`'s real description (`write.ts:427-463`) documents config fields for **8**
creatable kinds (metric/chart/table/text/markdown/**image/collection/timeline**).
`update_panel`'s config patch is a **blind JSON pass-through** dispatched by
`PanelConfigCodec.applyConfigPatch` on the panel's *stored* kind — verified above to cover
**all 9** subtypes, including `image`/`collection`/`timeline`/`divider`. But `tasks.md` §1.4
only asks the tool description to enumerate field names for metric/chart/table/text/markdown
— it never mentions image, collection, timeline, or divider at all, anywhere in the change's
artifacts.

I verified each of the four omitted kinds has real patchable fields with genuine, and in one
case novel, merge-semantics exceptions that a caller has no way to learn without reading the
Scala source themselves:

- **image** (`ImagePanelConfig.Patch`, `ImagePanel.scala:53-93`): `imageUrl` (absent=unchanged,
  `null`→`""`), `imageFit` (absent=unchanged, `null`→resets to default `"contain"`, non-null
  validated against an allow-list), `caption` (absent=unchanged, `null`/blank/whitespace→clears)
  — this last one is a **third instance** of the exact "annotation-style" clear-on-blank
  exception `design.md` already documents for chart, silently dropped only because image isn't
  in scope.
- **collection** (`CollectionPanelConfig.Patch`, `CollectionPanel.scala:91-144`):
  `dataTypeId`/`fieldMapping`/`baseType`/`layout` (enum-validated)/`itemOptions`
  (absent=unchanged, `null` **or an empty object**→clears).
- **timeline** (`TimelinePanelConfig.Patch`, `TimelinePanel.scala:91-128`):
  `dataTypeId`/`fieldMapping`/`timelineOptions.sort` (absent=unchanged, `null` or empty
  object→resets to default `"asc"`).
- **divider** (`DividerPanelConfig.Patch`, `DividerPanel.scala:46-85`): `orientation`
  (absent=unchanged, `null`→resets to default `"horizontal"` — **not** a genuine clear, a
  fourth, previously-uncatalogued exception shape), `weight`/`color` (standard absent/null/set).

This isn't cosmetic. It directly conflicts with:
1. The ticket's own **AC4**: "Tool description states exactly which fields are patchable and
   the merge semantics of each, verified against the backend rather than asserted" — no
   scoping to a subset of kinds.
2. `design.md`'s own stated Goal: "a tool description precise enough that an agent knows, **per
   panel kind**, which `config` keys are patchable."
3. `design.md`'s own claim that the documentation plan "mirrors `create_panel`'s per-type list"
   — it doesn't; `create_panel`'s real list is 3 kinds wider.

Left as planned, an agent has no way to learn from `update_panel`'s description that an
image's caption, a collection's layout, a timeline's sort order, or a divider's weight/color
can be edited in place — which is exactly the "delete-and-recreate churn" failure mode the
ticket exists to close, just for a different set of panel kinds than the ticket's own
motivating example happened to hit.

### Secondary gap: design.md commits to a cross-reference note that tasks.md drops

`design.md`'s Non-Goals section explicitly commits: a panel's `dataTypeId`/`fieldMapping`
technically travel through `config` too, and this should be "documented as a cross-reference,
not a redundant capability" pointing back to `bind_panel`. `tasks.md` §1.4's list of what the
tool description must state (fields, `type` validation, `config` merge semantics + the two
exceptions, per-kind field names) never mentions this cross-reference. Since `tasks.md` is the
artifact that actually drives the executor, this commitment as currently written will silently
not happen unless the executor independently rediscovers `design.md`'s Non-Goals text.

### Verdict: REFUTE

### Change Requests

1. **Extend `tasks.md` §1.4** (and `design.md`'s Context/Goals, if it wants to keep asserting
   full "verified against the backend" coverage) to document config field names and merge
   semantics for **all** patchable panel kinds, not just metric/chart/table/text/markdown:
   - image: `imageUrl` (absent=unchanged, `null`→`""`), `imageFit` (absent=unchanged,
     `null`→default `"contain"`, validated enum), `caption` (absent=unchanged, `null`/blank/
     whitespace→clear — same exception shape as chart `annotation`).
   - collection: `dataTypeId`/`fieldMapping`/`baseType`/`layout` (validated enum)/`itemOptions`
     (absent=unchanged, `null` or empty object→clear).
   - timeline: `dataTypeId`/`fieldMapping`/`timelineOptions.sort` (absent=unchanged, `null` or
     empty object→resets to default `"asc"`).
   - divider: `orientation` (absent=unchanged, `null`→resets to default `"horizontal"`, not a
     clear), `weight`/`color` (standard absent/null/set).
   Source: `ImagePanel.scala:53-93`, `CollectionPanel.scala:91-144`, `TimelinePanel.scala:91-128`,
   `DividerPanel.scala:46-85` — all confirmed dispatched identically to the five documented
   kinds via `PanelConfigCodec.applyConfigPatch` (`PanelConfigCodec.scala:80-91`).
2. **Add the `dataTypeId`/`fieldMapping`-via-`config` cross-reference to `bind_panel`** into
   `tasks.md` §1.4's explicit list of what the tool description must state, so `design.md`'s
   Non-Goals commitment to document it as "a cross-reference, not a redundant capability"
   actually reaches the artifact that drives implementation.

### Non-blocking notes

- The rest of the design — thin-passthrough architecture, no backend changes, `updateSchemas.ts`
  body-builder placement (D2), Zod shape choice (D3), keeping `type` in the tool despite the
  `update_pipeline_step` precedent (D4), no new capability (D5) — is sound, consistent with the
  existing HEL-328 pattern, and every merge-semantics claim I checked against source was
  accurate. This is a well-grounded design; the gap above is scope-completeness, not correctness
  of what's already planned.
- This worktree's `scripts/concertino/` is missing several gitignored, `concertino sync`-generated
  helper scripts (`next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`, etc.) that
  exist in the main checkout but were never copied into this worktree (they're untracked, and
  `setup-worktree.sh` only populates tracked files + `CONCERTINO_ENV_FILES`/`CONCERTINO_LINK_MODULES`).
  I routed around this by invoking the main checkout's copies of these scripts directly against
  this worktree's paths (they are pure path-parameterized utilities with no repo-state
  dependency, so this is safe) rather than guessing a fallback filename. Flagging for awareness,
  not as a design defect in this change.
