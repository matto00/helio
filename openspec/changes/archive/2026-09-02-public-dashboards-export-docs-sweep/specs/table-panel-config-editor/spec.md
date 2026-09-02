## REMOVED Requirements

### Requirement: Table panel edit pane exposes display controls
**Reason**: The Table panel's own edit-pane display controls (density/column-order/reset-widths)
were tied to `TablePanelConfig`, itself removed by HEL-904 in favor of `OutputPanelConfig
(outputId)` — a placed panel no longer carries a bound-DataType config to edit these controls
against. Display-control editing now lives on the Output editor sheet
(`frontend/src/features/pipelines/ui/outputEditor/`), not the panel detail modal.
**Migration**: Use the pipeline Output editor sheet's display controls for a `table`-kind Output.
