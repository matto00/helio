## Context

The current backend exposes read-only routes backed by in-memory Akka Typed registry actors. Dashboard and panel resources already have domain models, JSON response DTOs, route tests for reads, and resource-level JSON schema files, but there are no write endpoints or request contracts. This ticket adds the first server-side creation flow, so the design needs to keep the transport layer explicit, preserve modular actor boundaries, and avoid mixing request validation with route wiring.

## Goals / Non-Goals

**Goals:**
- Add `POST /api/dashboards` and `POST /api/panels` as explicit write endpoints.
- Introduce request-specific JSON schemas for create payloads.
- Normalize blank or missing dashboard names and panel titles to a server-side default.
- Return `404 Not Found` when creating a panel for a dashboard that does not exist.
- Extend route tests to cover success and invalid input behavior.

**Non-Goals:**
- Persistence or database-backed validation.
- Authentication, authorization, or rate limiting.
- Frontend integration changes.
- Full endpoint-by-endpoint response schema expansion beyond what this ticket needs.

## Decisions

### Use top-level create routes for each entity
The API will expose `POST /api/dashboards` and `POST /api/panels`. This keeps route structure aligned with entity ownership in the current API surface and avoids nesting create semantics before relationships become more complex.

Alternative considered:
- Nested panel creation under `/api/dashboards/{id}/panels` was rejected for now because the ticket explicitly models panels as an entity endpoint and the request payload already carries `dashboardId`.

### Add separate request contract schemas
The existing `dashboard.schema.json` and `panel.schema.json` remain resource-level contracts. New request schemas will be added for create operations so POST payloads can evolve independently from full resource representations.

Alternative considered:
- Reusing resource schemas for create requests was rejected because create payloads omit generated identifiers and use different validation/defaulting behavior.

### Keep validation and defaulting at the API boundary
Request DTO parsing will determine whether a field is missing, blank, or invalid. Missing required relational data such as `dashboardId` will return `400 Bad Request`, while blank or missing `name`/`title` values will normalize to a default string before actor interaction.

Alternative considered:
- Pushing all normalization into actors was rejected because request-shape validation belongs at the transport boundary and should remain easy to test from routes.

### Validate dashboard existence before panel creation
Panel creation will confirm that the referenced dashboard exists before registering the panel. Missing dashboard references will return `404 Not Found` rather than failing later or accepting orphaned panels.

Alternative considered:
- Allowing orphaned panels in memory was rejected because it weakens the resource contract and complicates future persistence.

## Risks / Trade-offs

- [Route validation grows in complexity] → Keep DTO parsing small and isolate request normalization helpers.
- [In-memory existence checks may become implementation debt] → Preserve the validation flow behind actor interactions so persistence can replace it later.
- [Request and resource schemas can drift] → Update request schemas and backend route behavior in the same change, with route tests aligned to the contract decisions.
