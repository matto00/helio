## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

All tasks are implemented and marked done; the representation change, dual-read, composition
fix, auth precedence, migration, bare-url path, schema widening and frontend boundary all
landed as designed. Hard constraints verified:

- **No Flyway migration.** `git diff --name-only main...HEAD` contains nothing under
  `backend/src/main/resources/db/migration/` (nothing matching `db/migration` at all).
- **No HEL-881 / HEL-893 reach-in.** No `LocalFileSystem`, URL-source-fetching, CSV or
  schema-inference file appears in the diff.
- **`PipelineProposalProtocol.scala`** diff is exactly: one new top-of-file
  `import com.helio.domain.model.QueryParams` and the `queryParams` field type at line 56.
  The `cfg -> DTO` mapping at line 96 needed no change (both sides `Option[QueryParams]`).
  This matches the withdrawn-fence expectation.
- **No `git commit -n` evidence.** All pre-commit gates re-run clean here (see Phase 2),
  including `check-scala-quality.mjs`, `check-schema-drift.mjs`, `check-openspec-hygiene.mjs`.

Issues:

1. **AC 7's endpoint-carried-query case has no failable guard, and the recorded red for it is
   not the shipped fixture.** `RestApiConnectorDriverQueryParamsSpec.scala:167-181` asserts
   `endpoint = "/echo-query?existing=1"` + config `added=2` → `"existing=1&added=2"`. On pre-fix
   `main` this assertion **passes**: the old fold computes `uri.query().toMap + ("added" -> "2")`,
   a 2-entry `Map` (`Map.Map2`), whose iteration order is insertion order → `existing=1&added=2`.
   The commit body's own red evidence for this case used a *different*, 6-key fixture
   (`'c3=30&e1=1&c2=20&c1=10&e3=3&e2=2'`) chosen precisely because it "forc[es] Scala's
   non-small-map hash ordering" — i.e. the executor knew the small fixture was not red, and then
   shipped the small one. The other three reds (repeated key, interleaved order, bare-url path)
   are real and their shipped fixtures do fail pre-fix.
2. **Related factual error carried into shipped comments and artifacts:** ticket "widened repro"
   item 3, proposal, design D4, `RestApiConnectorDriver.scala:137-140` and the test comment at
   `RestApiConnectorDriverQueryParamsSpec.scala:167-168` all state the old fold "discards"/
   "destroy[s]" a query string already carried on the endpoint. It does not — `toMap` preserves
   the endpoint's *distinct* pairs and only (a) reorders them and (b) collapses duplicates
   *within* the endpoint's own query. Leaving that overstatement in shipped code comments is the
   confidently-false-documentation trap this repo has been bitten by before.
3. **Legacy-object decode order is alphabetical, not document order.** design.md D2 and tasks 3.1
   say the legacy `JsObject` branch takes "entries ... in document order". spray-json's parser
   builds objects into a `TreeMap` (`spray/json/JsonParser.scala:100`), so
   `fields.toVector` in `QueryParams.read` (`model.scala:571-575`) yields **key-sorted** order.
   Both legacy tests happen to use fixtures whose document order equals alphabetical order
   (`a,b` and `limit,offset`), so they pass coincidentally and pin nothing. Behaviourally this is
   not a regression (pre-fix order for legacy rows was hash order, i.e. arbitrary), but the
   stated invariant is false and untested.
4. **Stale handoff/comment about the withdrawn fence.** `files-modified.md` states
   PipelineProposalProtocol was changed with "exactly one line: `queryParams` field retyped to
   `Option[com.helio.domain.model.QueryParams]` (inline-qualified to avoid adding an import)" —
   the opposite of what shipped (a normal import, correctly). `model.scala:544-546` likewise still
   claims the companion format is "the mechanism that keeps the `PipelineProposalProtocol.scala`
   edit to exactly its two fenced `queryParams` lines". The commit body has the accurate story;
   these two do not.

### Phase 2: Code Review — PASS

Gates, all re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):

- `npm run lint` → exit 0
- `npm run format:check` → exit 0
- `npm run typecheck` → exit 0
- `npm test` → 254 suites / 2618 tests passed
- `npm --prefix frontend run build` → exit 0
- `cd backend && sbt -batch test` → 250 suites, 3790 tests, 0 failed (5m04s); the five new
  `RestApiConnectorDriverQueryParamsSpec` cases are visible in the run output
- `node scripts/check-scala-quality.mjs` → clean; `check-schema-drift.mjs` → 0;
  `check-openspec-hygiene.mjs` → clean

Code quality: no inline fully-qualified names (CONTRIBUTING "Imports & Qualifiers" respected —
`QueryParams` is imported in all five touched Scala files). No `.toMap` remains on the
query-param path (`RestApiConnectorDriver.scala` mentions it only in comments). `decodeRest`
stays total — the format throws `DeserializationException`, caught and mapped to
`Left("malformed: ...")`, asserted by two explicit tests, never swallowed to empty. Auth
precedence (D4a) is preserved by drop-then-append and covered by a test asserting
`"other=1&api_key=real-secret"` — a genuine credential-shadowing guard. Frontend change is
boundary-only; headers correctly left on `toRecord` per scope. `helio-mcp` still writes the
object encoding and is covered by dual-read; no frontend read path consumes `queryParams`
from a response, so the wire-shape change has no unhandled consumer.

Tests, against the "what the request contained, not that it returned 200" bar: the new backend
specs bind a real server and assert `req.uri.rawQueryString` exactly (`shouldBe "tag=a&tag=b"`,
`"z=1&a=2&z=3"`), and the bare-url spec re-reads the *persisted* config and re-issues it through
a driver with no `fetchOverride`. Order is genuinely asserted (exact string equality, and
`contain theSameElementsInOrderAs` on pairs), not merely multiplicity. No test asserts a status
code. The one gap is the endpoint-carried case (Phase 1 issue 1) — a guard that cannot fail on
the defect it names.

### Phase 3: UI Review — N/A

`frontend/**` files changed, so the trigger matches literally, but the change is a two-function
wire-serialization edit (`toOrderedPairs`, a TS type) with no rendered-UI or UX surface:
`KeyValueListField` already modelled duplicate rows, and no component or state shape changed.
Per instruction, no browser/Playwright work was performed. I do not believe browser review is
required here; if the skeptic disagrees, the only observable to check is that the REST source
form still saves (covered by the updated Jest tests).

### Overall: FAIL

### Change Requests

1. Make the endpoint-carried-query test failable on pre-fix `main`.
   `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverQueryParamsSpec.scala:167-181`:
   replace the 2-pair fixture with one that the old `uri.query().toMap` fold actually breaks —
   either the 6-key fixture whose red output the commit body already records
   (`endpoint = "/echo-query?e1=1&e2=2&e3=3"`, config `c1..c3`, expecting
   `"e1=1&e2=2&e3=3&c1=10&c2=20&c3=30"`), or an endpoint carrying a repeated key
   (`"/echo-query?tag=a&tag=b"`), which the old fold collapsed. Keep exact-raw-query assertion.
2. Correct the "discards the endpoint's query string" overstatement where it is shipped in code:
   `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala:137-140` and
   the test comment at `RestApiConnectorDriverQueryParamsSpec.scala:167-168`. Accurate wording:
   the old fold *reordered* the endpoint's pairs (hash order) and *collapsed duplicates within
   them*; it did not drop the query string. Update design.md D4 / proposal.md to match so the
   archived record is not false.
3. Fix the legacy-decode ordering claim and pin the real behaviour. design.md D2 and tasks.md 3.1
   say "document order"; spray-json parses objects into a `TreeMap`, so
   `QueryParams.read`'s `JsObject` branch (`backend/src/main/scala/com/helio/domain/model/model.scala:571-575`)
   yields key-sorted order. Either state key-sorted order explicitly (and note it is not a
   regression, since the pre-change `Map` order was arbitrary), or make the branch order-explicit.
   Add/extend a decode test in `DataSourceProtocolSpec.scala` with a legacy fixture whose document
   order differs from alphabetical (e.g. `{"z":"1","a":"2"}`) asserting the actual resulting order,
   so the behaviour is pinned rather than coincidental.
4. Correct the two stale fence statements: `openspec/changes/preserve-repeated-query-params/files-modified.md`
   (says PipelineProposalProtocol was "inline-qualified to avoid adding an import" — it was not;
   an import was added, correctly) and the last sentence of the `QueryParams` scaladoc at
   `backend/src/main/scala/com/helio/domain/model/model.scala:544-546` (still cites the withdrawn
   "exactly its two fenced `queryParams` lines" constraint).

### Non-blocking Suggestions

- design.md still lacks a `D4a` heading while tasks 4.2, the code comment at
  `RestApiConnectorDriver.scala:227` and the spec delta all cite it — the skeptic's round-2
  non-blocking note, still open. Worth adding before archive so a credential-precedence rule is
  not a dangling cross-reference.
- `SourceService.scala:135` (the concatenated `QueryParams(...)` line) runs long; a named
  `val urlAndConfigQueryParams` above the constructor would read better.
- Task 4b.3's spinoff ticket for the dropped `request.config.parameters` at the same `createRest`
  site should be confirmed as actually filed before archive.
