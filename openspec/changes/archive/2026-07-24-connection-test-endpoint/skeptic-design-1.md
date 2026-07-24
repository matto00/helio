## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/connection-test-endpoint/spec.md`, `tasks.md` in full.
- Read the four predecessor precedents named in the ticket: `domain/Connector.scala` (SPI trait +
  doc-comment contract blocks, EC rule), `services/{SchemaInferenceFacade,CreateSourceEnvelope,
  SecretField}.scala`, and the archived `connector-spi-shared-trait/design.md` ("Sibling ownership
  map" — confirms HEL-480 owns "Connection-test HTTP endpoint + UI").
- Read `SqlConnector.testConnection`/`RestApiConnector.testConnection` (domain layer, already shipped
  by HEL-449) to confirm the design's semantic claims ("open+close, no query"; "status-only, no body
  parse") are accurate to the actual code, and read the existing `SqlConnectorSpec`/
  `RestApiConnectorSpec` tests that already lock those semantics down at the SPI layer (so the design
  is correct not to re-litigate them at the route level).
- Read `SourcePreviewRoutes.scala` (the file this ticket extends) to verify its `infer` dispatch
  pattern (raw `type` field sniff → `convertTo[SqlInferRequest]` for SQL vs. `convertTo
  [RestApiConfigPayload]` directly on the whole body for REST) and confirmed this pattern is
  **asymmetric between connector types** — SQL nests config under a `config` key, REST does not.
- Read `SourceService.scala` and `ServiceResponse.scala`/`ServiceError.scala` to confirm `BadGateway`
  is documented and used today specifically for "connector preview / refresh paths that propagate
  REST or SQL fetch errors back as 502" — i.e. `inferSql`/`inferRest`, which live in the same file
  this ticket extends, both map connector-level failure to `ServiceError.BadGateway` → HTTP 502.
- Read `dataSourceService.ts`, `SqlTab.tsx`, `SqlTab.test.tsx`, `RestApiForm.tsx`, `AddSourceModal.tsx`,
  `sourcesSlice.ts`, `InlineError.tsx`, and `DESIGN.md` §5/§6/§7/§8 to check the frontend plan against
  real code and the binding design standard.

### Verdict: REFUTE

Two of the three findings below are concrete, code-grounded implementation blockers or a genuine
functional-regression risk, not stylistic nits — this is exactly the "unenforced claim" and
"decision deferred that blocks implementation" pattern the epic has been held to.

### Change Requests

1. **Decision 6 (`SqlTab.tsx`) removes the only trigger for schema-preview/inference without
   replacing it — "Create source" would become permanently disabled.** `SqlTab.tsx`'s existing
   "Test connection" button is the *only* thing that calls `inferSqlSource` and populates
   `inferredFields`; `SqlTab`'s "Create source" button is disabled via
   `disabled={isSaving || isTesting || inferredFields === null}` (`SqlTab.tsx:199`) specifically
   gated on that state. Design Decision 6 replaces this button with `TestConnectionAffordance`,
   which by design "does not return inferred fields" — yet the same Decision also asserts "the
   schema-preview step (`inferredFields`/`DataGrid`) is unchanged and still gated on a separate,
   explicit inference call." No task or design text specifies what UI element now makes that
   separate call. As written, after this change ships, `inferredFields` can never become non-null in
   `SqlTab`, and "Create source" can never be enabled — a functional regression, not a preserved
   behavior. This needs an explicit resolution before implementation: either (a) add a distinct,
   named "Infer schema"/"Preview schema" trigger to `SqlTab.tsx` (and a task for it), or (b) drop the
   pre-create schema-preview step entirely and change the Create-source gating condition (e.g. gate
   on test-connection success instead of `inferredFields`), explicitly updating Decision 6, and
   updating the two `SqlTab.test.tsx` tests that currently assert the old click-to-infer behavior
   (see item 3). Right now the design simultaneously claims a behavior change (button no longer
   infers) and a behavior non-change ("schema-preview stays unchanged") that are incompatible without
   a mechanism neither the design nor the tasks supply.

2. **Wire-shape asymmetry between SQL and REST inherited from mirroring the `infer` route is not
   documented, and the frontend task's phrasing invites getting it wrong.** `SourcePreviewRoutes.scala`'s
   existing `infer` dispatch converts the SQL body via `convertTo[SqlInferRequest]` (`{ type, config:
   {...} }`, config nested) but converts the REST body via `convertTo[RestApiConfigPayload]` applied to
   the **whole request body directly** (`{ url, method, auth, headers }`, flat — no `config` wrapper;
   `type` is optional and defaults to `rest_api` when absent). Design Decision 2/3 say the new `/test`
   route "mirrors" this exact dispatch "exactly" — which is fine for the backend (task 1.5 inherits it
   correctly by construction) — but this means the **frontend must send two structurally different
   body shapes** for SQL vs. REST (`{ type: "sql", config: {...} }` vs. a flat REST body), matching
   `inferSqlSource`'s and `inferFromJson`'s existing, different call shapes in the same
   `dataSourceService.ts` file. Task 2.1 describes a single, uniform-sounding
   `testConnection(type, config)` function with no mention of this asymmetry, and the ticket/proposal
   text ("the same discriminated `type` + `config` payload") reads as if both connector types use one
   uniform envelope — they do not, for REST, on this exact route family. An implementer following the
   ticket's literal wording (uniform `{ type, config }` wrapper for both) would send REST config nested
   under `config`, which `convertTo[RestApiConfigPayload]` would fail to parse (missing required `url`
   at the top level) → every REST connection test would 400 even for a valid config. Required revision:
   design.md Decision 2 must state the asymmetry explicitly, and tasks.md task 2.1 must instruct
   `testConnection` to build the SQL and REST bodies exactly as `inferSqlSource`/`inferFromJson`
   already do (nested vs. flat), with a task or scenario asserting the REST body's shape at the
   request layer (not just the response-shape tests already planned).

3. **Task 3.5's "unmodified" claim contradicts Decision 6's stated behavior change, and the repo rule
   this ticket is bound by ("stop and report why" before editing a test) is not satisfied.**
   `SqlTab.test.tsx` currently has two tests — "shows inferred fields on successful test connection"
   and "shows inline error on test connection failure" — that click the button labeled "Test
   connection" and assert it calls `inferSqlSource` and renders inferred fields / infer-sourced error
   text. Decision 6 explicitly repurposes that exact button to call the new lightweight
   `testConnection` endpoint instead (which never returns fields). These two tests cannot pass
   unmodified after that change — their premise (click "Test connection" → get inferred fields) is
   invalidated by design. Task 3.5 should not present this as "confirm ... pass unmodified"; it should
   name these two tests specifically as tests that **must** be rewritten (once item 1 resolves what the
   corrected flow actually is), with the required disclosure the ticket's own gotcha list demands
   ("if one genuinely needs changing, stop and report why").

### Non-blocking notes

- Decision 1's HTTP-status choice (`200 OK` + `ok:false` for a connector-level failure, never
  `ServiceError.BadGateway`) is justified against `CreateSourceResponse.fetchError`'s precedent, but
  the design never acknowledges that `inferSql`/`inferRest` — the two routes living in the very same
  file this ticket extends, explicitly cited elsewhere in Decision 3 as the pattern being mirrored —
  use `ServiceError.BadGateway` (502) for the identical "connector reported failure" case. Given the
  ticket's own AC dictates the `{ok, error}` wire shape, I'm not asking for a different technical
  decision — I'm asking Decision 1 to name and reconcile the `BadGateway` precedent explicitly (why a
  connection *test's* failure is domain-shaped while an *infer* failure is HTTP-shaped), rather than
  citing only the more favorable create-time precedent and staying silent on the directly-adjacent,
  directly-contradicting one.
- `proposal.md`'s "What Changes" and "Impact" sections say the route is "Wired into `ApiRoutes.scala`
  alongside `SourceRoutes`," and list `ApiRoutes.scala` under Impact. `design.md`'s actual (self-
  approved) approach extends `SourcePreviewRoutes.scala` in place — already wired into `ApiRoutes.scala`
  — touching neither `ApiRoutes.scala` nor `SourceRoutes.scala`. Not blocking (design.md is the more
  specific/authoritative artifact and is internally consistent), but proposal.md should be corrected so
  the artifacts agree.
- Task 2.2's "or keep local-only ... skip this task" phrasing is in slight tension with Decision 5's
  own wording ("dispatches the new `testConnection` thunk itself") — Decision 5 implies a thunk always
  exists (used purely for the async call, per the existing `inferSqlSource`-in-`SqlTab` pattern, with
  no slice-state storage), while task 2.2 treats the thunk's existence as optional. Worth tightening so
  both artifacts describe the same mechanism.
