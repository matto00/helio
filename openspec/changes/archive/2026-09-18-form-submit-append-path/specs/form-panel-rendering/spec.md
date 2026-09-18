## REMOVED Requirements

### Requirement: No submit affordance is rendered yet
**Reason**: Superseded by the `form-panel-submit` capability, which defines the submit button, submit-time
validation, and what Enter does inside a text field.
**Migration**: A form panel now renders a submit button labelled `submit.label` or "Submit"; Enter inside a
single-line text field submits the form (multi-line controls keep inserting a line break). Tests that asserted
"Enter is inert" move to `form-panel-submit`'s "Enter in a single-line field submits" scenario.
