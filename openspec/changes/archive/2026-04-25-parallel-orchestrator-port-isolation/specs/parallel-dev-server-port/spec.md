## ADDED Requirements

### Requirement: Dev server binds to PORT env var
The Vite dev server SHALL read the `PORT` environment variable and bind to that port. When `PORT` is
not set, the server SHALL default to port 5173. The server SHALL use `strictPort: true` so that a
port-in-use condition produces an immediate error rather than silently rebinding.

#### Scenario: Default port used when PORT unset
- **WHEN** `npm run dev` is invoked without a `PORT` environment variable
- **THEN** the dev server starts on port 5173

#### Scenario: Custom port used when PORT is set
- **WHEN** `PORT=5200 npm run dev` is invoked
- **THEN** the dev server starts on port 5200

#### Scenario: Port conflict fails immediately
- **WHEN** `PORT=5173 npm run dev` is invoked and port 5173 is already occupied
- **THEN** the process exits with a clear EADDRINUSE error (does not silently rebind)

### Requirement: Evaluator uses DEV_PORT for Playwright
The linear-evaluator agent SHALL read a `DEV_PORT` environment variable (defaulting to 5173) when
starting the Vite dev server in Phase 3 and when constructing the Playwright base URL. The evaluator
SHALL pass `PORT=$DEV_PORT` to the dev server start command.

#### Scenario: Evaluator default port
- **WHEN** the evaluator runs Phase 3 without `DEV_PORT` set
- **THEN** it starts the dev server on port 5173 and navigates Playwright to `http://localhost:5173`

#### Scenario: Evaluator custom port
- **WHEN** the evaluator runs Phase 3 with `DEV_PORT=5228`
- **THEN** it starts the dev server with `PORT=5228` and Playwright navigates to `http://localhost:5228`
