## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/{output-conditional-formatting,output-routes-api,mcp-output-tools}/spec.md.
Worktree HEAD 5dceeae9d11ca1b0a8891ad31f0a2c4397b92521 (no code changes yet; change dir untracked). I checked the
design's claims against the code in the worktree.

### What I verified (with evidence)

**The backend write-path coverage holds.** Every Output-config write reaches one of the two hook points D2 names:
- Output create calls `OutputService.validateConfig(kind, config, empty)` (OutputService.scala:135).
- Output update calls `validateConfig(..., policy)` (OutputService.scala:208).
- Patch-set preview calls `validateConfig` with the default ValidateWrite policy (PatchSetPreviewProjection.scala:135).
- Patch-set apply goes through `outputService.update(id, request, user)` with the default policy
  (PatchSetApplyForward.scala:105).
- Rollback passes `RestorePriorStored` (PatchSetApplyRollback.scala:185). Undo restores through raw `insertInternal`
  with no validation (PatchSetUndoService.scala:298-303). Both are exempt, which matches the spec.
- Single-call create runs `PipelineCreatePreflight.checkOutput` → `validateOutputConfig` (PipelineCreateTransaction.scala:261,
  PipelineCreatePreflight.scala:197-207).
- Proposal grounding runs `validateOutputFieldMapping` → `PipelineCreatePreflight.validateOutputConfig`
  (PipelineProposalAnalyze.scala:149, PipelineServiceSupport.scala:71).
- No other `insertInternal`/`insertInternalAction` caller writes Output config (grep).

**Spec and design agree on the rollback/undo exemption.** D2 gates the new validator behind ValidateWrite, as the
key check is gated today (OutputConfigValidation.scala:186-189). The spec says restores are exempt. These match.
`compare`/`historyPayloads` still run under RestorePriorStored, but this design does not change that.

**KeysDoc fans out as claimed.** It reaches AssistantProposalToolSchemas.scala:256,397 and RefinementEditShape.scala:266.
In helio-mcp, `OUTPUT_CONFIG_KEYS_DOC` is imported by combinedProposal, refinement, pipelines and pipelineProposal,
so the mcp spec's "every config-writing tool" is covered by task 2.2. The three schema files exist under
`*.schema.json` names (the design omits the suffix, which is harmless).

**The frontend seams exist as described.**
- `MetricOutputPanel` builds `data.value` as the raw string (MetricOutputPanel.tsx, `value`/`data`).
- `CollectionRenderer` renders one `MetricRenderer` per row.
- `ColumnDef` has `render` but no cell-class hook (DataGrid.tsx:29-34, td at :1250-1268).
- `rowClassName` is passed through by TableRenderer (:792) and used by HistoryRows.
- Pinned body cells are painted `var(--panel-surface-override, var(--app-surface))` (DataGrid.css:212-213).
- The public viewer renders through the same `OutputPanelContent`.
- lucide 1.43 exports `CircleCheck`, `TriangleAlert` and `CircleX`.
- `ICON_SIZE` (shared/ui/iconSize.ts) exists.
- The intent tokens and their `-surface` washes exist in both themes (theme.css:197-218, 282-288).
- contrast-audit §2 records tone-on-own-wash at 4.5:1 or better.

**The no-rules path is unchanged by design.** The MetricRenderer and TableRenderer props are optional, `cellClassName`
is additive, and the builder emits conditionally (D7), so existing snapshots stay untouched.

**I measured the unit contrast myself.** I recomputed the WCAG contrast of `.panel-content__metric-unit`
(PanelContent.css:36-42, `color: color-mix(in srgb, currentColor 60%, transparent)`) over `--app-surface`. The value
it inherits under D4 would be the tone:

| Theme | Unit colour | Contrast |
| ----- | ----------- | -------- |
| light | success / warning / error | 2.71 / 2.66 / 2.86 |
| dark | success / warning / error | 3.67 / 4.40 / 3.14 |
| light | `--app-text` (today) | 4.40 |
| dark | `--app-text` (today) | 6.24 |

The unit is `--text-sm` (small text), so the 4.5:1 floor applies.

### Verdict: REFUTE

### Change Requests

1. **D4 "The unit inherits the colour" would ship a contrast failure.** The unit renders at 60% of `currentColor`
   (PanelContent.css:40). With a tone as `currentColor`, the small unit text measures 2.66-2.86:1 in light and
   3.14-4.40:1 in dark, below 4.5:1. That conflicts with DESIGN.md's contrast floor and docs/contrast-audit.md.
   - Revise D4 so the unit does not take the 60%-of-tone colour. Either keep it neutral (do not scope the tone class
     over `.panel-content__metric-unit`), or render it at the full tone colour.
   - Add a computed-style or contrast assertion for the unit to 4.4/4.7.

2. **D6 wash layering is under-specified and invites cross-intent stacking.** D6 says the row wash must paint "on the
   cells ..., not only on the `<tr>`". Read literally, that paints the translucent wash twice on unpinned cells (tr plus
   td). That doubles the audited 11%/14% tint. It also puts a cell rule's own wash on top of the row's wash: for
   example, warning text on warning-surface over error-surface. That is the unmeasured cross-intent composite class
   contrast-audit §4 says no component produces. The spec requires the cell rule to *decide* the cell's text colour and
   wash, not add to it. Revise D6 to state:
   - (a) the row wash is painted on the row's cells only, never also on the `<tr>`;
   - (b) a cell-rule wash replaces the row wash on that cell (no layering);
   - (c) on pinned cells the opaque base layer is exactly `var(--panel-surface-override, var(--app-surface))`, not a
     bare `--app-surface`;
   - (d) unpinned cells keep the plain translucent wash, so a customised or translucent panel background is still
     respected (DataGrid.css:197-213 rationale).
   Add a test task asserting a cell-rule cell inside a row-washed row carries only its own tone's background.

3. **A row rule on a column the table does not display leaves colour as the only signal.**
   - `columnOrder` can hide columns (TableRenderer.tsx:171-177 renders exactly the listed keys).
   - The spec places a row rule's glyph and label in "the row rule's column cell". If that column is hidden, rows are
     washed but no glyph or accessible text appears anywhere.
   - That violates owner ruling 4 and the spec's own "Every value styled by a rule SHALL also render a glyph".
   Specify the behaviour in both spec and design, for example "in the first displayed cell of the row when the rule's
   column is not displayed". Add a renderer test for it to 4.4.

4. **The spec Purpose contradicts the design's exclusions.** `output-conditional-formatting/spec.md` Purpose says
   styling applies "on every surface that renders those Outputs". Two surfaces are not covered:
   - Design Non-Goals exclude `HistoryRows`.
   - The design never mentions the Output editor's `OutputPreviewPane`, which renders `MetricRenderer`
     (OutputPreviewPane.tsx:145) and a plain preview table.
   Narrow the Purpose to the dashboard surfaces (authenticated, public, fullscreen, mobile), matching the "Rendering
   per Output kind" requirement. Also state explicitly whether the editor preview applies rules. If it does not, list
   it as a non-goal beside HistoryRows, so neither the executor nor the evaluator has to guess.

### Non-blocking notes

- Task 4.2 lists create/PATCH, single-call and patch-set preview. The spec also names proposal grounding (expected
  shape: a `validationError` on the proposal's Output) and patch-set apply. Coverage is by construction (shared
  functions), but one test each would make the spec's list fully traced.
- Rule-shape nulls are unspecified: `label: null`, `target: null`, `value2: null` on a non-between rule. Say whether
  JSON `null` means "absent" or is rejected. MCP and LLM clients send nulls routinely, and the seam fixture's `invalid`
  cases should pin the choice.
- D5 says glyphs are "sized via the existing icon-size tokens". There are no CSS icon-size tokens. The existing
  mechanism is the TS constant `ICON_SIZE` (shared/ui/iconSize.ts); cite that.
- TableRenderer.tsx is 885 lines and DataGrid.tsx is 1287. CONTRIBUTING.md:24 says not to add to files over ~400 lines
  without proposing a split. Keep the table rule wiring in `conditionalFormatting.ts` or a small hook (column
  decoration plus row-class composition), so TableRenderer gains only the call site.
- When a cell rule already styles the row rule's column cell, the row rule's label is never exposed. That is
  acceptable, but say it in the spec so it is not later reported as a defect.
- Pre-existing and out of scope: the light-theme metric unit already measures 4.40:1 (60% `--app-text` on
  `--app-surface`). Worth a follow-up ticket.
- D2 validates the merged config, so a PATCH that touches an unrelated key re-checks the stored list. That is fine
  because the key is new. D2 already says so.
