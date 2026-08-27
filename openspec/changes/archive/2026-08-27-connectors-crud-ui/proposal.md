## Why

Connectors (host + credential) can be created via `/api/connectors` (HEL-821) but have no UI, and
their credential can never be replaced once set. Users need a page to manage saved credentialed
hosts, and a working rotation path, or an expired/leaked key becomes an unrecoverable dead end
(cannot update the secret, cannot delete a Connector with dependent sources).

## What Changes

- New `/connectors` page: list / create / edit (non-secret fields) / delete Connectors, driven by
  connector kind (REST first; page does not hardcode that assumption).
- Reusable credential-entry component (shown-once creation, and rotation reuse for HEL-829)
  mirroring `ApiTokensSection.tsx`'s shown-once-reveal pattern.
- New backend endpoint `PUT /api/connectors/:id/credential` (additive, no existing behavior
  changes) — write-only credential rotation, dedicated from the existing non-secret `PATCH`,
  going through `EncryptedSecretBackend` exactly as `create` does.
- List surfaces implicit/synthesized Connectors (HEL-822 dual-support) as visually distinguished,
  read-only-ish rows (rationale in design.md).
- Deletion surfaces the real dependent count/list on a blocked (409) delete, not a bare failure.
- Connection-test reuses the existing `TestConnectionAffordance`/`POST /api/sources/test`.
- Nav entry alongside Sources; page added to HEL-813's touch-target sweep at 430px/768px.

## Capabilities

### New Capabilities
- `connectors-page-ui`: the frontend Connectors page — list/create/edit/delete, credential entry
  and rotation UX, implicit-Connector presentation, dependent-blocked-delete UX, connection-test
  integration, nav + touch-target coverage.

### Modified Capabilities
- `connectors/connector-management`: adds a dedicated credential-rotation operation
  (`PUT /api/connectors/:id/credential`), write-only, encrypted via the existing
  `EncryptedSecretBackend` path, never returned by any read path.

## Impact

- Backend: new route + service method + repository method for credential rotation; no new table
  (reuses `connector_credentials` from HEL-536).
- Frontend: new route `/connectors`, new feature slice (`features/connectors/`), new nav entry,
  new reusable credential-entry component, new Playwright touch-target coverage for this page.
- No new RLS-protected table (reuses existing `connectors`/`connector_credentials` tables and
  their existing RLS policies) — `RlsPolicyGuardSpec` allowlist unaffected.
