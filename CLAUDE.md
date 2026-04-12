# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (run from `frontend/` or root)

```bash
npm run dev          # Start Vite dev server (proxies /api and /health to localhost:8080)
npm run build        # Production build
npm test             # Run Jest tests
npm run lint         # ESLint (zero-warnings policy)
npm run lint:fix     # Auto-fix lint issues
npm run format       # Format with Prettier
npm run format:check # Check formatting without modifying
```

Run a single test file:

```bash
npm test -- --testPathPattern=dashboardsSlice
```

### Backend (run from `backend/`)

```bash
sbt run    # Start Akka HTTP server on port 8080
sbt test   # Run ScalaTest suite
```

The backend loads a `.env` file for environment variables (including `AKKA_LICENSE_KEY`).

### Pre-commit hooks

Husky runs ESLint, Prettier, and Jest automatically on commit. Fix all issues before committing.

## Architecture

Helio is a dashboard builder with a React/Redux frontend and a Scala/Akka backend.

### Request Flow

```
React Component → Redux Thunk (createAsyncThunk) → Service Layer (axios)
  → Vite proxy → Akka HTTP Routes → Repository Layer (Slick) → PostgreSQL
```

### Backend (Scala/Akka)

- **PostgreSQL** is the persistence layer, managed by **Flyway** (migrations in `backend/src/main/resources/db/migration/`). **Slick** is the database access layer with HikariCP connection pooling.
- **`ApiRoutes.scala`** defines all REST routes and composes the sub-routers. Inputs are normalized by `RequestValidation` before reaching repositories.
- **`JsonProtocols.scala`** provides Spray JSON implicit formatters for all request/response types.
- Domain models use value-class ID wrappers (`DashboardId`, `PanelId`, `DataTypeId`, `DataSourceId`) and immutable case classes with `ResourceMeta` for timestamps.
- **`DemoData`** seeds initial data on startup for development convenience; production data persists across restarts.

### Frontend (React/Redux/TypeScript)

- Feature state lives in Redux slices (`dashboardsSlice`, `panelsSlice`) with `createAsyncThunk` for all API calls.
- `markDashboardPanelsStale` invalidates the panel cache when a new panel is created so the next dashboard switch refetches.
- `PanelGrid` uses React Grid Layout with four responsive breakpoints (lg/md/sm/xs). Layout changes are debounced 250ms before persisting to the backend. `noCompactor` is set to prevent automatic layout compression.
- Theme (light/dark) is managed via React Context (`ThemeProvider`), not Redux.

### API Contract

Schemas in `schemas/` (JSON Schema 2020-12) and specs in `openspec/` (OpenAPI) define the contract between frontend and backend. These are the source of truth for request/response shapes.

Key endpoints:

- `GET/POST /api/dashboards`
- `PATCH /api/dashboards/:id` — updates appearance and/or layout
- `POST /api/dashboards/:id/duplicate`
- `GET /api/dashboards/:id/export` / `POST /api/dashboards/import`
- `GET /api/dashboards/:id/panels`
- `POST /api/panels` — requires `dashboardId` in body
- `PATCH /api/panels/:id` — updates appearance
- `POST /api/panels/:id/duplicate`
- `GET/POST /api/data-types`
- `PATCH/DELETE /api/data-types/:id`
- `GET/POST /api/data-sources`
- `GET/DELETE /api/data-sources/:id`
- `GET /api/data-sources/:id/sources`
- `GET /health`

### Git conventions

Commit messages are prefixed with the Linear ticket: `HEL-N Description`.

Branch naming: `[feature|task|bug]/[3-5-word-description]/[ticket-id]`

## Slash Commands

Available commands in `.claude/commands/`:

- `/linear-ticket-delivery` — Full end-to-end workflow for working a Linear ticket (branching → proposal → implementation → verification → archive → PR)
- `/linear-create-ticket` — Create one or more well-scoped Linear tickets from a free-form description
- `/opsx-propose` — Create an OpenSpec change with all artifacts (proposal, design, tasks) in one step
- `/opsx-explore` — Enter explore/discovery mode: think through problems and investigate the codebase without implementing
- `/opsx-apply` — Implement tasks from an active OpenSpec change
- `/opsx-archive` — Archive a completed OpenSpec change (with optional spec sync)

**When to use `/linear-ticket-delivery`**: Any time the user references a Linear ticket (e.g. `HEL-5`) or asks to work on a Helio issue end-to-end. This workflow is mandatory for ticket-driven work.

## Development Rules

### Behavior

- Ask clarifying questions before making large assumptions about architecture or requirements.
- Optimize for performance by default in both frontend and backend code paths.
- Keep code modular and reusable; prefer small composable units.
- Keep changes focused on the requested task; avoid unrelated refactors unless requested.
- Keep schema updates in the same change as related client/server code.

### Frontend

- Use Redux for shared application state; keep components primarily presentational.
- Move reusable behavior into hooks/selectors/utilities.
- Prefer typed APIs; avoid `any` without clear justification.

### Backend

- Keep Akka protocols explicit and actor boundaries clear.
- Avoid blocking operations in actor execution paths.
- Separate domain logic from infrastructure integrations.

### Verification before committing

- Respect pre-commit policy: lint, format, and tests are expected to pass.
- If a bypass is used (`git commit -n`), call it out explicitly and follow with a fix commit.
