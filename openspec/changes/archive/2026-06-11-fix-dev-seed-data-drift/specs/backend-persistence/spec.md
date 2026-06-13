## ADDED Requirements

### Requirement: Demo seed data ownership constraint is documented in backend/README.md
`DemoData` seeding assigns dashboards and panels to the system user (`SystemUserId`). This is the established behavior. Any future addition of DataTypes, DataSources, or Pipelines to `DemoData` must use a real user UUID (not `SystemUserId`) so those rows are accessible via user-scoped ACL queries. This constraint SHALL be recorded as a note in `backend/README.md` so contributors are aware before adding new rows.

#### Scenario: Developer reads ownership constraint in backend/README.md
- **WHEN** a developer reads `backend/README.md`
- **THEN** they find a note that any future DataType/DataSource addition to `DemoData` must use a real user UUID (not `SystemUserId`)
