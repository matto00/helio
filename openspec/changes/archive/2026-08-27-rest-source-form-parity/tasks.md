## 1. Client wire type + shared config composer

- [x] 1.1 Extend `RestApiConfigBody` (`dataSourceService.ts`) with `endpoint?: string`,
      `queryParams?: Record<string, string>`, `parameters?: Record<string, string>` (the fields the
      backend already accepts but the client type does not yet declare — design.md Context).
- [x] 1.2 Introduce a `useRestSourceForm` hook (`frontend/src/features/sources/hooks/`) owning all
      REST field state (url/endpoint/connectorId/method/queryParams/headers/body/bodyContentType/
      rootSelector/parameters) plus a `buildRestSourceConfig()` composer (design.md Decision 1a),
      converting the ordered key/value list state to `Map`/`Record` only inside the composer.
- [x] 1.3 Replace the three independent config-building blocks — `RestApiForm.buildConfig()`,
      `AddSourceModal.handlePreview` (`:110-144`), `AddSourceModal.handleSubmit`/`handleCreate`
      (`:148-170`) — with calls to the shared composer, so test/preview/create all emit the same,
      current shape.

## 2. Connector selection

- [x] 2.1 Build `ConnectorSelectField.tsx` (shared primitive, DESIGN.md tokens) listing Connectors
      via `connectorsSlice`/`fetchConnectors`, with a "Create new Connector" option. Disable
      save/test until a Connector is selected.
- [x] 2.2 Add an optional `onCreated?: (connector: Connector) => void` prop to `CreateConnectorModal`,
      called just before `onClose()` on successful creation (backwards-compatible — `ConnectorsPage`'s
      existing usage is unaffected). Wire the picker's "create new" flow to select the returned
      Connector.
- [x] 2.3 Handle the modal-over-modal stack (`CreateConnectorModal` launched from within
      `AddSourceModal`) per DESIGN.md: inner modal traps focus, closing it returns focus to the
      picker control; verify no REST field state is lost across the round trip (state lives in
      `useRestSourceForm`, unaffected by the child modal mounting/unmounting).
- [x] 2.4 Show the selected Connector's name/kind plus a note that its credential is applied
      (explains the absent auth field per acceptance criterion 2).

## 3. Endpoint, query params, headers, template parameters

- [x] 3.1 Replace the "URL" input with an "Endpoint path" input once a Connector is selected,
      showing the Connector's `baseUrl` as a read-only prefix (design.md Context); the bare-`url`
      input is removed from the UI entirely, not merely relabeled.
- [x] 3.2 Build `KeyValueListField.tsx` (shared, ordered `{key,value}[]`) for query params and
      headers; flag (non-blocking) duplicate keys entered in the UI.
- [x] 3.3 Build `TemplateParametersField.tsx`: detect `{{name}}` placeholders across endpoint,
      queryParams values, headers values, and body; render one value input per detected name,
      populating `parameters`.
- [x] 3.4 Wire all of the above into `RestApiForm.tsx`, sourced from `useRestSourceForm` (design.md
      Decision 5), splitting the file rather than growing it inline.

## 4. Retirement verification (no orphaned sources)

- [x] 4.1 Against the dev DB, confirm at least one pre-existing legacy-created source (owned,
      well-formed) has already been converted to a `connectorId` row by `RestSourceConnectorMigration`
      (boot-time, unchanged by this ticket).
- [x] 4.2 Confirm that source's schema preview succeeds and a pipeline run against it still succeeds
      after this change ships — proves retirement of the UI *create* path did not orphan it. (No REST
      source edit form exists to verify this via editing — `RestApiForm` is create-only.)

## 5. Verification gates

- [x] 5.1 `npm run lint`, `npm run typecheck`, `npm test` in `frontend/`.
- [x] 5.2 Manual/Playwright UI check at all four DESIGN.md breakpoints (430/768/1100/1440px),
      touch-target check at 430/768px, using freshly-restarted dev servers (HEL-742 stale-cache gotcha).
- [x] 5.3 Confirm `sbt test` backend suite is unaffected (no backend files touched) and CI's
      `backend` job stays green; if `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` are absent
      locally, account for the resulting `NoKeyConfigured` count explicitly rather than treating it
      as expected-boilerplate noise.
