## ADDED Requirements

### Requirement: Labels beside a shared Select are associated with it
A visible `<label>` that names a shared `Select` SHALL be programmatically associated with that Select's combobox
trigger via `htmlFor`/`id`, using an id generated per component instance (`useId()`), on these surfaces: the add-root
source picker, the divider orientation picker, the form panel dataset picker, the image fit picker, the create-pipeline
source picker, the pipeline schedule kind picker, and the REST source method picker. No literal `htmlFor` value in the
frontend SHALL lack a matching element id.

#### Scenario: Label element resolves to its combobox
- **WHEN** any of the seven surfaces is rendered
- **THEN** `document.getElementById(label.htmlFor)` for its label is the corresponding combobox
- **AND** querying by the label text returns that combobox

#### Scenario: Two instances do not share an id
- **WHEN** two instances of one of these components are rendered at once
- **THEN** their combobox ids differ
