## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed the current ticket.md, proposal.md, design.md, tasks.md and specs/{output-conditional-formatting,
output-routes-api,mcp-output-tools}/spec.md. The worktree HEAD is 5dceeae9d11ca1b0a8891ad31f0a2c4397b92521. There is
no code change yet; only the change dir is untracked. I checked every design claim against the code in this worktree
myself. I did not take round 1's findings on trust.

### What I verified (with evidence)

**Backend write paths.**
- `OutputConfigValidation.validateConfig` (OutputConfigValidation.scala:186-201) gates the key check on
  `ValidateWrite`, then validates the MERGED config.
- `PipelineCreatePreflight.validateOutputConfig` (PipelineCreatePreflight.scala:204-208) chains `validate`,
  `OutputCompare` and `PayloadOptIn` separately. D2's two hook points are therefore exactly right.
- Output kind is immutable on update: `OutputService.update` uses `output.kind` (OutputService.scala:208). A table
  rule list can never be re-judged under the metric kind.
- `KnownKeys` is the only per-kind list in the backend. The only other mention is a doc comment at
  OutputProtocol.scala:14.
- No frontend file hand-copies the key list. The hand copies are the three `*.schema.json` descriptions (verified) and
  helio-mcp `OUTPUT_CONFIG_KEYS_DOC`. That doc is imported by combinedProposal, pipelines, pipelineProposal and
  refinement, so task 2.1/2.2 cover every copy.

**Spec deltas.**
- The MODIFIED `output-routes-api` requirement header matches openspec/specs/output-routes-api/spec.md:442.
- The delta keeps all five existing scenarios.
- The `mcp-output-tools` ADDED requirement fits beside the existing :222 requirement.

**Public path.** `PublicPanelOutputMetaResolver.scala:31-35` returns the raw stored config, so no backend public
change is needed.

**Rendering seams.**
- `MetricOutputPanel` builds `data.value` as a raw string.
- `CollectionRenderer` builds one `MetricRenderer` per raw-string row.
- `DataGrid` `<td>` has only a pinned class today (DataGrid.tsx:1250-1268). The row class goes on the `<tr>`
  (:1225-1233).
- No tbody hover or zebra background exists that a td wash would fight. The only td backgrounds are the pinned rule
  (DataGrid.css:212-213) and none.
- `leadingColumns` is only used by `HistoryRows`, which is excluded. So "first visible data cell" is unambiguous.
- `MetricRenderer` call sites: OutputPreviewPane:145, MetricOutputPanel:132, CollectionRenderer:66 and the legacy
  PanelContent:253. This matches D4.

**Editor.**
- `configPatch.buildConfigPatch` diffs the built config against the opening-state build and sends only changed keys.
  D7's "emit only when rules exist or the stored config had the key, `[]` to clear" composes correctly with it:
  - untouched means no diff;
  - removing all rules diffs to `[]`.
- `buildAggregateTailConfigs` exists and has a metric branch, so "BOTH builder paths" (D7, task 3.6) is real.

**Tokens and contrast.**
- `--app-{success,warning,error}` and their `-surface` washes exist in both themes (theme.css:197-218, 282-288).
- contrast-audit §2 records each tone on its own wash at 4.62-5.42 (light) and 4.63+ (dark).
- §1 records light `--app-warning` on `--app-surface` at 5.67.
- `.sr-only` exists (theme.css:505). lucide `ICON_SIZE` is at shared/ui/iconSize.ts.

**Round-1 items, re-judged independently.**
- D4 no longer lets the unit inherit 60% of the tone.
- D6 now states one wash per cell, cell-replaces-row, td-only row wash, and a pinned gradient over
  `var(--panel-surface-override, var(--app-surface))`.
- The hidden-column row glyph rule is specified in both the spec and D6.
- The Purpose is narrowed, and the editor metric preview is explicitly in scope.
- JSON-null-as-absent is specified.
- Task 4.2 now names proposal grounding and patch-set apply.

The design is now sound in structure. One new defect remains, introduced by the round-1 fix.

**Measured defect (D4 unit pin).**
- `.panel-content__metric-value` is `color: inherit` (PanelContent.css:18).
- The panel's colour is `var(--panel-text-override, var(--app-text))` (PanelGrid.css:42).
- `getPanelCardStyle` ALWAYS sets `--panel-text-override` from `resolvePanelTextColor`, a contrast-picked colour
  against the panel's custom background (PanelCard.tsx:23-38, appearance.ts:245-265). The mobile stack reuses the same
  style.
- The unit's colour today is therefore 60% of `--panel-text-override`, not 60% of `--app-text`.
- D4 says it will pin the unit to `color-mix(in srgb, var(--app-text) 60%, transparent)`, "i.e. its colour today". That
  claim is false for any panel with a custom background or text colour. There, the picker may have chosen light text
  over a dark tint, or the reverse. On a toned metric the pinned unit would then switch to the theme's default text
  colour, on a background that colour was rejected for.
- This contradicts the spec ("its unit SHALL keep its existing neutral colour"). Task 4.4's "unit keeps neutral colour"
  test, written against D4, would encode the bug and pass.

### Verdict: REFUTE

### Change Requests

1. **design.md D4: the unit's colour must not change on a toned metric, including on custom-coloured panels.** Replace
   the `var(--app-text) 60%` pin with one of these:
   - (a) **Preferred:** put the tone class on an inner span that wraps only the formatted value text (and glyph). Leave
     `.panel-content__metric-value` and `.panel-content__metric-unit` CSS untouched, so the unit keeps inheriting
     exactly as today.
   - (b) Pin the unit to `color-mix(in srgb, var(--panel-text-override, var(--app-text)) 60%, transparent)`.

   Delete the "i.e. its colour today" claim, or correct it. Extend task 4.4 (or 4.7) with an assertion that would
   actually catch this: under a toned value, the unit's colour is unchanged from the no-rules render, with a non-default
   `--panel-text-override` set on an ancestor. A test that only runs under the default override cannot fail on this
   defect.

### Non-blocking notes

- **Table cell truncation.** `tbody td` truncates with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
  (DataGrid.css:357-364). Keep the glyph and value wrapper inline (not `display:flex`/`inline-flex`, which defeats
  td-level ellipsis), and check a long toned cell truncates in the C4 browser pass.
- **Risks vs D8.** Risks says the seam fixture's `invalid` cases "run against both" validators. D8 and task 4.5 only
  run `valid` cases on the frontend. Either add an editor or validator-side pass over the reachable `invalid` cases
  (`between` with `value > value2`, empty text value, over-length label, missing column), or soften the Risks line.
- **Reader losslessness.** The tolerant reader drops invalid rules, and the editor writes the list wholesale. So any
  rule the server accepts but the TS reader rejects is silently deleted on the next unrelated rule edit. The seam
  fixture's `valid` cases should include the JSON-null optional-key variants (`label: null`, `target: null`,
  `value2: null` on a non-between rule) and assert the reader keeps those rules.
- **Editor cap.** The editor should disable "Add rule" at the 20-rule cap, so the "cannot save what the server
  rejects" requirement holds by construction.
- **Spec ambiguity (minor).** For `eq`/`neq`, say whether a STRING rule value that parses as a number (e.g. `"5"`)
  counts as "numeric". The spec defines numeric only for the raw value. Also note that a whitespace-only text `value`
  passes validation (1-200 chars) but can never match, because the trimmed raw value is compared and empty matches
  nothing. Consider requiring 1-200 characters after trimming.
- **Glyph sizing.** `ICON_SIZE` is a fixed px constant, while the metric value is `--text-3xl` and drops to `--text-xl`
  in compact cards. Judge the glyph's optical size against both in C4.
- **Panel backgrounds (pre-existing).** Tone text on a custom tinted panel background is not covered by
  contrast-audit, and the delta trend colours already share this gap. Not introduced here.
