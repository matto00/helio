## Context

`ResourceMetaResponse(createdBy, createdAt, lastUpdated)` is shared by `PanelResponse` and `DashboardResponse`. `createdBy` is populated from `ResourceMeta.createdBy`, set to `user.id.value` on create, so it is an owner-id equivalent. `PublicDashboardRoutes` receives `userOpt` from `optionalAuthenticate`. The authenticated app itself also reads panels through this route, so the owner must keep their fields. Frontend search shows nothing reads `meta.createdBy` (only the `ResourceMeta` type and test fixtures); `ownerId` on panels is typed optional already.

## Goals / Non-Goals

**Goals:** no owner-id-equivalent value in any public-route response for a non-owner; owner view unchanged; a mutation-failable generic guard.
**Non-goals:** changing authenticated routes (`/api/dashboards`, `/api/outputs`, `/api/panels` CRUD) where the caller is authenticated and meta is expected; removing `createdBy` from the DB or domain model; rate-limiting or the HEL-837 gap.

## Decisions

1. **Who counts as anonymous.** The rule is "caller is not the panel's owner", not "caller is unauthenticated". An authenticated non-owner viewing via share link is equally a stranger to the owner's id. The route already has the facts: `userOpt` and `panel.ownerId`. HEL-1197's `userOpt.isDefined` is replaced by an "owner view" decision: `access == ResourceAccess.Owner` (the dashboard-owner access the `authorizeResourceWithSharing` block already resolves, currently bound to `_`) OR `userOpt.exists(_.id.value == panel.ownerId.value)` (the panel's own creator). So the dashboard owner still sees `ownerId`/`createdBy` on a grantee-created panel, and a panel's creator sees their own. Consequence, stated explicitly: an Editor/Viewer grantee who is neither dashboard owner nor the panel's creator no longer receives `ownerId`/`createdBy` for other users' panels; the frontend does not read them there (verified by grep). A test pins a grantee-created panel viewed by the dashboard owner (present) and by another grantee (absent).
2. **Wire shape.** `ResourceMetaResponse.createdBy: Option[String]`; spray-json's `jsonFormat3` omits `None` fields, so the key is absent (not `null`), matching the existing `ownerId` handling. `fromDomain(meta, includeCreatedBy: Boolean = true)` defaults true so every non-public call site (dashboards, outputs, authenticated panel routes) is byte-identical. Alternative rejected: replacing the value with a placeholder string — a field still present under the same name invites the frontend to render it and hides the omission from tests.
2a. **Contract files.** `schemas/shared/resource-meta.schema.json` drops `createdBy` from `required` (still a documented optional string; description: omitted for non-owner callers of the public panel list); `npm run check:schemas` is part of verification. `openspec/specs/resource-metadata/spec.md` gets a MODIFIED delta carving out the non-owner public case. `helio-mcp/src/types.ts` `ResourceMeta.createdBy` is made optional and helio-mcp type-checked (it authenticates as a PAT user; whether or not it hits the panel list route, the type must not lie).
3. **Single decision point.** `PanelResponse.fromDomain`'s `includeOwnerId` flag is reused for both `ownerId` and `meta.createdBy` (renamed param semantics documented: "owner-identifying fields") so the two cannot drift apart.
4. **Audit method.** Enumerate public routes from `ApiRoutes` (everything under `optionalAuthenticate`, `/health`, auth-less routes) and from each route class; for each, read the response type, and assert via test. Dashboard and Output `ResourceMeta` are only emitted on authenticated routes (no public dashboard-by-id route exists; outputs are reached publicly only through `output-meta`/`provenance`, which are allow-listed DTOs). The audit's finding per route is recorded in the PR; any further leak found gets fixed here.
5. **Generic guard.** A test helper `assertNoOwnerId(json, ownerId)` recursively walks `JsValue` (objects' keys AND values, arrays) and fails on any string key or value CONTAINING the owner id (contains, not equals). The guard fixture uses ONE distinctive id for panel.ownerId, dashboard owner, output owner, pipeline owner and the share-token creator. Image-upload fetch and connector-completion are exercised with real fixtures if they can carry owner-bearing data, otherwise explicitly recorded in the audit table as "no owner-bearing data, not exercised". Error bodies (404/403) of public routes are walked too. It is exercised against every public route in one test with a distinctive owner id. Mutation proof is recorded as real red then green sbt output saved as evidence (`persist-evidence.sh`), not merely stated: temporarily restore `includeOwnerId = true` / `createdBy` population and show the guard turns red; also a unit test that the helper itself flags a hand-built JSON containing the id under an arbitrary key name.
6. **Red first.** Tests are written and run on unchanged main code first, showing failures where the id appears, then the fix.

## Risks / Trade-offs

- Grantee viewers lose `ownerId`/`createdBy` on this route. Mitigation: grep-verified unused; owner path regression test.
- Guard is only as good as the fixtures: it must create panels bound to outputs/pipelines owned by a distinctive id so provenance/output-meta have owner-bearing data to leak.

## Audit Results (route-by-route)

Enumerated from `ApiRoutes.scala` (`health.routes`, `pathPrefix("auth")`, `optionalAuthenticate` branch) and each route class.

| Route | Fields examined | Removed |
|---|---|---|
| `GET /health` | `status` only | none |
| `GET /api/dashboards/:id/panels` | `ownerId`, `meta.createdBy` (creator id), `meta.createdAt/lastUpdated`, `config`, `appearance`, `dataAsOf` | `ownerId` (HEL-1197, now also for authed non-owners) and `meta.createdBy`, for any caller who is not the dashboard owner or the panel's creator |
| `GET .../panels/:pid/rows` | row JSON (user data), paging | none (no owner-bearing field; guard-walked) |
| `GET .../panels/:pid/filter-capabilities` | column contract | none (guard-walked) |
| `GET .../panels/:pid/distinct-values` | value/count pairs | none (guard-walked) |
| `GET .../panels/:pid/output-meta` | `kind`, `config`, `schema` (allow-listed DTO, HEL-1197 removed `ownerId`) | none further |
| `GET .../panels/:pid/provenance` | allow-listed DTO: pipeline name, source name/kind, nodePath, lastRun, assertion counts | none further (HEL-1206) |
| Error bodies (404/403/400) of all the above | `ErrorResponse(message)` | none (guard-walked incl. 403 stranger, 404 wrong token / missing dashboard / missing panel, 400 bad column / offset) |
| `GET /api/uploads/image/:id` (`PublicUploadRoutes`) | raw image bytes with MIME; 404 `ErrorResponse("Not found")` | none; no owner-bearing data, not exercised in the guard |
| `GET/POST /api/connectors/completion` (`ConnectorCompletionRoutes`) | 204 / `PendingConnectorAuthShapeResponse(authType, apiKeyName, apiKeyPlacement)` / fixed refusal message | none; no owner-bearing data (ownership is checked, never echoed), not exercised in the guard |
| `/api/auth/*` | caller's OWN session/user (no third-party owner id) | out of scope (not an owner-vs-anonymous surface) |
| Dashboard / Output `ResourceMeta` | only emitted on authenticated routes (no public dashboard-by-id route) | unchanged |

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or gate-chain script is touched.
