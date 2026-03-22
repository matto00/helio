## ADDED Requirements

### Requirement: Panels table stores DataType binding
The `panels` table SHALL have two nullable columns: `type_id` (text, FK → data_types ON DELETE SET NULL) and `field_mapping` (text, stores JSON). Both default to NULL for unbound panels.

#### Scenario: Panel without binding has null type_id
- **WHEN** a panel is created without a typeId
- **THEN** the `type_id` and `field_mapping` columns are NULL in the database

#### Scenario: Panel binding persists across restarts
- **WHEN** a panel's typeId and fieldMapping are set via PATCH
- **THEN** the values survive a backend restart and are returned in subsequent GET responses
