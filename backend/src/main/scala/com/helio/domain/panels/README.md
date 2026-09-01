# Domain: Panels

Per-panel-type config models: `DividerPanel`, `ImagePanel`, `MarkdownPanel`,
`OutputPanel` (HEL-904: the single data-bound panel type, replacing the
former `ChartPanel`/`CollectionPanel`/`MetricPanel`/`TablePanel`/
`TimelinePanel` family -- an Output's own `kind` now carries that
distinction), `TextPanel`, plus `OutputBindingSpec` (data-binding shape,
replacing `PanelBindingSpec`) and `PanelConfigCodec` (JSON codec dispatch).

**Belongs here:** the sealed panel-type hierarchy and its per-type config
fields/codecs.
**Does not belong here:** panel HTTP routes/persistence, which live in
`api.routes`/the panel repository layer.
