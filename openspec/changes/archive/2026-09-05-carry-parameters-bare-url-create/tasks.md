## 1. Prove the drop (red first)

- [x] 1.1 Read `backend/src/test/scala/com/helio/services/sources/SourceServiceBareUrlQueryParamsSpec.scala` in
      full — it is the harness template (EmbeddedPostgres + Flyway, bound Pekko HTTP test server capturing the
      received request, `SourceService.createRest`, then `RestApiConnectorDriver` fetch with no `fetchOverride`).
- [x] 1.2 Add `backend/src/test/scala/com/helio/services/sources/SourceServiceBareUrlParametersSpec.scala`:
      create a REST source through the bare-`url` path with a `parameters` map and `{{name}}` placeholders in a
      query-param value and a header value; then fetch the persisted source and assert on the query string and
      headers the bound server actually received (design.md D5). Add a secondary assertion that the persisted
      config's `parameters` map equals what was supplied.
- [x] 1.3 Run ONLY this spec against unfixed `SourceService`. Capture the failure output verbatim into the
      executor report. The failure must be the templating signature (unresolved-variable error naming the
      variable, or literal `{{...}}` reaching the server) — a compile error or fixture mismatch does not count as
      the red, and means 1.2 must be rewritten (design.md D4).

## 2. Fix

- [x] 2.1 In `backend/src/main/scala/com/helio/services/sources/SourceService.scala`, add
      `parameters = request.config.parameters.getOrElse(Map.empty)` to the bare-`url` branch's `RestApiConfig`
      construction, with a brief comment naming HEL-983 and what was dropped (design.md D1).
- [x] 2.2 Confirm no other hand-rolled `RestApiConfig(...)` construction on a persisting create path omits
      `parameters` — check `RestSourceConnectorMigration.scala`'s construction and state the finding explicitly.
      Fix it only if it is on a path that persists a caller-supplied `parameters` map; otherwise record why not.

## 3. Prove the guard is failable

- [x] 3.1 Re-run the new spec: green.
- [x] 3.2 Mutation-check: revert ONLY the 2.1 line, re-run, confirm red with the same signature as 1.3, then
      restore the fix and re-run green. Record all three outcomes in the executor report (design.md D4).

## 4. Gates and commit

- [x] 4.1 `sbt test` for the backend suite; confirm no regression in `SourceServiceBareUrlQueryParamsSpec`,
      `SourceServiceSpec`, `RestApiConnectorDriverTemplatingSpec`, or `DataSourceRoutesSpec`.
- [x] 4.2 Scala code-quality/pre-commit gates pass. No Flyway migration is added (design.md D3) — if one appears
      necessary, stop and escalate rather than writing it.
- [x] 4.3 Write `files-modified.md` and commit.
