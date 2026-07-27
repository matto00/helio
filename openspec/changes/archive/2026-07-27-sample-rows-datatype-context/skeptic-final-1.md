## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **SQL-tier bounding, not app-level-only truncation.**
   `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala:63-80` — `listRows`
   builds `SELECT (data - $k1::text - $k2::text ...)::text FROM data_type_rows WHERE data_type_id = $id
   ORDER BY row_index ASC LIMIT $n`, each excluded key and the limit bound via `SQLActionBuilder#concat`
   (no string interpolation into SQL text). This is a real Postgres `jsonb -` key-strip inside the query,
   not a fetch-then-slice. Confirmed with a fresh `sbt -batch "testOnly
   com.helio.infrastructure.DataTypeRowRepositorySpec"` run against embedded Postgres — all 13 tests pass,
   including `"excludeKeys strips the named top-level keys from every row's data, inside the query"` and
   `"limit bounds the result at the SQL tier"`. The 10MB `TEXT_MAX_FILE_SIZE_BYTES` claim
   (`DataSourceRoutes.scala:40`) and the actual write path storing full content values
   (`PipelineRunService.scala:onRunSuccess`, `jsRows` → `dataTypeRowRepo.overwriteRows`) both check out —
   the cost concern D1 addresses is real and the fix is real.

2. **RLS/owner-scoping traced end to end.** `DataTypeService.listRows`
   (`DataTypeService.scala:37-50`) calls `dataTypeRepo.findByIdOwned(id, user)` before ever touching
   `dataTypeRowRepo`, and both new params (`limit`, `excludeKeys`) are forwarded only after that check
   succeeds. `DataTypeRoutes.scala:49-74` — the new `?limit=`/`?excludeContentFields=` query params: the
   `excludeContentFields=true` branch does a second owner-scoped lookup (`dataTypeService.findById`, also
   `findByIdOwned`) to compute `excludeKeys` before calling `listRows` again — no code path skips the
   ownership check. `WorkspaceContextService.toDataTypeEntry` (`WorkspaceContextService.scala:173-197`)
   only calls `dataTypeService.listRows`, never the raw repo. Confirmed with the existing
   `DataTypeRepositorySpec` `findByIdOwned returns None when owner does not match` case (pre-existing,
   unmodified) plus the new `WorkspaceContextServiceSpec` `"never surface another user's sampleRows"`
   cross-tenant test (`WorkspaceContextServiceSpec.scala:399-418`), which asserts user B's response
   contains none of user A's DataType entries and no `sampleRows` cell anywhere equals user A's value. Ran
   fresh: `sbt -batch "testOnly com.helio.services.WorkspaceContextServiceSpec"` — passes (included in the
   full 2241/2241 run below). Also re-ran `ApiTokenAuthSpec` directly (25/25 pass) to confirm the pre-
   existing scoped-PAT-denial-on-`/api/workspace/context` test still passes — no regression from the D7
   constructor swap.

3. **Sensitive-data exposure — both layers are real, not just one.** SQL-tier: `excludeKeys` computed from
   `contentFieldNames` (`WorkspaceContextService.scala:199-200`, `FieldTypeCategory.Content` per
   `DataFieldType.category`, `model.scala:497-501` — `StringBodyType`/`BinaryRefType` map to `Content`).
   App-tier defense-in-depth: `sanitizeSampleRows`'s column projection independently filters to
   `Structured`-category only (`WorkspaceContextService.scala:222-230`), so even if a content key somehow
   survived the SQL strip it would still be dropped here. Both are exercised by distinct tests: the SQL-
   tier by `DataTypeRowRepositorySpec`'s `excludeKeys` cases (real Postgres, no app-level filter involved
   — the test asserts the returned `JsObject` never contains the key) and the app-tier by
   `WorkspaceContextServiceSanitizeSampleRowsSpec`'s `"exclude a Content-category field from the
   projection entirely"` (pure function, no DB). This rules out the "one filter happens to also do the
   other's job" concern — I traced them as two independently-testable code paths.

4. **Truncation-marker parity — read both implementations directly, byte-compared.**
   `WorkspaceContextService.scala:67` — `TruncationMarker: String = "…[truncated]"`;
   `helio-mcp/src/context.ts:50` — `TRUNCATION_MARKER = "…[truncated]"`. Ran a direct Python codepoint
   comparison of both string literals as extracted from the source files: identical, `U+2026 5B 74 72 75
   6E 63 61 74 65 64 5D` on both sides. Both sides also have their own unit test asserting the literal
   marker on an oversized cell (`WorkspaceContextServiceSanitizeSampleRowsSpec.scala:79-101`,
   `context.test.ts` — ran via `npx jest --config jest.config.cjs
   helio-mcp/src/context.test.ts`, 10/10 pass).

5. **Acceptance criteria traced against real code + fresh test runs:**
   - Up to 5 rows for pipeline-output DataTypes, `[]` for no-run/source-companion — `assemble (HEL-372 4.3
     sample rows)` block, 3 cases, all pass.
   - Per-cell/per-DataType caps with an oversized-row test — `sanitizeSampleRows` unit specs on both sides
     cover oversized string AND oversized non-string cells.
   - Backend/MCP shape parity — same route, same query params, `schemas/workspace-context.schema.json`
     documents the shared contract; independently duplicated caps constants verified equal.
   - Owner-scoping — traced above.
   - Schema updated + tests green — `sampleRows` is `required` (not `Option`) in both the case class
     (`jsonFormat9`, matches the 9-field case class) and the JSON Schema; `node
     scripts/check-schema-drift.mjs` → "schemas in sync with JsonProtocols" (fresh run). Full `sbt -batch
     test`: **2241/2241 pass** (fresh run, 89s). MCP jest (root config, the one that actually resolves the
     NodeNext imports — `npx jest` from `helio-mcp/` alone fails with a `SyntaxError` for unrelated
     tooling reasons, must run from repo root against `jest.config.cjs`): **10/10 pass** (fresh run).
   - Backward-compat: additive field, `?limit=`/`?excludeContentFields=` omission preserves prior
     unbounded behavior — verified directly by `DataTypeRoutesSpec`'s `"omitting both limit and
     excludeContentFields preserves the full, unbounded snapshot"` case, fresh run, passes.
   - `node scripts/check-scala-quality.mjs` → "clean (74 soft warning(s))" — same pre-existing pattern of
     soft-budget test-file warnings across the codebase; `WorkspaceContextServiceSpec` at 545 lines is one
     of many, consistent with the already-approved mitigation (harness extraction, not a full split) and
     not a new problem this ticket introduces at outlier scale.
   - `npx eslint helio-mcp/src/context.ts helio-mcp/src/context.test.ts helio-mcp/src/helioApi.ts
     --max-warnings=0` → clean, fresh run.

6. **D7 constructor swap is behavior-preserving.** `git diff main...HEAD` on `ApiRoutes.scala` and
   `ResourceTaggingSpec.scala` shows the only two call sites of `new WorkspaceContextService(...)` both
   updated consistently to pass `dataTypeService` instead of `dataTypeRepo`; `DataTypeService.findAll`
   wraps the identical `dataTypeRepo.findAll` call `assemble` previously used directly. No behavior change,
   confirmed by the full green test suite.

### Verdict: CONFIRM

### Non-blocking notes
- `WorkspaceContextServiceSpec.scala` is now 544 lines (task 4.1's harness extraction reduced it somewhat
  but it's still well past the ~400-line soft guidance the ticket flagged). This was pre-approved in the
  ticket brief as a mitigation, not a full split, and `check-scala-quality.mjs` reports it as one of many
  pre-existing soft warnings, not a new outlier — fine to leave for now, but a natural target if this file
  gets touched again for HEL-373/374.
- The `excludeContentFields=true` route branch performs two sequential owner-scoped lookups
  (`findById` then `listRows`, each independently re-checking `findByIdOwned`) rather than threading fields
  through one call — a minor perf redundancy, already explicitly called out and accepted in design.md as
  the round-2 skeptic's preferred "cleaner" shape. Not a correctness issue.
