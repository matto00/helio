## Why

`POST /api/pipelines/:id/roots` and `DELETE /api/pipelines/:id/roots/:rootId` authorize owner-or-editor in the
service, then write on the RLS-enforcing user-context connection, where `pipeline_roots` (and `pipeline_steps`)
INSERT/DELETE policies are owner-only (V98 §11, V35). On a non-BYPASSRLS role an editor's root add fails as a 500
and an editor's root remove deletes nothing yet answers 200. Local dev/CI run as a superuser, so both stayed hidden
until HEL-1629's NOBYPASSRLS gate found them.

## What Changes

- Rule (delegated by the ticket, newly effective in prod): **editors may add and remove roots**, matching the
  service's "Editor or Owner" contract, editors' existing step writes, and HEL-1629's editor draft save. Viewers are
  refused (403), strangers get the unknown-id 404. The PR body lists the consequences so the owner can overturn it.
- The two `DraftSaveRlsSpec` tests that pin today's editor 500/no-op are replaced.
- Root add and root remove run their writes on the privileged connection after the service-level owner-or-editor
  check, the same pattern step writes already use; the owner-only RLS write policies stay as the backstop for any
  user-context writer.
- Root remove reports success only when the root row was actually deleted (no false 200).
- Red-first NOBYPASSRLS API tests for editor add/remove, viewer and stranger refusal.

## Capabilities

### New Capabilities
- `pipeline-root-write-access`: who may add/remove a pipeline's roots, and the responses each caller role gets.

### Modified Capabilities
- (none)

## Impact

- Backend: `PipelineRootWrites`, `PipelineRootRepository`, the root-remove transaction; no API shape change; a grant migration only if
  the D6 check shows `helio_privileged` lacks a needed privilege. Tests: `TwoUserRlsApiFixture`-based route spec.

## Non-goals

- Changing who may attach which data source (an editor still attaches only a source they own, as today).
- Changing the `pipeline_roots` / `pipeline_steps` RLS policies.
- Frontend changes beyond confirming the editor draft flow (HEL-1631) works.
