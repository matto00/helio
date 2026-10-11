## Why

Dashboards such as helio-news' CI Health need failing, slow or low values to read red/amber/green at a glance.
Today metric, collection and table Outputs carry only number formatting, so authors compute emoji status
columns upstream. HEL-1307 adds rule-based threshold colouring configured on the Output itself.

## What Changes

- New Output config key `conditionalFormats` on `metric`, `collection` and `table` Outputs: an ordered list of
  rules `{op, value, value2?, tone, label?, column?, target?}`; first match wins (owner ruling 1).
- Operators `gt`/`gte`/`lt`/`lte`/`between` (numeric) and `eq`/`neq` (numeric or text). Tones
  `success`/`warning`/`error` map to the existing `--app-*` intent tokens and their `-surface` washes.
- Metric values and collection item values render in the tone text colour; table cells get tone text on the tone
  wash; table `target: "row"` rules wash the whole row (owner rulings 2, 5).
- Every coloured value also carries a shape-distinct tone glyph and an accessible name (the rule's optional
  `label`, else the tone's word); the label is also the tooltip (owner ruling 4).
- Write-time validation rejects malformed rules with `400` on every Output config write path; no rules means
  rendering is byte-for-byte unchanged.
- Output editor gains a "Conditional formatting" section for the three kinds.
- Schemas, helio-mcp `add_output`/`update_output` docs and the assistant key doc list the new key.

## Capabilities

### New Capabilities
- `output-conditional-formatting`: the `conditionalFormats` rule model, evaluation semantics, validation,
  rendering per kind, accessibility signal, and the editor.

### Modified Capabilities
- `output-routes-api`: the per-kind known-key set for metric, table and collection gains `conditionalFormats`.
- `mcp-output-tools`: the documented per-kind key list gains `conditionalFormats` and its shape.

## Non-goals

- Changing the metric delta/comparison colouring (independent, owner ruling 6); HEL-1329 stays separate.
- Arbitrary colours, gradients/colour scales, or tones beyond success/warning/error.
- Rules on chart, timeline or markdown Outputs.
- Validating that a rule's `column` exists in the Output's schema at write time (it simply never applies).
- A duration format (HEL-1308, next in queue); rules compare raw values so it composes cleanly.

## Impact

- Backend: `OutputConfigValidation` (known keys + new `ConditionalFormats` shape validator wired into
  `validateConfig` and `PipelineCreatePreflight.validateOutputConfig`).
- Schemas: the three Output-config request schemas. helio-mcp: `tools/outputs.ts`.
- Frontend: `outputConfigTypes.ts`, editor builders/fields, `OutputPanelContent`, `MetricOutputPanel`,
  `MetricRenderer`, `CollectionRenderer`, `TableRenderer`, new pure `conditionalFormatting.ts`.
- No migration, no new endpoint; the public dashboard path already returns the raw Output config.
