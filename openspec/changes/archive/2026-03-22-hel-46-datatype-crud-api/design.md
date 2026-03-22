## Context

`DataTypeRepository` and `DataSourceRepository` exist (HEL-42) but have no REST surface. `ApiRoutes.scala` currently handles only dashboard and panel routes. `Panel` domain model has no `typeId` field. The existing `PATCH /api/panels/:id` handler only knows about `title`, `appearance`, and `type`.

This change adds routes directly to `ApiRoutes`, following the same pattern as the existing dashboard/panel handlers: request case class → validation → repository call → response case class.

## Goals / Non-Goals

**Goals:**
- Expose TypeRegistry over REST (`/api/types`, `/api/data-sources`)
- Let panels declare a DataType binding (`typeId`, `fieldMapping`)
- Guard DataType deletion when panels are bound (409)
- Flyway migration for new panel columns

**Non-Goals:**
- Data source create/update/delete routes (HEL-44/45 handle connectors)
- Frontend UI for binding (HEL-49)
- Actual data fetching or live query execution
- Auth or multi-tenancy

## Decisions

### 1. Route prefix `/api/types` (not `/api/data-types`)

Shorter, consistent with how the frontend ticket (HEL-49) refers to "types". `/api/data-types` would also work but adds verbosity without clarity.

### 2. `isBoundToAnyPanel` as a `DataTypeRepository` method backed by a raw count query

Checking for bound panels before delete requires joining across repositories. Options:
- A: `PanelRepository.countByTypeId(id)` — clean but adds coupling to the panel repo
- B: `DataTypeRepository.isBoundToAnyPanel(id)` using a raw `sqlu` count against `panels.type_id` — self-contained, no cross-repo dependency at the call site in `ApiRoutes`

Chose B to keep the delete guard local to the types handler.

### 3. `fieldMapping` stored as `TEXT` (JSON serialised), not native JSONB

Matches the pattern used for `config` in `data_sources` and `appearance`/`layout` in `dashboards` — Slick maps all JSON blobs as `TEXT` and deserialises in the repository layer. Avoids a native JSONB column type in Slick (which requires extra setup).

### 4. `Panel` domain model gains `typeId: Option[DataTypeId]` and `fieldMapping: Option[JsValue]`

These are nullable — panels without a binding simply have `None`. The existing `PanelResponse` gets two optional fields. `UpdatePanelRequest` gains `typeId: Option[Option[String]]` (outer Option = field absent, inner Option = explicit null to unbind) and `fieldMapping: Option[Option[JsValue]]` for the same reason.

### 5. `PATCH /api/types/:id` replaces the full `fields` vector and updates `name`

The ticket confirmed full update (not just display name overrides). The existing `DataTypeRepository.update` already handles this and increments version. No partial-field-update needed.

## Risks / Trade-offs

- **409 race condition** — between the `isBoundToAnyPanel` check and the delete, a panel could bind to the type. Mitigation: acceptable for now; a DB-level FK constraint with `RESTRICT` would be the production fix (out of scope).
- **`Option[Option[String]]` for nullable patch fields** — awkward Scala type but necessary to distinguish "field not sent" from "field sent as null". Spray JSON handles this via a custom reader.

## Migration Plan

V5 migration adds two nullable columns to `panels` with no default — existing rows get `NULL` in both, which is correct (no binding). No data backfill needed. Rollback: drop the two columns.
