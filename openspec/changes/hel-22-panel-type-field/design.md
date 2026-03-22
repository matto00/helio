## Context

The `panels` table has no `type` column and the `Panel` domain model has no type field. Panel type is the foundational building block for HEL-23 (type selector in create flow) and HEL-24 (per-type rendering), which cannot proceed without it. The backend uses Slick with Flyway migrations; the frontend uses Redux + TypeScript.

## Goals / Non-Goals

**Goals:**
- Add `type` as a first-class field on panels end-to-end (DB → domain → API → frontend model)
- Keep the change non-breaking: existing panels and requests without `type` continue to work
- Lay the groundwork for HEL-23/24 without over-engineering for their requirements yet

**Non-Goals:**
- Type-specific rendering logic (HEL-24)
- Type selector UI in the create flow (HEL-23)
- Validation that a given type is meaningful for a given data binding

## Decisions

### D1: Represent `type` as a plain TEXT column with a Scala sealed trait

**Decision**: Store `type` as `TEXT NOT NULL DEFAULT 'metric'` in Postgres; map it to a `sealed trait PanelType` with four `case object` variants (`Metric`, `Chart`, `Text`, `Table`) in the domain model.

**Rationale**: A Postgres `ENUM` type requires `ALTER TYPE` to add new values and is harder to migrate. Plain `TEXT` with application-level validation is simpler, easier to extend, and consistent with how `appearance` and other string fields are handled in this codebase. The sealed trait enforces exhaustive matching in Scala without DB-level enum constraints.

**Alternative considered**: Postgres `ENUM` — rejected due to migration overhead when new types are added later.

### D2: `type` is optional on write requests, defaults to `metric`

**Decision**: `type` is omitted from required fields in `CreatePanelRequest` and `UpdatePanelRequest`. The backend defaults new panels to `Metric` when not supplied.

**Rationale**: Preserves backward compatibility with existing clients that don't send `type`. Matches the ticket's acceptance criteria ("Existing panels default to a sensible type without a migration breaking change").

### D3: Flyway migration adds column with default; no data backfill needed

**Decision**: `V3__panel_type.sql` adds `type TEXT NOT NULL DEFAULT 'metric'` to the `panels` table. Existing rows automatically get `metric`.

**Rationale**: The `DEFAULT` clause handles backfill atomically at migration time with no extra UPDATE statement needed. All existing panels becoming `metric` is the correct default.

### D4: Frontend carries `type` as a plain string union type

**Decision**: `Panel` interface in `models.ts` adds `type: PanelType` where `PanelType = 'metric' | 'chart' | 'text' | 'table'`. The service and slice carry it through unchanged.

**Rationale**: Mirrors the backend enum semantics while staying idiomatic TypeScript. Avoids introducing a separate enum object that would require conversion.

## Risks / Trade-offs

- **Unknown panel types from old data**: If the DB ever contains an unrecognised `type` string (e.g., from a manual INSERT), the Scala `read` will throw a deserialization error. Mitigation: the `JsonFormat[PanelType]` should produce a descriptive error, and `metric` is the safe fallback for migration-supplied defaults.
- **Slick table projection arity**: `PanelRow` gains a field, and the `*` projection in `PanelTable` must be updated. Forgetting this causes a compile error, which is caught at build time.

## Migration Plan

1. Deploy `V3__panel_type.sql` — Flyway runs automatically on startup; existing rows default to `metric`.
2. No rollback special-casing: dropping the column is a straightforward rollback migration if needed.
3. No coordinated frontend/backend deploy required — the frontend addition of `type` is additive.
