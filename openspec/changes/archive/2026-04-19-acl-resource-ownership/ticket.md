# HEL-35: ACL model: resource ownership

## Summary

Link dashboards and panels to an owning user and enforce ownership-based access control.

## Scope

- Add `owner_id` (FK → users) to `dashboards` and `panels` tables via Flyway migration
- API: users can only read/write their own resources (unless shared — see sharing ticket)
- `GET /api/dashboards` returns only the calling user's dashboards
- Accessing another user's resource returns `403 Forbidden`
- Demo data updated to assign ownership to the seeded system user

## Acceptance criteria

- A user cannot read, update, or delete another user's dashboard or panel
- Ownership is set automatically on resource creation
- Existing resources without an owner are assigned to the system user during migration
