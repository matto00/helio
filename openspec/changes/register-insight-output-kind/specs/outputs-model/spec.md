## MODIFIED Requirements

### Requirement: Output kind is one of the Phase-1 set
The system SHALL restrict `outputs.kind` to `metric | chart | table | collection | timeline | markdown | insight`, at
both the API layer and the database CHECK constraint.

#### Scenario: Unknown kind rejected
- **WHEN** an Output is created or updated with a kind outside this set
- **THEN** the write is rejected

#### Scenario: Insight kind accepted
- **WHEN** an Output is created with kind `insight` and a valid insight config
- **THEN** the write succeeds (201) and the stored row's kind is `insight`
