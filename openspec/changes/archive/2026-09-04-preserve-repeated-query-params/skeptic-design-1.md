## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All commands run in the worktree at `0f16b85d` (clean except the untracked change dir).

- **Ground-truth claims in design.md Context are accurate.** `model.scala:529`
  `queryParams: Map[String, String] = Map.empty`; `RestApiConnectorDriver.scala:137-139` is the
  `foldLeft(...) { case (uri,(k,v)) => uri.withQuery(Uri.Query(uri.query().toMap + (k -> v))) }`
  fold; `injectAuthQueryParam:222` repeats it; `RestSourceConnectorMigration.splitUrl:87`
  returns `queryPairs.toMap` with the `hasDuplicateKeys` warning at 131-138;
  `DataSourceProtocol.scala:157/394/410`. All read directly.
- **`decodeRest` read in full** (`DataSourceConfigCodec.scala:45-77`): total by returning
  `Either`, with three never-conflated outcomes, outcome 3 being an explicit
  `Left("malformed: ...")` produced by *catching* `DeserializationException`.
- **Full `queryParams` consumer sweep**: `grep -rn queryParams backend/src frontend/src helio-mcp/src schemas/ openspec/specs/`.
  Surfaced three surfaces the plan does not name: `SourceService.scala:113`,
  `schemas/pipelines/create-pipeline-request.schema.json:42`, and
  `openspec/specs/rest-api-connector/spec.md:10,147`.
- **`splitUrl` callers**: only `RestSourceConnectorMigration` and `SourceService.scala:113`
  (which discards both the query pairs and the duplicate flag).
- **Spray wiring read**: `DataSourceConfigCodec.scala:20` `jsonFormat11(RestApiConfigPayload.apply)`
  and `PipelineProposalProtocol.scala:153-154` `jsonFormat11(ProposalRestApiConfig.apply)`.
- **Frontend read/write direction**: `useRestSourceForm.ts` + `dataSourceService.ts` are
  write-only for REST config (create/infer); nothing parses a server-returned `queryParams`
  back into the form. D6 is safe on that count.
- **helio-mcp**: `DataSourceResponse.config?: unknown` (`types.ts:96`), so the array read
  encoding does not break MCP typing; MCP only *writes* objects, which dual-read covers.
  Confirms the fence on helio-mcp is livable — but the plan never says so.
- **`check-schema-drift.mjs` read**: it compares field *names* against case classes, not types,
  so it will not flag the stale schema. The schema is still wrong as a contract.

### Verdict: REFUTE

The core shape (ordered `Seq[(String,String)]`, dual-read, one ordered `Uri.Query`, red-first
proof asserting the received query string) is right, and the proof strategy in tasks 1.1–1.3 is
genuinely real rather than status-code theatre. Five specific problems block it.

### Change Requests

1. **tasks.md 3.3 instructs a silent-corruption regression and misstates HEL-826.**
   It says "A malformed `queryParams` decodes to empty, it does not raise." That is not what
   decode-is-total means and not what the code does. `DataSourceConfigCodec.decodeRest:64-68`
   is total because it returns an `Either`; a malformed field today throws
   `DeserializationException` inside `json.convertTo[RestApiConfigPayload]`, which is caught
   and mapped to outcome 3, `Left("malformed: could not decode rest_api config")` — the
   docstring at line 45 calls this "fail-loud, no silent corruption". If the new field format
   swallows a malformed `queryParams` to empty, that catch never fires and a corrupted row
   fetches with *no* query params and no signal: exactly the defect class this ticket exists to
   close, reintroduced by the fix. Rewrite 3.3 to require that a `queryParams` value which is
   neither the array nor the object encoding still yields `Left("malformed: ...")` from
   `decodeRest`, and add a task-3 test asserting that outcome.

2. **The two-line fence on `PipelineProposalProtocol.scala` is probably not achievable as
   planned, and the plan should resolve that now rather than mid-execution.**
   Line 154 is `jsonFormat11(ProposalRestApiConfig.apply)`. Changing the field type at line 51
   requires an implicit `JsonFormat` for the new type to be *in scope in that file*, which
   normally means a third edit (an import). Relatedly, task 3.1 ("give the field a custom
   spray-json format") is under-specified for `jsonFormatN`, which resolves formats by field
   type, not per field: a bare `implicit JsonFormat[Seq[(String,String)]]` must be in scope in
   three separate files (`DataSourceProtocol`, `DataSourceConfigCodec:20`,
   `PipelineProposalProtocol:154`) and risks ambiguity with spray's own
   `immSeqFormat`/`tuple2Format`. Decide and record the mechanism — a small named wrapper type
   (e.g. `QueryParams`) with its own `RootJsonFormat` sidesteps both problems and makes the
   import explicit — then either confirm the fence still holds or get it widened by one import
   line before execution starts. Note also that the ticket and design cite line **95** for the
   `cfg -> DTO` mapping; it is line **91**.

3. **A fourth collapse point is missed, and it defeats acceptance criterion 1 on one authoring
   path.** `SourceService.scala:113` (the bare-`url` create branch) is
   `val (baseUrl, endpoint, _, _) = RestSourceConnectorMigration.splitUrl(url)` — it discards
   the URL's entire query string (`endpoint` is `uri.path` only), and the `RestApiConfig`
   built at 126-134 sets no `queryParams` at all, so `request.config.queryParams` is dropped
   too. A source created as `url = "https://api/x?tag=a&tag=b"` therefore issues *neither*
   value, before and after this change. This is the same defect class on the same path the
   widened repro enumerated; the plan names neither the file nor the behavior. Either fix it
   (pass the pairs through — trivial once `splitUrl` returns them) or record it as an explicit,
   justified non-goal with a spinoff. Silence is not acceptable when AC 1 is phrased as "a
   source authored with `?tag=a&tag=b`".

4. **`injectAuthQueryParam`'s collision semantics change silently under D4.** Today
   `uri.query().toMap + (apiKeyName -> credentialValue)` means an injected auth param
   *overwrites* a source-supplied param of the same name — the query-side twin of the explicit
   auth-header-always-wins rule at `RestApiConnectorDriver.scala:150-156` (which exists because
   a prior skeptic raised it). D4/task 4.2 changes this to an append, so a source configured
   with `?api_key=attacker-chosen` would produce `api_key=attacker&api_key=<real credential>`,
   and many servers take the first occurrence. The spec delta's last scenario ("every source
   pair plus the api-key pair") endorses the append without addressing the name-collision case
   at all. Decide the rule explicitly — my recommendation is to mirror the header path (drop
   source pairs whose name equals `apiKeyName`, then append the auth pair) — and add a spec
   scenario plus a test for the colliding-name case.

5. **Contract artifacts are stale and the spec delta is filed under the wrong operation.**
   (a) `schemas/pipelines/create-pipeline-request.schema.json:42` declares
   `"queryParams": { "type": ["object", "null"] }`, which excludes the new array encoding.
   proposal.md's Impact asserts "No schema change" — that is false, and CLAUDE.md requires
   schema updates in the same change. (`check-schema-drift.mjs` compares field names only, so
   the gate will not catch this for you.) Add the schema update to Impact and to tasks.
   (b) The delta is `## ADDED Requirements`, but proposal.md declares `rest-api-connector` a
   *modified* capability, and the existing spec still says `queryParams` is a map-shaped
   optional (`openspec/specs/rest-api-connector/spec.md:10`, and the `config carries only ...
   queryParams` sentence at 147). Archiving an ADDED requirement leaves the merged spec
   self-contradictory. Use `## MODIFIED Requirements` against the affected existing
   requirement(s), or add the corresponding `## MODIFIED` block.

### Non-blocking notes

- The proof strategy is the strongest part of the plan: tasks 1.1–1.3 assert the query string
  the bound server *received*, and 1.2's `(z,1),(a,2),(z,3)` fixture is well chosen precisely
  because it differs from both alphabetical and map-iteration order. Keep that discipline in 8.1.
- D3's rollback story checks out: `data_sources.config` is JSONB read through `decodeRest`, no
  row is rewritten by deploy alone, and an array-shaped row only appears after a re-save.
- Worth one sentence in the proposal: helio-mcp is fenced off and stays correct because it only
  *writes* the object encoding (dual-read covers it) and reads `config` as `unknown`
  (`helio-mcp/src/types.ts:96`). Right now the plan simply doesn't mention it, which reads as an
  oversight rather than a checked conclusion. Same for
  `AssistantProposalToolSchemas.scala:129/389`, whose prose descriptions of `queryParams` will
  become mildly stale.
- `POST /api/sources/infer` shares `RestApiConfigPayload`, so it inherits the new encoding.
  That is fine and does not reach into HEL-868's inference logic, but saying so explicitly
  would document the sibling-run boundary.
