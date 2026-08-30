## MODIFIED Requirements

### Requirement: Panels table stores an Output placement
The `panels` table SHALL have a nullable `output_id` (text, FK → `outputs` `ON DELETE CASCADE`)
column, populated only for panels with `kind = output`. The previously-required `type_id`
(FK → `data_types`) and `field_mapping` columns no longer exist.

#### Scenario: Panel without an Output placement has null output_id
- **WHEN** a content panel (text, markdown, image, divider) is created
- **THEN** the `output_id` column is NULL in the database

#### Scenario: Panel placement persists across restarts
- **WHEN** a panel's `output_id` is set via `POST /api/panels`
- **THEN** the value survives a backend restart and is returned in subsequent GET responses
