## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

Issues:
- **Spec requirement not met**: The spec.md explicitly requires `GET /api/pipelines/:id/steps` to return `404 Not Found` for unknown pipeline (line 31-33). Implementation returns `200 OK` with empty array instead.
- **Spec requirement not met**: The spec.md explicitly requires `POST /api/pipelines/:id/steps` to return `404 Not Found` for unknown pipeline (line 48-50). Implementation returns `500 InternalServerError` from database FK constraint failure.
- **Spec requirement not met**: The spec.md explicitly requires `POST /api/pipelines/:id/steps` to return `400 Bad Request` for invalid `op` value (line 52-54). Implementation returns `500 InternalServerError` from database CHECK constraint failure.
- **Test coverage incomplete**: PipelineStepRoutesSpec tests cover happy paths and 404 for unknown step ID, but do not test the three error scenarios above (unknown pipeline in GET/POST, invalid op in POST).

All four acceptance criteria from the ticket are met (schema, CRUD endpoints exist), but the spec.md requirements created during design are not fully implemented. The executor created detailed error-handling requirements in the spec but did not code them.

### Phase 2: Code Review — FAIL

Issues:
- **Error handling insufficient**: In PipelineStepRoutes, all database failures are caught as `Failure(ex)` and returned as `500 InternalServerError`. Database errors that indicate validation failures (CHECK constraint on `op`) or missing resources (FK constraint on `pipeline_id`) should be distinguished and returned as `400 Bad Request` or `404 Not Found` respectively.
  - Line 33 in PipelineStepRoutes.scala (POST endpoint failure case)
  - Line 51 in PipelineStepRoutes.scala (PATCH endpoint failure case)
  - No analogous error handling exists for GET endpoint
- **No input validation**: The GET and POST endpoints do not validate that the pipeline exists before querying/inserting. This allows database errors to bubble up instead of returning appropriate HTTP status codes.
- **Minor formatting issue**: JsonProtocols.scala ends with two blank lines before the final closing brace (line 710-711). Should be one blank line only.

Code is otherwise well-structured, DRY, and modular. Repository methods follow established patterns, partial updates are handled correctly with Option types, and the position auto-increment logic is sound.

### Phase 3: UI Review — N/A

Reason: Frontend integration explicitly deferred to HEL-180 per design.md non-goals. Only backend/schema/migration code was touched; no frontend files modified. E2E wiring cannot be tested until HEL-180 is completed.

### Overall: FAIL

The implementation provides working CRUD APIs and correct database schema, but does not meet the error-handling requirements specified in the spec.md that was created during the design phase.

### Change Requests

1. **Add pipeline existence validation to GET /api/pipelines/:id/steps**
   - Before returning results, query the `pipelines` table to verify the pipeline exists
   - Return `404 Not Found` with error message if not found
   - Location: `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala:19-25`

2. **Add pipeline existence and op validation to POST /api/pipelines/:id/steps**
   - Validate pipeline exists in `pipelines` table before attempting insert
   - Validate `op` is in the allowed set ('rename', 'filter', 'join', 'compute', 'groupby', 'cast') before database insert
   - Return `404 Not Found` if pipeline doesn't exist
   - Return `400 Bad Request` if op is invalid
   - Location: `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala:27-35`

3. **Distinguish database errors in error handlers**
   - Create a helper function to classify database exceptions (e.g., PSQLException for constraint violations)
   - Catch FK constraint violations → `404 Not Found`
   - Catch CHECK constraint violations → `400 Bad Request`
   - All other exceptions → `500 InternalServerError`
   - Apply to POST and PATCH failure cases
   - Location: `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala`

4. **Add test cases for error scenarios**
   - Test GET with unknown pipeline ID → expect 404
   - Test POST with unknown pipeline ID → expect 404
   - Test POST with invalid op value → expect 400
   - Location: `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala`

5. **Fix formatting in JsonProtocols.scala**
   - Remove one blank line before the final closing brace (line 710)
   - Location: `backend/src/main/scala/com/helio/api/JsonProtocols.scala:710-711`

### Non-blocking Suggestions

- Consider adding request validation for `config` field (e.g., reject null/empty config). Currently any string is accepted, but the design mentions config is a JSON blob. A simple non-empty check would prevent empty configs from being stored.
- Consider documenting the decision that position gaps on delete are acceptable (already noted in design.md, good context for future maintainers).
