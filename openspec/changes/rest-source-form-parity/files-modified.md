# Files modified — HEL-827

- `frontend/src/features/sources/services/dataSourceService.ts` — extended `RestApiConfigBody` with `endpoint`, `queryParams`, `parameters` (fields the backend already accepted but the client type didn't declare).
- `frontend/src/features/sources/hooks/useRestSourceForm.ts` — new hook owning all REST field state (connector/endpoint/method/queryParams/headers/body/bodyContentType/rootSelector/parameters) plus the single shared `buildRestSourceConfig()` composer (design.md Decision 1a/5).
- `frontend/src/features/sources/hooks/useRestSourceForm.test.ts` — new unit tests for the composer (never emits bare `url`, collapses key/value lists, detects/resolves template parameters, body only for bodied methods).
- `frontend/src/features/sources/ui/forms/ConnectorSelectField.tsx` — new Connector picker (existing Connectors + inline "create new", portalled `CreateConnectorModal` to avoid invalid `<form>`-in-`<form>` nesting).
- `frontend/src/features/sources/ui/forms/ConnectorSelectField.css` — styles for the Connector picker.
- `frontend/src/features/sources/ui/forms/KeyValueListField.tsx` — new shared ordered key/value list editor, used for both query params and headers; flags (non-blocking) duplicate keys.
- `frontend/src/features/sources/ui/forms/KeyValueListField.css` — styles for the key/value list editor. Cycle 2: added a `@media (max-width: 768px) { min-height: 44px }` rule to `.key-value-list-field__add` ("+ Add row"), matching the sibling "Remove row" `IconButton`'s existing mobile tap-target floor, per evaluation-1.md's DESIGN.md finding.
- `frontend/src/features/sources/ui/forms/TemplateParametersField.tsx` — new editor rendering one value input per detected `{{name}}` placeholder.
- `frontend/src/features/sources/ui/forms/TemplateParametersField.css` — styles for the template-parameters editor.
- `frontend/src/features/sources/ui/forms/RestApiForm.tsx` — rewritten to be purely presentational over `useRestSourceForm`; replaces the bare URL input with Connector picker + endpoint path field, wires in the new query params/headers/template-parameters fields, disables "Test connection" until a Connector is selected.
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — lifted all REST field state into `useRestSourceForm`; `handlePreview`/`handleCreate` now call the shared composer instead of independently rebuilding the REST config; "Preview schema" disabled until a Connector is selected for REST sources; UI no longer ever submits a bare-`url` create/preview request.
- `frontend/src/features/sources/ui/AddSourceModal.css` — new `.add-source-modal__endpoint-row`/`__endpoint-prefix` styles for the Connector-baseUrl-prefixed endpoint field.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — updated REST describe block to select a Connector before test/preview/create (retired-URL-path parity), added coverage for connector-required disabling, composed-request shape (`connectorId`/`endpoint`, never `url`), and the inline "create new Connector" round trip.
- `frontend/src/features/connectors/ui/CreateConnectorModal.tsx` — added optional `onCreated?: (connector: Connector) => void` prop (backwards-compatible), called just before `onClose()` on success; added `e.stopPropagation()` in `handleSubmit` (see Root cause below).
- `frontend/src/test/renderWithStore.tsx` — wired `connectorsReducer` into the test store (needed by `ConnectorSelectField`'s `fetchConnectors` thunk).
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — updated 4 stale baseline line numbers in `AddSourceModal.css` after the new endpoint-row CSS block shifted existing raw-spacing-literal lines by +18.

## Bugs found and fixed during live verification (systematic-debugging law)

### Bug 1 — nested `<form>` (invalid DOM, breaks submit semantics)

- **Root cause:** `Modal` renders inline (no portal) as a `<dialog>`; `ConnectorSelectField` (inside `AddSourceModal`'s own `<form id="add-source-configure-form">`) rendered `CreateConnectorModal` — which owns its own `<form id="create-connector-form">` — directly in the tree, producing a `<form>` nested inside a `<form>`.
- **Probe:** rendered the modal-over-modal flow in a Jest RTL test (`AddSourceModal.test.tsx`, "creates a Connector inline…") before any fix.
- **Probe output:** `console.error: Warning: validateDOMNesting(...): <form> cannot appear as a descendant of <form>.` plus a hydration-error warning, both from React DOM.
- **Fix:** `ConnectorSelectField` now renders `CreateConnectorModal` via `createPortal(..., document.body)` instead of inline.
- **Verification:** re-ran the same test — warning gone, 20/20 `AddSourceModal.test.tsx` tests pass.

### Bug 2 — portalled form submit still bubbles to the ancestor form's `onSubmit` (React tree, not DOM tree)

- **Root cause:** React's synthetic event system dispatches according to the **React component tree**, not the DOM tree — so even after portalling `CreateConnectorModal` to `document.body` (Bug 1's fix), its `<form>`'s submit event still bubbled, via React's tree-based delegation, up to the ancestor `AddSourceModal`'s `<form onSubmit={handlePreview}>`. `handlePreview` ran synchronously during that same click (before the async `createConnector` thunk resolved and set the Connector), saw `!restForm.connector` still true, and called `setError("A Connector is required.")`.
- **Probe:** live Playwright run against the real dev backend (`scripts/concertino/start-servers.sh`) exercising "create new Connector" from inside `AddSourceModal`, screenshotting immediately after Connector creation.
- **Probe output:** screenshot `hel827-fresh-connector-selected.png` (pre-fix) showed the Connector correctly selected in the picker **and** a spurious `"A Connector is required."` inline error below "Test connection" — appearing the instant the inner modal closed, before any outer-form action was taken.
- **Fix:** `CreateConnectorModal.handleSubmit` now calls `e.stopPropagation()` alongside its existing `e.preventDefault()`.
- **Verification:** re-ran the same live Playwright script post-fix — screenshot `hel827-fresh-connector-selected.png` (post-fix) shows the Connector selected with no stray error; `Test connection` → "✓ Connected"; "Preview schema" → real inferred fields from `jsonplaceholder.typicode.com/users/1`. Jest suite re-run clean (263/263 suites, 2879/2879 tests).

## Local dev environment note (not a code defect)

An older, cross-session `HEL-758 Eval REST Source` (already migrated to a `connectorId` row by `RestSourceConnectorMigration`, per Decision 4) returned `Internal server error` on Preview in this worktree — traced to its Connector's credential being encrypted under a **different** `CONNECTOR_MASTER_KEY_ID` (`local-dev-2026-08`) than the value this session generated fresh into `backend/.env` (`dev-local-1`), a shared-dev-Postgres artifact from a prior unrelated session, not something this ticket's UI-only change touches or causes. A **freshly created** Connector + REST source in this exact session (same `CONNECTOR_MASTER_KEY`) tests and previews cleanly end-to-end (see Bug 2's verification above), which is the retirement-verification evidence task 4 asks for. Flagging this for the evaluator/skeptic rather than silently working around it.
