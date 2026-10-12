# HEL-1505: After HEL-1497: CsvUploadLimitsRoutesSpec Broken-pipe flake; remove redundant exact-name Connector cleanup; split DataSourceService; connector/credential delete atomicity

## Description

Follow-ups from HEL-1497 (matto00/helio#955, 16736deb2), which deletes the unadopted implicit Auto Connector and its credential when its source is deleted. This run delivers a REDUCED scope chosen by the driver: items 1, 2+5, 4, 6 and 7. Item 3, the `DataSourceService` split, is OUT of scope and stays on the ticket.

1. **CI flake:** `CsvUploadLimitsRoutesSpec`, "pdf upload over the largest non-CSV cap", fails with `StreamTcpException: Broken pipe`. This is a race between the client still writing and the server closing with 413 (backend (2), head f2b9b0a29; it passed on rerun). Make the test tolerate the early close, or assert the 413 deterministically, and prove it deterministically rather than by re-runs.
2. **Redundant exact-name Connector step (HEL-1493, #954, merged):** `InlineSourceCleanup`'s exact-name Connector step (`ImplicitConnectorCleanup.deleteIfAuto`) is redundant and logs `ex.getMessage`. Remove it, or route it through `ImplicitConnectorCleanup`.
3. *(OUT of this run)* Split `DataSourceService.scala` (1434 lines), behaviour-preserving.
4. **Atomicity:** the Connector row and its credential row are deleted in separate statements, so a failure between them can orphan the credential. Make it one transaction.
5. *(from the ticket comment, via the driver)* Unify the two auto-created ("Auto") Connector rules. `deleteIfAuto` (exact name, used by HEL-1475's create/rollback cleanup and HEL-1493's undo) converges on HEL-1497's `deleteIfUnadoptedImplicit` rule: implicit flag + `Auto: ` prefix + real dependents count. Stop logging `ex.getMessage`.
6. *(from the comment)* Refresh the frontend connectors list after a patch-set undo that removed a bare-url REST source.
7. *(from the comment)* A combined-wiring undo spec, with `DataSourceService` given a `connectorRepo`, covering the plain, adopted (renamed) connector, renamed source and shared connector cases.

Accepted by design: an MCP or agent source delete leaves the Connectors list stale until reload, and implicit `Migrated: ` Connectors are kept. Existing prod leftovers are HEL-1495.

## Acceptance Criteria

- AC1: The pdf-over-cap 413 test asserts the 413 deterministically and tolerates the server closing early. A deterministic, forced-ordering repro (no sleep-based timing) shows the old client approach failing under the race ordering and the new approach passing under it.
- AC2: `ImplicitConnectorCleanup.deleteIfAuto` no longer exists. Every auto-Connector cleanup (SourceService.createRest insert-failure cleanup, InlineSourceCleanup.deleteCallCreated, InlineSourceCleanup.deleteIfUnreferenced, DataSourceService.delete) applies the one HEL-1497 rule: implicit flag AND `Auto: ` prefix AND zero real referencing sources, owner-scoped.
- AC3: No log line in `InlineSourceCleanup.scala` (incl. `ImplicitConnectorCleanup`) carries `ex.getMessage`, a Connector config or a credential value; failures log ids, context, exception class and SQLSTATE only. A failed cleanup never fails the source delete.
- AC4: `ConnectorRepository.delete` deletes the connector row and its credential row in ONE transaction; an injected credential-delete failure leaves both rows intact (proven by a fault-injection test). The delete statement itself is owner-scoped; a cross-tenant delete is refused (mutation-proven).
- AC5: After a patch-set undo whose outcome removed an inline source, the frontend Connectors list is invalidated so the next visit refetches.
- AC6: A combined-wiring undo spec (real `DataSourceService` WITH `connectorRepo` + `InlineSourceCleanup` + `PatchSetUndoService`) covers: plain bare-url REST inline root (Connector removed), adopted/renamed Connector (kept), renamed source (Connector removed), shared Connector (kept until the last source).
- AC7: No migration. New specs use `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` appears in sbt runs; no inline FQNs.

## Owner rulings (HEL-1497, binding)

Delete silently; "auto-created" = implicit flag AND name still starts with `Auto: `; keep the Connector while any source references it. A failed cleanup is logged by id only and never fails the source delete.
