## 1. Prove the defect (red first)

- [x] 1.1 Add a backend test that binds a **real** local HTTP server, configures a REST source with
      `queryParams` for `tag=a` and `tag=b`, fetches, and asserts on the query string the server
      **received**. It must fail on current `main` by observing a single `tag` value. Record the red
      output (the actual received query string) in the commit body -- not "the test failed".
- [x] 1.2 Add a second red test for order: pairs `(z,1),(a,2),(z,3)` must arrive in that exact order.
      Chosen so alphabetical order and map-iteration order both differ from the correct answer, so a
      passing result cannot be an accident.
- [x] 1.3 Add a red test for the endpoint-carried query string, using a fixture with enough
      distinct keys to force Scala's hash-ordered `Map` representation (a small, e.g. 2-key,
      fixture is NOT failable -- `Map.Map2` happens to iterate in insertion order and passes on
      pre-fix `main` too, evaluation-1.md CR1). The current `uri.query().toMap` fold does not
      drop the endpoint's query string outright; it reorders its pairs (hash order, not
      insertion order) and collapses any duplicate key within them.
- [x] 1.4 Add a red test for the bare-`url` create path: creating a source with
      `url = "https://.../x?tag=a&tag=b"` currently issues **neither** value, because
      `SourceService.scala:113` discards `splitUrl`'s query pairs entirely (design D6a).

## 2. Domain representation

- [x] 2.1 Introduce `QueryParams` (a named wrapper over `Seq[(String, String)]`) in
      `domain/model/model.scala`, and change `RestApiConfig.queryParams` to it with an empty default.
      Update the scaladoc, which currently describes a map. The wrapper is required, not cosmetic --
      see design D1(a)-(c).
- [x] 2.1a Declare `RootJsonFormat[QueryParams]` in `QueryParams`'s **companion object** so implicit
      resolution finds it with no import in any consuming file. This is what keeps the
      `PipelineProposalProtocol.scala` edit to exactly its two fenced lines.
- [x] 2.2 Fix every compile break the type change produces. Do **not** reintroduce `.toMap` anywhere
      on this path to silence one.

## 3. Wire encoding (dual-read)

- [x] 3.1 Implement that companion format: read `JsArray` of `{name, value}` **or** a legacy
      `JsObject` (key-sorted order -- spray-json parses JSON objects into a `TreeMap`, so no
      document-order information survives to `QueryParams.read`; not a regression, since a
      legacy row has no duplicate key to begin with and the pre-change `Map`-based composition
      was equally order-arbitrary); always write the array. Do not add a loose
      `JsonFormat[Seq[(String, String)]]` to any protocol object -- `jsonFormatN` resolves by field
      type and it would collide with spray's `immSeqFormat`/`tuple2Format`.
- [x] 3.2 Update `toDomain`/`fromDomain` (`DataSourceProtocol.scala:394/410`).
- [x] 3.3 `decodeRest` gains no *new* validation branch -- it stays total by returning `Either`
      (HEL-826 invariant). Concretely: a `queryParams` value matching neither encoding SHALL throw
      `DeserializationException` from the format, which `decodeRest:64-68` already catches and maps to
      `Left("malformed: could not decode rest_api config")`. It must NOT be swallowed to empty --
      that would reintroduce this ticket's own defect class inside its fix.
- [x] 3.4 Round-trip test: legacy object in -> array out -> same domain value; array in -> array out.
- [x] 3.5 Test the malformed case explicitly: a `queryParams` of `"tag=a"` (a bare string) and an array
      entry missing `name` each produce `Left("malformed: ...")` from `decodeRest`, not an empty
      `QueryParams`.

## 4. Request composition

- [x] 4.1 Replace the `foldLeft`/`uri.query().toMap` composition in
      `RestApiConnectorDriver.buildResolvedRequest` with a single ordered `Uri.Query` built from the
      endpoint's existing pairs followed by the config's pairs.
- [x] 4.2 Fix `injectAuthQueryParam` to append rather than rebuild through `toMap` -- but preserve
      today's auth-wins-collision semantics (design D4a): drop every existing pair whose name equals
      `apiKeyName` first, then append the credential pair. Add a test for the colliding-name case;
      an append that left the source pair in place would be a credential-shadowing regression.
- [x] 4.3 Make `resolveMapValues` (query params only) an ordered per-pair traversal; leave the header
      variant on maps. Preserve the existing first-unresolved-variable `Left` behavior.

## 4b. Bare-url create path

- [x] 4b.1 `SourceService.scala:113` stops destructuring `splitUrl`'s query pairs away; the built
      `RestApiConfig` (lines 126-134) carries them, concatenated with any `request.config.queryParams`.
- [x] 4b.2 Test 1.4 now passes, asserting the received query string.
- [x] 4b.3 Do **not** also fix `request.config.parameters` being dropped at the same site -- that is a
      separate HEL-823 templating defect. File it as a spinoff ticket instead of absorbing it.

## 5. Migration path

- [x] 5.1 `RestSourceConnectorMigration.splitUrl` returns all pairs in order; drop the
      `hasDuplicateKeys` flag and its now-unreachable `logger.warn`.
- [x] 5.2 Test: a legacy URL with `?tag=a&tag=b` migrates into a config carrying both.

## 6. Proposal protocol (fenced)

- [x] 6.1 Update **only** the `queryParams` DTO field and its `cfg -> DTO` mapping line in
      `api/protocols/pipelines/PipelineProposalProtocol.scala`. Touch nothing else in that file.
      If the field's type has changed underneath (parallel run), stop and escalate.

## 6b. Contract schema

- [x] 6b.1 Widen `schemas/pipelines/create-pipeline-request.schema.json:42` (`queryParams` is currently
      `{"type": ["object", "null"]}`) to accept the array encoding as well. Note that
      `check-schema-drift.mjs` compares field *names* only and will not catch this for you.

## 7. Frontend boundary

- [x] 7.1 `useRestSourceForm` emits ordered query-param pairs instead of `toRecord(queryParams)`;
      headers keep `toRecord`. Update `dataSourceService`'s type.
- [x] 7.2 Update `useRestSourceForm.test.ts`, whose current test asserts the collapse as correct
      behavior ("collapses ordered queryParams/headers into Record maps").

## 8. Verify

- [x] 8.1 Tests from section 1 now pass, for the right reason: assert the received query string, never
      a status code.
- [x] 8.2 Prove backward compatibility on a **real** persisted row shape: decode an actual
      map-shaped `config` blob and assert the composed request is byte-identical to the pre-change one.
- [x] 8.3 `sbt test`, `npm test`, `npm run lint`, `npm run typecheck` all green.
- [x] 8.4 No Flyway migration added; `git diff --stat` confirms no file under `db/migration/`.
- [x] 8.5 UPDATED (fence lifted post-HEL-914/HEL-868 merge, see commit body): `git diff` on
      `PipelineProposalProtocol.scala` is confined to the `queryParams` field, its
      `cfg -> DTO` mapping (unchanged here — both sides are already `Option[QueryParams]`),
      and one new top-of-file `import com.helio.domain.model.QueryParams` — no inline
      fully-qualified name anywhere (CONTRIBUTING.md "Imports & Qualifiers", mechanically
      enforced by `check-scala-quality.mjs`). The original two-line/no-import fence existed
      only to avoid conflicting with HEL-914's in-flight edits to this file; both tickets
      merged to main before this change landed, so the fence no longer applies.
