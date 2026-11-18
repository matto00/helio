## ADDED Requirements

### Requirement: Ask error bodies have committed schemas
The `422` ASK_UNGROUNDED body of the ask routes SHALL be described by `schemas/ask/ask-ungrounded-response.schema.json`
(`{message, code: "ASK_UNGROUNDED", reasons: string[]}`). The `422`
ASK_ANSWER_TRUNCATED body SHALL be described by `schemas/ask/ask-truncated-response.schema.json` (`{message, code}`).
The `403` TIER_FORBIDDEN and `429` CHAT_LIMIT_REACHED bodies
SHALL be described by `schemas/ask/ask-tier-error-response.schema.json`. A backend seam spec SHALL assert that what the
real routes write for a 200 with pin, a 200 without pin, each 422 and a 403 equals the committed fixtures under
`shared-test-fixtures/ask/`, and that each validates against its schema. The client SHALL validate the same files.

#### Scenario: Server drift fails the seam
- **WHEN** the real route's 200 body gains, loses or renames a field
- **THEN** the seam spec fails, naming the fixture that no longer equals the route's output
