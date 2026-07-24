## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Re-read `proposal.md`, `design.md`, `specs/connection-test-endpoint/spec.md`, `tasks.md`, `ticket.md`
  in full, fresh (not diffed against round 1).
- Read `backend/src/main/scala/com/helio/domain/Connector.scala`, `SqlConnector.scala`,
  `RestApiConnector.scala` (`testConnection` implementations) to confirm the design's semantic claims
  against actual code.
- Read `backend/src/main/scala/com/helio/api/routes/SourcePreviewRoutes.scala` and
  `backend/src/main/scala/com/helio/services/SourceService.scala` in full to confirm the `infer`
  dispatch asymmetry (SQL nested under `config` via `convertTo[SqlInferRequest]`, REST flat via
  `convertTo[RestApiConfigPayload]` on the whole body with `.getOrElse(DataSourceKind.RestApi)`
  fallback) and the `BadGateway` precedent design.md Decision 1 reconciles against — both match
  design.md's claims exactly.
- Read `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` to confirm
  `SqlInferRequest`/`RestApiConfigPayload` already exist with the wire shapes design.md assumes, and
  that `SqlConnector`/`RestApiConnector` both `extend Connector[Config]` (grounding the generic
  `ConnectionTest.run[Config]` helper design.md Decision 3 proposes).
- Read `frontend/src/features/sources/ui/SqlTab.tsx`, `SqlTab.test.tsx`,
  `frontend/src/features/sources/services/dataSourceService.ts`,
  `frontend/src/features/sources/state/sourcesSlice.ts`, `sourcesSlice.test.ts`,
  `frontend/src/features/sources/ui/RestApiForm.tsx`, `AddSourceModal.tsx`,
  `frontend/src/shared/chrome/InlineError.tsx`, and `frontend/src/theme/theme.css` (confirmed
  `--app-success` exists in both light/dark palettes) to check the frontend plan end-to-end against
  real code.
- Confirmed CR1 (round 1): `SqlTab.tsx`'s "Test connection" button is still the sole
  `inferSqlSource`/`inferredFields` trigger today; design.md Decision 6 now correctly renames it to
  "Infer schema" and adds `TestConnectionAffordance` as a separate control — `sourcesSlice.test.ts`
  has no `inferSqlSource`-related test at all, confirming tasks.md 3.5's "passes unmodified" claim for
  that file is accurate.
- Confirmed CR2 (round 1): `inferSqlSource` (`dataSourceService.ts:187-193`) posts `{ type: "sql",
  config }` (nested); `inferFromJson` (`dataSourceService.ts:169-172`) posts the config object
  **directly**, no wrapper, no `type` field — exactly as design.md Decision 2 now documents, and
  `SourcePreviewRoutes.scala`'s `infer` dispatch (lines 33-51) confirms the `.getOrElse` fallback
  mechanism that makes the flat REST shape work without an explicit discriminator.
- Confirmed CR3 (round 1): tasks.md 3.5 now explicitly names the two `SqlTab.test.tsx` tests
  ("shows inferred fields on successful test connection", "shows inline error on test connection
  failure") requiring update, not a silent/unclaimed edit.
- Grepped the whole repo for `"Test connection"` / `"Infer schema"` to find every artifact this rename
  touches — surfaced a gap neither round 1 nor the change's own artifacts caught (CR1 below).
- Traced `RestApiForm.tsx`'s actual DOM placement inside `AddSourceModal.tsx` (`<form
  id="add-source-configure-form" onSubmit={(e) => void handlePreview(e)}>`, lines 413-449) to check
  the new-affordance wiring for a concrete functional hazard (CR2 below).

### Verdict: REFUTE

Both change requests below are concrete, code-grounded gaps — not stylistic nits. Round 1's three
findings are correctly resolved in the current artifacts; these are new findings this pass surfaced.

### Change Requests

1. **The `SqlTab.tsx` button rename invalidates a live, binding requirement in
   `openspec/specs/sql-database-connector/spec.md`, and this change plans no delta for it.**
   `openspec/specs/sql-database-connector/spec.md:111-125` ("Frontend SQL Database tab" requirement,
   current/binding, not archived) states: *"A 'Test connection' button SHALL call `POST
   /api/sources/infer` with `source_type: "sql"` and display the inferred schema preview,"* with a
   scenario "Test connection shows schema preview" keyed to clicking a button literally named "Test
   connection." Design Decision 6 (correctly, per round 1's fix) renames that exact button to "Infer
   schema" and introduces a **new, different** button also named "Test connection" that calls
   `/api/sources/test` instead. After this ships, the spec's literal claim is false in both directions:
   no button named "Test connection" calls `/api/sources/infer` any more, and the button that is named
   "Test connection" doesn't do what the spec says a "Test connection" button does. `proposal.md`'s
   `## Capabilities` section claims `Modified Capabilities: (none — ... connector-spi,
   fetch-error-envelope, and connector-secret-redaction are consumed as-is, not modified)` — it doesn't
   even mention `sql-database-connector`, despite proposal.md's own "What Changes" item 3 explicitly
   modifying the exact UI element that capability's spec governs. This is the same "missing contract
   update" class of defect round 1 caught for the endpoint's request shape, now recurring for the UI
   capability delta. Required: add `openspec/changes/connection-test-endpoint/specs/sql-database-connector/spec.md`
   with a `MODIFIED Requirements` delta updating the "Frontend SQL Database tab" requirement (and its
   "Test connection shows schema preview" / "Connection error shown inline" scenarios) to describe the
   renamed "Infer schema" trigger plus the new, additional "Test connection" affordance alongside it;
   update `proposal.md`'s Capabilities section to list `sql-database-connector` as modified (not silently
   omitted); add a corresponding tasks.md item.

2. **Neither design.md Decision 5 nor tasks.md 2.2/2.4 specify that `TestConnectionAffordance`'s
   internal `<button>` must be `type="button"`, and the file it's wired into makes this a real, not
   theoretical, hazard.** `AddSourceModal.tsx` renders `SqlTab`, `RestApiForm`, and `CsvForm` all inside
   one `<form id="add-source-configure-form" onSubmit={(e) => void handlePreview(e)}>` (lines 413-449) —
   confirmed by reading the file directly, not inferred. `SqlTab.tsx`'s two existing buttons
   (`SqlTab.tsx:187,196`) both already carry explicit `type="button"` specifically because of this
   wrapping — proof the codebase already treats this as a load-bearing detail, not incidental style.
   `handlePreview` starts with `event.preventDefault()` then calls `inferFromJson(config)` and, on
   success, transitions the modal's `step` state to `"preview"` — a full step change, not a no-op. Task
   2.4 wires `TestConnectionAffordance` into `RestApiForm.tsx` — new territory, since REST has no
   test-connection control today — and nothing in design.md or tasks.md instructs the component's
   button to be `type="button"`. Without it, clicking "Test connection" in the REST form would *also*
   fire native form submission, invoking `handlePreview`/`inferFromJson` and silently advancing the
   modal to the schema-preview step regardless of the connection-test's own result — a serious,
   easy-to-miss behavior collision, not a stylistic gap. Required: design.md Decision 5 (or a new
   decision) must state the button is `type="button"`, and tasks.md must add a test (or extend 3.4)
   asserting that clicking the affordance's button in the `RestApiForm` (and `SqlTab`) placements does
   not invoke `handlePreview`/`inferFromJson`/advance `AddSourceModal`'s step.

### Non-blocking notes

- `proposal.md`'s "What Changes" phrasing — *'Error messages reuse `testConnection`'s existing curated
  categories ("SQL connection failed", "Request failed", etc.) unmodified'* — is imprecise for REST.
  `RestApiConnector.testConnection`'s non-2xx branch (`RestApiConnector.scala:106`) returns
  `s"HTTP ${status}: ${entity.data.utf8String}"`, embedding the raw upstream response body verbatim —
  not a short curated category like "Request failed" (that string is reserved for the
  network-exception `.recover` branch, line ~113). `design.md`'s own Risks section already correctly
  names and accepts this exact behavior (citing the same line), so this is a proposal.md wording nit
  only, not a design defect — the more authoritative artifact already gets it right.
