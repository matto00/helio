## MODIFIED Requirements

### Requirement: StepCard renders the real schema diff as chips on every op kind
The StepCard component SHALL render the computed schema diff as chips in the expanded card body
for every step op kind (not only the no-editor fallback branch), replacing the previous hardcoded
placeholder chips (`+ col_a`, `− col_b`, `~ col_c`), which SHALL be removed. The chips SHALL:
- Use the existing step-card diff chip styling, with distinct presentations for added (`+ name`),
  dropped (`− name`), retyped (`~ name: fromType→toType`), and renamed (`oldName → newName`)
- Render nothing (no empty container) when the diff is empty or analyze data for the step is
  unavailable

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the schema-diff chips render in the preview table's header for the selected step (every op kind), with added fields in success intent, dropped in error, renamed in warning and retyped neutral, never the accent.

#### Scenario: Real diff chips replace the placeholder
- **WHEN** a step's analyze data is available and its output schema differs from its input schema
- **THEN** the expanded StepCard shows chips reflecting the actual added/dropped/retyped/renamed
  columns, and the hardcoded `col_a`/`col_b`/`col_c` placeholder chips do not appear anywhere

#### Scenario: Diff chips appear for ops with dedicated editors
- **WHEN** a step whose op kind has a dedicated config editor (e.g. `select`) drops a column
- **THEN** the expanded StepCard shows the corresponding dropped chip alongside the editor

#### Scenario: No chips when there is nothing to show
- **WHEN** a step's diff is empty, or analyze data for the step is unavailable (pending, failed,
  or unknown step id)
- **THEN** the expanded StepCard renders no diff chips and no empty diff container

#### Scenario: Desktop diff chips in the preview header
- **WHEN** the selected step adds one column on desktop
- **THEN** the preview table header shows a "+ <name>" chip in success intent
