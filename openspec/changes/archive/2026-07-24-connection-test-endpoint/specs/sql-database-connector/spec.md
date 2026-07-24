## MODIFIED Requirements

### Requirement: Frontend SQL Database tab
`AddSourceModal` SHALL include a **SQL Database** tab with fields: dialect selector
(`PostgreSQL` / `MySQL`), host (text), port (number, defaults 5432/3306 by dialect), database
(text), username (text), password (masked `<input type="password">`), and query (`<textarea>`).
An **"Infer schema"** button SHALL call `POST /api/sources/infer` with `source_type: "sql"` and
display the inferred schema preview; "Create source" SHALL remain disabled until this call
succeeds. Connection errors from this call SHALL surface as inline error messages. A separate
**"Test connection"** button SHALL call `POST /api/sources/test` with `source_type: "sql"` and
display a pending/success/error result — this is a lightweight pre-flight check independent of
schema inference; it SHALL NOT populate the schema preview and SHALL NOT affect "Create source"'s
disabled state. On save, the modal SHALL call `POST /api/sources` with `source_type: "sql"`.

#### Scenario: Infer schema shows schema preview
- **WHEN** the user fills in all SQL fields and clicks "Infer schema"
- **THEN** the inferred fields are displayed in the modal before the user saves

#### Scenario: Infer schema error shown inline
- **WHEN** "Infer schema" is clicked but the backend returns a 502
- **THEN** an inline error message is displayed in the modal; no toast or navigation occurs

#### Scenario: Test connection succeeds independently of schema inference
- **WHEN** the user fills in all SQL fields and clicks "Test connection"
- **THEN** a success indicator is displayed and the schema preview / "Create source" disabled state
  are unaffected

#### Scenario: Test connection error shown inline
- **WHEN** "Test connection" is clicked and the backend returns `{ "ok": false, "error": "..." }`
- **THEN** the curated error message is displayed inline via `InlineError`; no toast or navigation
  occurs, and the schema preview / "Create source" disabled state are unaffected

#### Scenario: Port defaults by dialect
- **WHEN** the user selects PostgreSQL dialect
- **THEN** the port field defaults to 5432
- **WHEN** the user selects MySQL dialect
- **THEN** the port field defaults to 3306

#### Scenario: Password field is masked
- **WHEN** the SQL tab is displayed
- **THEN** the password input is rendered as `type="password"` so the value is not visible
