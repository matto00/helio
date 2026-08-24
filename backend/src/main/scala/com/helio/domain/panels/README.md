# Domain: Panels

Per-panel-type config models: `ChartPanel`, `CollectionPanel`, `DividerPanel`,
`ImagePanel`, `MarkdownPanel`, `MetricPanel`, `TablePanel`, `TextPanel`,
`TimelinePanel`, plus `PanelBindingSpec` (data-binding shape) and
`PanelConfigCodec` (JSON codec dispatch).

**Belongs here:** the sealed panel-type hierarchy and its per-type config
fields/codecs.
**Does not belong here:** panel HTTP routes/persistence, which live in
`api.routes`/the panel repository layer.
