## Why

`HealthRoutes.scala` is the sole one of 48 route classes under `api/routes/` whose location does
not predict its contents: HEL-633 placed it in `api/routes/workspace/` for lack of a better home,
but `/health` mounts outside `pathPrefix("api")` and outside every auth directive, so it isn't
part of the workspace API surface. The owner has ruled (comment on HEL-811, 2026-09-22) to move it
to `api/routes/` root, mirroring `HealthResponse`'s existing root placement in `api/protocols/`
and the existing root-level exception for `ServiceResponse.scala`.

## What Changes

- `git mv` `HealthRoutes.scala` from `api/routes/workspace/` to `api/routes/` root.
- Update its `package` declaration from `com.helio.api.routes.workspace` to `com.helio.api.routes`.
- Add `import com.helio.api.routes.HealthRoutes` to `ApiRoutes.scala` (the existing
  `import com.helio.api.routes.workspace._` stays, still needed for `WorkspaceRoutes`).
- Update `api/routes/README.md` to document `HealthRoutes` as a second named-shared-file exception
  at root, alongside `ServiceResponse.scala`.
- Update `api/routes/workspace/README.md` to remove `HealthRoutes` from its "Holds" list.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — pure file/package relocation, zero behavioral or API-contract change; `skip_specs: true`
set in `.openspec.yaml`)

## Impact

- `backend/src/main/scala/com/helio/api/routes/workspace/HealthRoutes.scala` → moved to
  `backend/src/main/scala/com/helio/api/routes/HealthRoutes.scala`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — one new import line.
- `backend/src/main/scala/com/helio/api/routes/README.md` and
  `backend/src/main/scala/com/helio/api/routes/workspace/README.md` — documentation only.
- No test files change (verified in premise validation: `ApiRoutesSpec.scala` and
  `ApiRoutesCorsErrorHandlingSpec.scala` reference `/health` only via HTTP path string).

## Non-goals

- No change to `/health`'s behavior, response shape, or mount position in the route tree.
- No change to any other route class's placement (HEL-802, the sibling lane, handles `ai/`/`email/`
  separately).
