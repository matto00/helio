## Why

`e2e/hel1579-pipeline-spine-layout.spec.ts:174` (the accent audit) drives one test user past the per-user `/api` rate limit (120 requests per 60 s): it seeds about 20 steps over HTTP, then performs four full page loads (two themes x two accent presets) and clicks every spine row on each, and each selection deliberately fetches a fresh step preview (pipeline-detail-spine-layout D8). The surplus requests are rejected with 429, and the test fails intermittently on main CI (run 39105908594, leg 3), turning main red.

## What Changes

- Measure, per test and per user, the `/api` request count and worst 60 s window of every test in the hel1579 spec, and record which requests dominate (red evidence first).
- If the live measurement shows a genuinely redundant product request on the pipeline page (a duplicate, or a refetch of unchanged data that no spec requires), remove it in product code. The per-selection preview fetch is required by the spec (D8) and is not a defect.
- Otherwise, and in any case where the product cut alone does not give margin, restructure the test so no single user exceeds the budget. The leading option is to split the accent audit's four theme/accent blocks into separate tests, each with its own fresh user and seeded pipeline.
- Add a lightweight per-test request-count guard (a counter of `/api` responses, plus a zero-429 assertion) to the spec so a future regression fails with a clear count instead of a `toBeVisible` timeout.
- No change to the rate limit, its configuration, or the treatment of test users.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None expected. This is a test-structure change; `skip_specs: true`. If the measurement finds a product defect whose fix changes a spec requirement, the executor stops and the plan is revised (spec delta plus a design re-gate) before that fix lands.

## Impact

- `e2e/hel1579-pipeline-spine-layout.spec.ts` (primary), possibly a small shared helper under `e2e/support/` for counting `/api` responses.
- Possibly pipeline-page or app-shell frontend code, only if a redundant request is proven. Any such change must be checked for overlap with the HEL-1630 lane (draft preview, pipeline page) and reported.
- CI wall time: splitting the audit adds three extra seeds of about 2 to 3 s each. Each resulting test is shorter, so shard balance improves.
