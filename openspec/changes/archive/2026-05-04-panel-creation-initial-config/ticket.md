# HEL-227: Initial panel configuration on creation modal step 2

## Title
Initial panel configuration on creation modal step 2

## Description
After the user selects a panel type in the creation modal, step 2 should offer type-specific initial configuration fields in addition to the panel title. This avoids the user having to open the detail modal immediately after creation just to set basic properties.

**Scope per type:**

* **Metric** — value label, unit
* **Chart** — chart type (line/bar/pie)
* **Text** — (none beyond title; content is set in detail modal)
* **Table** — (none beyond title)
* **Markdown** — (none beyond title; content is set in detail modal)
* **Image** — image URL
* **Divider** — orientation (horizontal/vertical)

Fields should be optional — the user can skip them and configure later via the detail modal. Keep the form compact; defer complex settings (colors, weights, field mappings) to the detail modal.

## Acceptance Criteria
- Step 2 of the panel creation modal shows type-specific fields in addition to the panel title field
- Metric panels show: value label (text input), unit (text input)
- Chart panels show: chart type selector (line/bar/pie)
- Text panels show no additional fields
- Table panels show no additional fields
- Markdown panels show no additional fields
- Image panels show: image URL (text input)
- Divider panels show: orientation selector (horizontal/vertical)
- All type-specific fields are optional — user can skip without filling them
- The form remains compact; complex settings are deferred to the detail modal
- Submitted values are included in the panel creation payload so they take effect immediately

## Linear URL
https://linear.app/helioapp/issue/HEL-227/initial-panel-configuration-on-creation-modal-step-2
