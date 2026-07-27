## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `skeptic-design-1.md` (round-1 REFUTE, four change requests) and the revised `proposal.md`,
  `design.md`, `tasks.md`, `specs/workspace-context-assembly/spec.md` in full (not just the diff).

**CR1 — Content-field bounding at the SQL tier (design.md D1/D3):**
- `backend/src/main/scala/com/helio/domain/model.scala:453-502` — `FieldTypeCategory.Structured`/
  `Content` and `DataFieldType.category(t)` exist exactly as D3 assumes; all 7 canonical field types
  (`string`/`integer`/`float`/`boolean`/`timestamp` → Structured, `string-body`/`binary-ref` → Content)
  are exhaustively partitioned — no gap in the category function.
- `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala:40` — `TEXT_MAX_FILE_SIZE_BYTES`
  defaults to 10,485,760 (10 MB), matching D1's cited figure.
- `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala` (current) — `listRows`
  has no `limit`/`excludeKeys` params yet, confirming D1's premise this is new work, not already-done.
- `jsonb - text` (Postgres) is a real operator; chaining `data - $k1 - $k2 - ...` is valid left-associative
  syntax. Binding each key as a parameter (not string-interpolated) fully avoids SQL injection. Slick
  3.5.2 (`backend/build.sbt:97`) supports `SQLActionBuilder ++` concatenation, the mechanism D1 describes
  for building the dynamic-arity query — architecturally sound, though unprecedented elsewhere in this
  codebase (checked `DataTypeRowRepository.scala`, `WorkspaceTeardownRepository.scala`,
  `DataTypeRepository.scala:204` — all use fixed-arity `sql"..."` today).
- Non-blocking implementation nuance: Postgres has three overloaded `jsonb -` operators (`text`,
  `integer`, `text[]`); an unspecified-type bind param can occasionally trigger "operator is not unique"
  and require an explicit `::text` cast. D1 doesn't call this out, but it would fail loudly during task
  4.6's own route test, not silently corrupt behavior — not blocking.

**CR2 — Truncation algorithm (design.md D3):** now states an exact, type-uniform rule
(`compactPrint.length > 200` → `JsString(compactPrint.take(200) + "…[truncated]")`), identical marker
text pinned for both Scala and TS (D3/D6), with an oversized-non-string-cell case added to tasks 4.2 and
4.7. Unambiguous enough for independent implementations to match.

**CR3 — `overwriteRows` call-site correction (design.md D2):** `grep -rn overwriteRows
backend/src/main/scala` → exactly two sites: `PipelineRunService.scala:354` (run-success path) and
`BoundPanelService.scala:297` (compensating rollback cleanup). Matches D2's corrected "two call sites...
neither is ever called with a source-companion id" language exactly.

**CR4 — D7 / tasks.md 2.2 (`dataTypeRepo` → `dataTypeService` swap):**
- `WorkspaceContextService.scala:34,45` (current) — `dataTypeRepo` is used for exactly one call,
  `dataTypeRepo.findAll(user.id, Page.Default)`.
- `DataTypeService.scala:24-25` — `findAll(user, page, tag)` wraps that identical
  `dataTypeRepo.findAll(user.id, page, tag)` call.
- `ApiRoutes.scala:143,212` — `dataTypeService` val already exists; `new WorkspaceContextService(...)` at
  line 212 currently passes `dataTypeRepo`, confirming both the premise and the concrete edit site.
- `WorkspaceContextServiceSpec.scala:112` — test fixture currently constructs with `dataTypeRepo`,
  confirming task 2.2's fixture-update requirement is real, not phantom.
- Task 2.2 is explicitly present in tasks.md.

**Independent sanity checks (orchestrator's additional questions):**
- tasks.md 4.6 explicitly covers `?limit=`/`?excludeContentFields=` at the route level against
  `DataTypeRoutesSpec.scala` (file exists).
- `WorkspaceContextService`'s in-process path (design.md D1, tasks 2.3) computes `excludeKeys` directly
  from the already-in-hand `dt.fields` — no boolean-default footgun. MCP (`context.ts`, tasks 3.1-3.3)
  always passes `excludeContentFields=true` explicitly. The sanitizer's Structured-only filter (task 2.1)
  is genuine second-layer defense-in-depth, not the sole barrier against a 10MB leak — the SQL-tier
  exclusion is the primary cost control (bytes never leave Postgres). No default-false gap found in
  either call path.
- `DataFieldType.category`/`FieldTypeCategory` exist and are used correctly by design.md's assumptions
  (see CR1 above).

### Other checks

- `WorkspaceContextProtocol.scala:100-101` — confirmed current `jsonFormat8` for `WorkspaceContextDataType`,
  matching the design's jsonFormat8→9 plan (task 2.4).
- `DataTypeService.scala:33-41` (current `listRows`) confirms the `findByIdOwned` ownership choke point D4
  relies on is real and unchanged by this design.
- `backend/src/test/scala/com/helio/services/WorkspaceContextServiceSpec.scala` and
  `backend/src/test/scala/com/helio/api/routes/DataTypeRoutesSpec.scala` both exist as targets for tasks
  4.1-4.6.
- Re-read the whole design fresh (Goals/Non-Goals, D1-D7, Risks, Migration Plan, Open Questions) and the
  rewritten spec.md scenarios (four new/modified requirements, each with GIVEN/WHEN/THEN scenarios covering
  row cap, column cap, cell truncation, Content-field exclusion, owner-scoping) — found no new
  contradictions, placeholders, or scope drift versus proposal.md/ticket.md.

### Verdict: CONFIRM

### Non-blocking notes

- D1's jsonb key-stripping query doesn't mention an explicit `::text` cast on the bound keys; Postgres's
  three overloaded `jsonb -` operators can occasionally require one to avoid an "operator is not unique"
  error with unspecified-type bind params. Worth a one-line addendum, but this would surface immediately
  as a failing test (task 4.6), not a silent defect, so it isn't blocking.
- The direct `/rows?excludeContentFields=true` route path (used by MCP) does two owner-scoped lookups per
  request under D1's current phrasing ("the route computes excludeKeys from the DataType's own findById
  fields") — one for field metadata, one inside `listRows`'s own `findByIdOwned`. `DataTypeService.listRows`
  already discards a fetched `DataType` (`case Some(_) => ...`) that could be reused to compute `excludeKeys`
  internally instead, avoiding the redundant round trip. Minor efficiency nit, not a correctness issue.
- tasks.md 2.1's pseudocode (`DataFieldType.category(fromString(f.dataType)) == Structured`) doesn't
  literally type-check as written (`fromString` returns `Option[DataFieldType]`; `category` takes a bare
  `DataFieldType`) — but design.md D3's prose ("a field whose dataType string doesn't parse is
  conservatively treated as excluded") makes the intended pattern-match unambiguous for any competent
  implementer.
