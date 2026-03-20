# Helio

A customizable dashboard builder with a React/Redux/TypeScript frontend and a Scala/Akka HTTP backend.

## Features

- Create, rename, and delete dashboards
- Create, rename, duplicate, and delete panels within dashboards
- Drag-and-drop panel layout with four responsive breakpoints (lg/md/sm/xs)
- Customize dashboard and panel appearance (background color, transparency, text color)
- Persistent layouts and appearance settings backed by PostgreSQL
- Light and dark theme

## Tech Stack

| Layer            | Technology                                               |
| ---------------- | -------------------------------------------------------- |
| Frontend         | React 18, TypeScript, Redux Toolkit, React Grid Layout   |
| Backend          | Scala 2.13, Akka HTTP, Slick, PostgreSQL                 |
| API contracts    | JSON Schema 2020-12                                      |
| Frontend tooling | Vite, ESLint, Prettier, Jest                             |
| Backend testing  | ScalaTest, embedded PostgreSQL (via `embedded-postgres`) |

## Project Structure

```
helio/
├── frontend/          # React/Redux/TypeScript app
│   └── src/
│       ├── components/    # UI components (DashboardList, PanelGrid, ...)
│       ├── features/      # Redux slices (dashboards, panels)
│       ├── services/      # Axios service layer
│       ├── store/         # Redux store
│       ├── theme/         # ThemeProvider + appearance helpers
│       └── types/         # Shared TypeScript model types
├── backend/           # Scala/Akka HTTP server
│   └── src/main/scala/com/helio/
│       ├── api/           # Routes, request validation, JSON protocols
│       ├── domain/        # Domain models and value types
│       ├── infrastructure/ # Slick repositories and DB wiring
│       └── app/           # Server entry point
├── schemas/           # JSON Schema definitions for API payloads
└── openspec/          # API specs and change history
```

## Getting Started

### Prerequisites

- Node.js 18+
- JDK 21
- sbt 1.x
- PostgreSQL (or Docker)

### Backend

Create a `.env` file in `backend/` with your database connection and Akka license:

```env
DB_URL=jdbc:postgresql://localhost:5432/helio
DB_USER=helio
DB_PASSWORD=secret
AKKA_LICENSE_KEY=<your-key>
```

Then start the server on port 8080:

```bash
cd backend
sbt run
```

### Frontend

```bash
npm install
npm run dev
```

The Vite dev server starts on port 5173 and proxies `/api` and `/health` to `localhost:8080`.

## Development Commands

### Frontend (from `frontend/` or repo root)

```bash
npm run dev           # Start dev server
npm run build         # Production build
npm test              # Run Jest tests
npm run lint          # ESLint (zero-warnings policy)
npm run lint:fix      # Auto-fix lint issues
npm run format        # Format with Prettier
npm run format:check  # Check formatting without modifying
```

### Backend (from `backend/`)

```bash
sbt run   # Start server
sbt test  # Run ScalaTest suite
```

## API Overview

| Method   | Path                         | Description                             |
| -------- | ---------------------------- | --------------------------------------- |
| `GET`    | `/api/dashboards`            | List all dashboards                     |
| `POST`   | `/api/dashboards`            | Create a dashboard                      |
| `PATCH`  | `/api/dashboards/:id`        | Update name, appearance, or layout      |
| `DELETE` | `/api/dashboards/:id`        | Delete a dashboard (cascades to panels) |
| `GET`    | `/api/dashboards/:id/panels` | List panels for a dashboard             |
| `POST`   | `/api/panels`                | Create a panel                          |
| `PATCH`  | `/api/panels/:id`            | Update title or appearance              |
| `POST`   | `/api/panels/:id/duplicate`  | Duplicate a panel                       |
| `DELETE` | `/api/panels/:id`            | Delete a panel                          |

Request and response shapes are defined in `schemas/` and documented in `openspec/specs/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
