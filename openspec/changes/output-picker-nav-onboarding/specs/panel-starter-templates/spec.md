## REMOVED Requirements

### Requirement: Each panel type has 2–3 hardcoded starter templates
**Reason**: `panelTemplates.ts` and the `TemplateSelectStep` it fed are deleted with the retired `PanelCreationModal` wizard (HEL-903 decision 8/11) — there is no template-select step in the Output picker.
**Migration**: An Output's visualization is authored once on the pipeline page (`OutputEditorSheet`) and placed, unconfigured, via `output-picker` — there is no per-placement template concept to replace this with.

### Requirement: Template cards present name, description, and a blank option
**Reason**: Same as above — no template-select step exists.
**Migration**: N/A.

### Requirement: Selecting a template pre-fills the panel title
**Reason**: Same as above — an Output's own `name` (set on the pipeline page) is what the picker and Panel sheet display; there is no separate template-driven title pre-fill step.
**Migration**: See `output-picker` and `panel-detail-modal`'s title-override behavior.
