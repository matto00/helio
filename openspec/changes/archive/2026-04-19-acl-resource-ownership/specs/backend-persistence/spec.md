## MODIFIED Requirements

### Requirement: Demo data seeds on empty database only
The backend SHALL seed demo dashboards and panels when the database is empty on startup. All seeded resources SHALL have `owner_id` set to the system user (`00000000-0000-0000-0000-000000000001`).

#### Scenario: Empty database receives seed data
- **WHEN** the backend starts and the dashboards table is empty
- **THEN** demo dashboards and panels are inserted
- **AND** all inserted rows have `owner_id = '00000000-0000-0000-0000-000000000001'`

#### Scenario: Non-empty database is not reseeded
- **WHEN** the backend starts and the dashboards table has at least one row
- **THEN** no demo data is inserted
