## Context

`ApiRoutesSpec` already covers malformed panel requests using `Route.seal` (line 301–310). The dashboard create route has happy-path and default-value cases but no equivalent negative-path coverage. This change mirrors the panel pattern for dashboards.

## Goals / Non-Goals

**Goals:**
- Add negative-path test cases for `POST /api/dashboards` with malformed JSON
- Keep tests consistent with the existing `Route.seal` pattern in the spec

**Non-Goals:**
- Changes to production code
- Coverage of authentication, authorization, or persistence edge cases
- Exhaustive fuzzing — focus on type-mismatch and structurally invalid JSON

## Decisions

**Use `Route.seal` for malformed JSON tests** — same as the existing panel test. `Route.seal` ensures Akka's default rejection handlers are applied so that JSON parse errors produce 400 responses rather than unhandled rejections. No alternative is needed; the pattern is already established in the spec.

**Test cases to add:**
1. `{"name": 42}` — type mismatch on the `name` field → `400 Bad Request`
2. `{invalid}` — structurally invalid JSON → `400 Bad Request`

These cover the two distinct failure modes: valid JSON that fails schema deserialization, and unparseable JSON that fails at the HTTP layer.

## Risks / Trade-offs

- None significant. Tests-only change; no production risk.
