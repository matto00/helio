# HEL-811: Decide HealthRoutes placement: api/routes/workspace/ vs api/routes/ root

## Description

Recorded dissent from HEL-633's final gate. Zero behavioural consequence — this is purely about
whether the tree's structure predicts its contents, which is HEL-632's whole premise. One file,
cheap to change either way.

`HealthRoutes.scala` serves `GET /health` and has no natural domain. HEL-633 placed it at
`api/routes/workspace/`, documented honestly in that directory's README. The final-gate skeptic
independently preferred `api/routes/` root but did not require the move, so it was left as-is.

Case for `api/routes/` root:
1. `/health` mounts outside `pathPrefix("api")` and outside every auth directive.
2. `HealthResponse` already stays at `api/protocols/` root — root <-> root symmetry.
3. `api/routes/` root already holds a domain-agnostic shared file (`ServiceResponse.scala`).
4. It is the sole one of 48 route classes whose name does not predict its directory.

Case for leaving it in `workspace/`:
1. `api/routes/README.md` carries a counter-invariant about what lives at root.
2. The placement is documented rather than silent.
3. `workspace` is already the home for cross-domain, workspace-wide concerns.

## Owner Ruling (2026-09-22, recorded as a comment on HEL-811)

Move `HealthRoutes.scala` to the `api/routes/` root. Do not re-litigate the choice — implement it.
Update BOTH `api/routes/README.md` and `api/routes/workspace/README.md` so they agree with the new
placement, and add `HealthRoutes` to the named-shared-files list that `api/routes/README.md`
carries.

## Acceptance Criteria

- `HealthRoutes.scala` moved via `git mv` from `backend/src/main/scala/com/helio/api/routes/workspace/`
  to `backend/src/main/scala/com/helio/api/routes/`.
- Its `package` declaration updated from `com.helio.api.routes.workspace` to `com.helio.api.routes`.
- `ApiRoutes.scala` updated to import the new location (adds `import com.helio.api.routes.HealthRoutes`;
  the existing `import com.helio.api.routes.workspace._` stays, still needed for `WorkspaceRoutes`).
- `api/routes/README.md` updated: documents `HealthRoutes` as a second named-shared-file exception at
  root (alongside `ServiceResponse.scala`), with rationale.
- `api/routes/workspace/README.md` updated: no longer lists `HealthRoutes` as held there.
- HEL-632's iron constraint: `git mv` + package declaration + imports + READMEs ONLY. No logic or
  signature changes. Test suite untouched apart from any package/import line (premise validation
  found none needed — tests reference `/health` only by HTTP path, never the class/package).
- Full backend test suite passes unchanged (`sbt test`).
