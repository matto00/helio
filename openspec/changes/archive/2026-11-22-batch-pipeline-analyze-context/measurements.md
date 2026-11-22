# HEL-1625 measurements

All numbers are from this lane (`helio_hel1625`, local Postgres, backend started with an empty `ANTHROPIC_API_KEY`
and the rate limits raised for the SEEDING only: `RATE_LIMIT_REQUESTS_PER_WINDOW`, `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW`,
`PIPELINE_RUN_MAX_CONCURRENT`). Servers were stopped with `stop-servers.sh`.

## Requests per `get_workspace_context` call (`helio-mcp/scripts/measureContextRequests.ts`, fixture through the real HTTP client)

| case | requests |
| --- | --- |
| 55 pipelines, both batched reads served (A = 1) | **31** = 8 + 2 + 19 + 1 + 1 |
| 55 pipelines, analyze batch 404 (HEL-1619 shape + 1) | 85 |
| 55 pipelines, details 404, analyze batch served | 141 |
| 55 pipelines, analyze batch missing a second pipeline | 32 |
| **200 pipelines**, same placements, both served | **31** (constant in P) |
| 200 pipelines, analyze batch 404 (the pre-change shape) | 230 (> 120) |
| 200 pipelines, natural placements (67 placed Outputs), both served | < 120 (asserted in `contextRequestBudget.test.ts`) |

## Live probe (`helio-mcp/scripts/contextDetailsLiveProbe.ts`, real backend, real PAT, payload equality asserted)

| pipelines | requests for 2 builds | per-pipeline analyze requests | stderr warnings | payload == forced-fallback | batch body bytes | batch wall (median of 3) | one pipeline's `/analyze` body |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 12 | 20 (10 per build) | 0 | 0 | true | 8,045 | 49 ms | 1,183 bytes |
| 200 | 22 (11 per build; the 2 outputs pages are 400 Outputs) | 0 | 0 | true | 133,911 | 45 ms | 1,183 bytes |

Pre-change a 200-pipeline build sent 8 + 1 + 200 + Op + D requests (over the 120 limit, ~230 on the fixture).

## Database statements for ONE `GET /api/pipelines/context-analyze` (`PipelineContextAnalyzeQueryCountSpec`, JDBC `execute*` counted on both pools)

| pipelines | app pool | privileged pool | total |
| --- | --- | --- | --- |
| 10 | 5 | 4 | 9 |
| 200 | 5 | 4 | 9 |

(`listSummaries` 2 incl. user-context set-up, steps, step root ids, roots, caller-owned sources, secondary sources;
the count depends on which of those id sets are non-empty, not on P. The 10 and 200 fixtures are same-shaped and
both contain a secondary source and an upsert target.)

## Red / mutation evidence (committed before the implementation, C12)

- `red-backend-routes.txt`: guard 4.3b passes on the pre-change code; the routes spec is red (route absent).
- `red-guard-mutation.txt`: upsert target resolved as the calling grantee -> the 4.3b guard fails
  (`Data source not found` for the editor).
- `red-parity-mutation.txt`: roots resolved through the privileged read instead of the caller-owned one -> the parity
  test fails on the `foreign-root` pipeline.
- `red-backend-count.txt`: the count spec does not compile before `findByIdsOwned`/`findByIdsInternal` exist.
- `red-mcp.txt`: MCP request-budget, seam and fallback tests red before the client change (goldens already equal in
  every mode: the golden tests were never red, by design). The MCP test files could not be committed red because the
  pre-commit hook runs jest; they are committed with the implementation.

## Deviations from the design

- D8: the schema reuses the analyze schema's `SchemaField` by `$ref` but defines its own `Step` and `Warning` (a
  warning `code` is an opaque string, `validationError` tolerates `null`). The committed goldens fix the MCP fake's
  values (`code: "w"`, `validationError: null`), which the closed analyze definitions reject, and goldens are not
  regenerated (C15). The backend spec still asserts the real body against this schema.
- D5/D6 detail: a malformed (non-UUID) source id fails only that pipeline (omitted, per-pipeline fallback), mirroring
  the single route's error, instead of failing the whole batch statement.
- D6 scope: per-pipeline omission covers projection/resolver failures only. A stored step row that cannot be decoded
  fails the whole read (non-2xx), the same as `/api/pipelines/context-details`, because both decode every row in the
  shared batch step read; isolating it in this read alone would not restore the request budget. The MCP falls back
  to per-pipeline analyze with one stderr line and an identical payload (cost 8 + 2 + P + Op + D in that case).
  Pinned by `PipelineContextAnalyzeUndecodableRowSpec`.
- Fixture: the fake analyze `outputSchema` types changed from `number` to `float` (a valid `SchemaField` type). The MCP
  projects names only, so the goldens are unaffected; this is not a test edited to pass.
