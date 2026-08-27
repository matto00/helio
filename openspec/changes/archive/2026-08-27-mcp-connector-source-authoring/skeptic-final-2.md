## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Scope: focused re-verification of commit `55ae2c53` against the two round-1 change requests,
plus a fresh full gate run and a hunt for regressions the fix itself could have introduced.
Round 1 (`skeptic-final-1.md`) did the deep AC/laws verification; that is not repeated here.

### CR1 — `.strict()` on `create_rest_data_source` — VERIFIED CLOSED

Ground truth, not narrative. `helio-mcp/src/tools/restDataSourceSchema.ts:64` now reads
`export const createRestDataSourceSchema = z.object(createRestDataSourceInputSchema).strict();`
and `helio-mcp/src/tools/write.ts:124` registers the built schema object
(`inputSchema: createRestDataSourceSchema`) rather than the raw shape.

I did not trust that this survives the MCP SDK's registration path (the main new risk of the fix
— SDK 1.29.0 historically took a `ZodRawShape`). I built the server (`npm run build`, exit 0) and
live-probed the **real** `node dist/index.js` over stdio with a real `@modelcontextprotocol/sdk`
`Client`:

- `tools/list` for `create_rest_data_source` advertises `"additionalProperties": false` and the
  14 expected keys (`name, connectorId, endpoint, method, queryParams, headers, body,
  bodyContentType, rootSelector, auth, apiKey, token, password, credential`) — i.e. `.strict()`
  is reflected in the JSON Schema an agent host actually sees, not just in local parsing.
- `{name, connectorId, secret:"sk-x"}` → `isError: true`, `unrecognized_keys ["secret"]`.
- `{name, connectorId, bearer:"b"}` → `isError: true`, `unrecognized_keys ["bearer"]`
  (an unlisted name I chose myself, not one from the executor's transcript).
- `{name, url:"https://evil.example.com"}` → `isError: true` (connectorId required + url
  unrecognized). The old "silently accepted and dropped" behavior is gone.
- `{name, connectorId, apiKey:"k"}` → `isError: true` with the **good** message
  ("apiKey is not accepted by create_rest_data_source — credentials live on the refere…"),
  confirming the 5 named refines still fire ahead of the generic strict error, as claimed.

Regression check on the happy path (does `.strict()` / the object registration break a legitimate
call?): `{name, connectorId, endpoint:"/users", method:"GET"}` passes validation and reaches the
HTTP layer — it fails only with `HelioApiError (status 0) … Could not reach the Helio backend`,
i.e. the handler destructuring is intact and the request was actually issued. No other call site
uses this schema (`grep` for `createRestDataSourceInputSchema` / `createRestDataSourceSchema`
returns only `restDataSourceSchema.ts` and `write.ts`), so nothing else could be affected.

Test changes are correct and non-vacuous: the previously-inverted "has no url field" test is now
`rejects a bare url field rather than silently discarding it` (expects `success === false`), and a
new test covers an unlisted key (`secret`) and additionally asserts the secret **value** does not
leak into the Zod issue payload. `RestAuthInput` is deleted from `helio-mcp/src/types.ts` and has
zero remaining references.

Prose corrections are accurate, not overclaims: `design.md` Decision 4, `restDataSourceSchema.ts`'s
header comment, and `specs/mcp-data-source-tools/spec.md` all now describe the denylist-plus-strict
behavior precisely (named 5 for the better message, `.strict()` for everything else) instead of the
old unconditional "no such field exists".

### CR2 — committed PAT redacted — VERIFIED (with one non-blocking caveat)

`git show 55ae2c53 -- …/e2e-evidence.md` replaces the verbatim
`helio_pat_856441f6…` with `helio_pat_<redacted>`. A repo-wide grep for `helio_pat_` across the
worktree returns only format documentation, regexes, and the `helio_pat_` constant/prefix in
backend code — **no live token value anywhere in the tree**. The evidence file's substantive
claims are untouched by the redaction: the setup narrative, the `POST /api/connectors` payload,
the tool transcripts, and the round-1 rejection evidence all read exactly as before, with a new
appended `.strict()` re-verification section whose three transcripted outcomes I independently
reproduced above (I got the same `unrecognized_keys` shape, same connectorId-required behavior,
same happy-path success modulo my probe having no backend running).

### Fresh full gate run (all re-run by me, output read)

- `backend/ sbt -batch test` → `Total number of tests run: 3602 / succeeded 3602, failed 0` ·
  `All tests passed.` · exit 0.
- helio-mcp Jest (root `jest.config.cjs`, worktree ignore-pattern workaround —
  `npx jest --testPathIgnorePatterns '/node_modules/' '/openspec/' '/.cursor/' '/frontend/' '/e2e/'
  '/helio-mcp/dist/' --testPathPatterns 'helio-mcp'`) → **9 suites, 199 tests, all passed**,
  including `restDataSourceSchema.test.ts` and `write.test.ts`.
- `helio-mcp/ npx tsc --noEmit` → clean (exit 0); `npm run build` → exit 0.
- root `npm run typecheck` (frontend `tsc --noEmit`) → clean.
- `npx eslint helio-mcp/src --ext .ts` → no findings; `npx prettier --check 'helio-mcp/src/**/*.ts'`
  → "All matched files use Prettier code style!".

### UI / design judgment — not applicable

`git diff --stat main...HEAD` shows no `frontend/**` source changes (only
`schemas/workspace/workspace-context.schema.json` outside backend/helio-mcp/openspec). No view
changed, so no servers were started and no screenshots were taken.

### Verdict: CONFIRM

Both round-1 change requests are closed against ground truth I re-derived myself, the fix is
enforced end-to-end through the real MCP server (not just in unit tests), the legitimate call path
is provably unaffected, and every gate is green on a fresh run. This ships.

### Non-blocking notes

1. The redacted PAT value still exists in this branch's **history** (commit `7dc3132f`), so it is
   visible in the PR's per-commit diff on GitHub until the branch is squash-merged. The commit
   message states both PATs were revoked and they were local dev-DB credentials, which I cannot
   independently confirm (no backend running); given the blast radius this is a note, not a
   blocker. Prefer squash-merge, and consider confirming revocation before opening the PR.
2. `createRestDataSourceInputSchema` (`restDataSourceSchema.ts:42`) is still `export`ed but now has
   no consumer outside its own module — it could be made module-local. Cosmetic.
