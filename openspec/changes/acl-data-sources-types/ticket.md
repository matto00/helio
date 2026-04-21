# HEL-70: ACL: Enforce per-user isolation on Data Sources and Type Registry

## Problem

Data Sources and Data Types (Type Registry) are currently not access-controlled per user. Any authenticated user can read, use, or mutate data sources and data types created by other users. This was discovered during manual testing of HEL-68: the evaluator's NetflixCSV data source (and its type binding on a panel) was visible and accessible to a newly registered user.

## Scope

* `GET /api/data-sources` — should only return sources owned by the requesting user
* `GET/DELETE /api/data-sources/:id` — should 404 or 403 for resources not owned by the user
* `GET /api/data-sources/:id/sources` and `/preview` — same
* `GET/POST /api/data-types` — should scope to the requesting user's types
* `PATCH/DELETE /api/data-types/:id` — should enforce ownership

## Approach

Add an `owner_id` column to `data_sources` and `data_types` tables (Flyway migration). Filter all queries by the authenticated user's ID. Panels referencing a type owned by another user should be treated as unbound on read (or hard-blocked, TBD).

## Notes

* Panels already have `owner_id` — the pattern exists
* Auth middleware already resolves `user.id` on all protected routes — just needs to be threaded into repo queries
* Consider whether sharing data sources across users is a future requirement before designing the schema

## Acceptance Criteria

- `data_sources` table has an `owner_id` column populated on insert
- `data_types` table has an `owner_id` column populated on insert
- All data-source endpoints filter/enforce by the authenticated user's owner_id
- All data-type endpoints filter/enforce by the authenticated user's owner_id
- A user cannot read, modify, or delete another user's data sources or data types
- Existing panels with a cross-user type binding are treated as unbound on read (data type resolved as null/unbound)
- Backend tests cover ownership enforcement for both resources
