## ADDED Requirements

### Requirement: Backend DELETE /api/data-sources/:id returns a structured 409 when the delete would orphan a pipeline

`DELETE /api/data-sources/:id` SHALL NOT return 500 when the source is still referenced such that
deleting it would leave a pipeline with zero roots. It SHALL instead return **409 Conflict** with a
structured body carrying `resourceKind`, `resourceId`, `resourceName`, and `reason` — the same four
fields as the tag-scoped teardown conflict shape — where `resourceKind` is `"data_source"`,
`resourceId`/`resourceName` identify the source, and `reason` names the blocking pipeline(s). The
body SHALL additionally carry a `message` field holding the same human-readable text as `reason`,
so that generic clients reading `data.message` render something useful; the four teardown-compatible
fields remain present and unchanged for clients that read them.

The conflict SHALL be scoped to the **sole-root** case only: a source that is one of several roots
of a pipeline SHALL continue to delete successfully with 204. A source that no pipeline reads from
SHALL continue to delete successfully with 204.

The response body SHALL NOT leak the underlying database error — no SQLSTATE, no driver exception
text, and no raw trigger message. The underlying cause SHALL be recorded in the backend logs.

#### Scenario: Deleting a pipeline's sole root returns 409

- **WHEN** `DELETE /api/data-sources/:id` is called for a source that is the only root of at least one pipeline
- **THEN** the response is 409 with a body whose `resourceKind` is `"data_source"`, whose `resourceId` is the source id, whose `reason` names the blocking pipeline, and whose `message` carries the same text as `reason`

#### Scenario: Deleting one of several roots still succeeds

- **WHEN** `DELETE /api/data-sources/:id` is called for a source that is a root of a pipeline which has at least one other root
- **THEN** the response is 204 and the source is deleted

#### Scenario: Deleting an unreferenced source still succeeds

- **WHEN** `DELETE /api/data-sources/:id` is called for a source that no pipeline reads from
- **THEN** the response is 204 and the source is deleted

#### Scenario: The 409 body does not leak database internals

- **WHEN** a delete is rejected with 409 because it would orphan a pipeline
- **THEN** the response body contains no SQLSTATE, no driver exception text, and no raw trigger message, while the backend log records the underlying cause
