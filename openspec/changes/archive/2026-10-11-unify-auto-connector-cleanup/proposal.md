## Why

HEL-1475, HEL-1493 and HEL-1497 left two rules for deleting an auto-created ("Auto") Connector. HEL-1475's `deleteIfAuto` matches the exact name `Auto: <source name>` and logs `ex.getMessage`. HEL-1497's `deleteIfUnadoptedImplicit` checks the implicit flag, the `Auto: ` prefix and the real dependents count, and logs ids only. In production `InlineSourceCleanup` calls `deleteIfAuto` after `DataSourceService.delete` has already applied the HEL-1497 rule, so there it is a redundant no-op. Where it is the only guard, its exact-name rule disagrees with the owner's HEL-1497 ruling: a renamed source blocks cleanup.

Separately, `ConnectorRepository.delete` removes the Connector row and its encrypted credential row in two transactions, which can orphan a credential. The Connectors list goes stale after a patch-set undo removes a bare-url REST source. And `CsvUploadLimitsRoutesSpec`'s pdf-over-cap test flakes on a client-write/server-close race (Broken pipe).

## What Changes

- Delete `ImplicitConnectorCleanup.deleteIfAuto`. `SourceService.createRest`'s insert-failure cleanup and both `InlineSourceCleanup` paths call `deleteIfUnadoptedImplicit` instead: one rule, owner-scoped, idempotent once `DataSourceService.delete` has already removed the Connector.
- Make every failure log line in `InlineSourceCleanup.scala` log-safe: ids, context, exception class and SQLSTATE; never `ex.getMessage`.
- `ConnectorRepository.delete`: delete the connector row (owner-scoped in the statement itself) and its credential row in ONE `withUserContext` transaction, via `ConnectorCredentialRepository.deleteAction`.
- Frontend: `connectorsSlice` resets to `idle` when a patch-set undo reports a removed inline source.
- Tests: a deterministic fix and repro for the CSV/pdf 413 Broken-pipe flake; a combined-wiring undo spec; unified-rule, log-safety, atomicity and cross-tenant specs, each red-first or mutation-proven.
- Out of scope: the `DataSourceService.scala` split (HEL-1505 item 3, stays on the ticket). No migration.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `connectors/connector-management`: Connector delete is atomic with its credential.
- `inline-source-create-atomicity`: compensation and create-failure cleanup use the single HEL-1497 auto-created rule and log ids only.
- `connectors-page-ui`: the Connectors list refreshes after an undo that removed an inline source.

## Impact

Backend: `InlineSourceCleanup.scala`, `SourceService.scala`, `ConnectorRepository.scala`; test specs. Frontend: `connectorsSlice.ts` (+ test). There are no API, schema or migration changes.
