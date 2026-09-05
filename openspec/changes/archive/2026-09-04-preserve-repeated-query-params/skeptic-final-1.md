## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established.** `git log main..HEAD` = the three stated commits; `git diff
main...HEAD --stat` = 27 files, 9 backend/frontend/schema source files, no `db/migration/*` path
(no Flyway migration), nothing matching `LocalFileSystem`/URL-source fetching/CSV/schema
inference (HEL-881 / HEL-893 untouched). Working tree clean.

**Failability — I did not trust the recorded red evidence.** I created a detached scratch
worktree at `6ebc360f`, applied five surgical mutations, and re-ran the specs. Every new guard
went red; the review worktree itself was never modified (verified clean afterwards, scratch
worktree removed).

- Mutation A — revert `buildResolvedRequest` to the old `uri.query().toMap` fold →
  `RestApiConnectorDriverQueryParamsSpec` "issues both values" (`tag=b`), "preserves the exact
  order" (`z=3&a=2`) and "endpoint-carried query" all FAILED. The endpoint-carried case
  reproduced **exactly** the ordering recorded in the commit body:
  `c3=30&e1=1&c2=20&c1=10&e3=3&e2=2` — the 6-key fixture really does force Scala's hash-ordered
  `Map` and is genuinely failable (cycle-1 CR1 properly closed, not papered over).
- Mutation B — naive append in `injectAuthQueryParam` (drop the same-name filter) → the auth
  precedence test FAILED with `api_key=attacker-supplied&other=1&api_key=real-secret`. The
  credential-shadowing risk the fix guards against is real and pinned.
- Mutation C — collapse duplicates inside `resolveQueryParams` → repeated-key tests FAILED.
- Mutation D — legacy `JsObject` read silently → `QueryParams.empty` → both legacy-decode tests
  and the real legacy-blob fetch test FAILED (`""` vs `a=1&b=2`). Malformed values genuinely
  cannot decay to an empty query.
- Mutation E — `SourceService` bare-url path discarding `splitUrl`'s pairs →
  `SourceServiceBareUrlQueryParamsSpec` FAILED.
- Frontend: mutating `toOrderedPairs` back to last-write-wins → the new
  `useRestSourceForm` duplicate-key test FAILED.

Unmutated, all six affected backend specs pass (64/64) and `useRestSourceForm` passes 8/8.

**Proof is of the outgoing request, not a status code.** Both new backend specs bind a real local
HTTP server and assert on `req.uri.rawQueryString` — the exact bytes received. This meets the
bar the orchestrator set.

**Defect-class closure.** `grep` for `query().toMap` across `backend/src/main` returns only
comments — no live collapse point remains. All four planned collapse points are closed
(`splitUrl`, `RestApiConfig.queryParams`, `buildResolvedRequest`, `SourceService.createRest`).
I independently confirmed the two exclusions are correct: `buildEphemeralRequest` builds
`Uri(config.url)` directly (line 424) and never collapses; headers are a distinct surface the
ticket explicitly scoped out. Nothing missed.

**Gates re-run by me** (not read from the evaluation): `npm run lint` → 0, `npm run format:check`
→ 0, `npm run typecheck` → 0, `node scripts/check-schema-drift.mjs` → 0,
`node scripts/check-scala-quality.mjs` → clean. All pre-commit gates pass in the tree as
committed, so no `git commit -n` bypass is in evidence. `sbt testOnly` compiles the whole test
module, so the `Map` → `QueryParams` retype is confirmed to break nothing else in the suite.

**Cross-run fence.** `PipelineProposalProtocol.scala` carries only the `queryParams` field retype
plus a normal top-of-file import. HEL-914 (`39a4af90`) and HEL-868 (`9c1f29bf`) are both in
`main` below this branch, so the fence was legitimately withdrawn — verified in the log, not
taken from the report.

**UI.** I agree browser review is not required: the frontend delta is two pure functions plus a
type, with no rendered surface and no read path consuming `queryParams` from a response (grepped
`frontend/src` — the only consumers are the form composer and the service type). No screenshots
taken.

### Verdict: REFUTE

Two specific, cheap defects — both in the durable artifacts / AC coverage, neither in the
runtime behaviour, which I believe is correct.

### Change Requests

1. **The spec delta states the opposite of the shipped (and pinned) behaviour.**
   `openspec/changes/preserve-repeated-query-params/specs/rest-api-connector/spec.md:9` says the
   legacy JSON-object encoding is "decoded in **document order**". The implementation decodes it
   in **key-sorted** order (spray-json parses object fields into a `TreeMap`), which
   `design.md:44-50`, the `QueryParams` scaladoc, and the deliberately non-coincidental test
   `DataSourceProtocolSpec.scala` ("z"/"a" fixture) all correctly assert. Cycle 2 corrected this
   wording in design.md and the code comments but missed the spec delta — which is the artifact
   that gets archived into `openspec/specs/` as the normative contract. Fix line 9 to say
   key-sorted order (with the "no document-order information survives parsing" rationale), so the
   archived SHALL is not false.

2. **AC 3's repeated-key clause, and the spec scenario written for it, have no test.**
   The ticket AC reads "`{{name}}` templating still resolves correctly … **including a templated
   value in a repeated key**", and spec.md:35-37 has the matching scenario
   (`[(tag, {{first}}), (tag, {{second}})]`). No test in the branch exercises a templated value in
   a *repeated* key — `RestApiConnectorDriverTemplatingSpec` only ever uses a single `tag`
   pair, and `RestApiConnectorDriverQueryParamsSpec` uses no templates at all. The code is
   correct by construction (`resolveQueryParams` folds per pair), but the AC is asserted, not
   demonstrated. Add one case to `RestApiConnectorDriverQueryParamsSpec` (real server, assert on
   `rawQueryString`): `queryParams = QueryParams(Vector("tag" -> "{{first}}", "tag" -> "{{second}}"))`
   with `parameters = Map("first" -> "a", "second" -> "b")` → `tag=a&tag=b`. Confirm it is failable
   (it goes red under a collapse-in-`resolveQueryParams` mutation, as mutation C above showed for
   the untemplated case).

### Non-blocking notes

- `helio-mcp` still types `queryParams` as `Record<string, string>`
  (`src/types.ts:323`, `src/helioApi.ts:438`, `src/tools/restDataSourceSchema.ts:50`), so MCP-
  authored REST sources still cannot express a repeated key and get key-sorted order via the
  legacy dual-read branch. Not a regression and outside this ticket's stated scope, but the
  defect class is only closed for the UI/API path — worth a spinoff.
- The task 4b.3 spinoff for `request.config.parameters` being dropped on `SourceService`'s
  bare-url create path is still owed before archive (pre-existing, correctly not fixed here).
