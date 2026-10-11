# HEL-1497: Deleting a bare-url REST source leaves its implicit "Auto:" Connector (and credential row) behind

## Description

origin_kind: followup
origin_ticket: HEL-1475

Found by HEL-1475's final-gate skeptic.

`DataSourceService.delete` (`DataSourceService.scala` ~649-685) never removes a Connector. When a user deletes a REST source that was created from a bare `url`, the implicit `Auto: <name>` Connector that `SourceService.createRest` synthesized for it stays behind, unreferenced, with its encrypted credential row.

Product question (owner): should a user-initiated source delete also remove its implicit Connector? HEL-1475 added a helper, `InlineSourceCleanup`, that does exactly this, guarded three ways:

* the Connector name must be exactly `Auto: <source name>`;
* the delete goes through the real dependents count;
* the source is deleted first.

That helper could be reused here. The open question is whether an Auto Connector should ever outlive its source, for example because the user might reuse it.

## Acceptance Criteria

(Derived from the description; finalized once the owner answers the Planning escalation.)

- The owner's product decision on Auto-Connector lifecycle at user source delete is recorded and implemented.
- Only the deleting user's own implicit Connector can ever be removed (owner-scoped/RLS; no cross-tenant path).
- A Connector another source still references is never removed.
- A credential value is never logged.
- Out of scope: cleaning up existing leftover Auto Connectors in prod (HEL-1495).

## Owner Decisions (escalation HEL-1497-1791747491951-57cd87, answered 2026-10-11, channel chat, answer_source human)

- Q1 `delete-silently`: deleting a REST source also deletes its auto-created Connector and that Connector's credential row,
  with no UI prompt.
- Q2 `implicit-flag-and-auto-prefix`: a Connector counts as auto-created only if its server-owned `config.implicit` is
  `true` AND its name still starts with `Auto: `. A user who renamed the Connector has adopted it, so it is kept.
  Renaming only the source does not block cleanup.
- Q3 `keep-while-referenced`: a reused Auto Connector stays while any source references it. It is removed when its last
  referencing source is deleted, under the Q1/Q2 rules.
- Self-approved, no objection raised: a failed Connector cleanup is logged (ids only) and never fails or rolls back the
  source delete.

## Acceptance Criteria (final)

1. Deleting a `rest_api` source whose Connector is auto-created (per Q2) and has no other referencing source removes that
   Connector and its `connector_credentials` row.
2. A Connector is kept when any of these hold: a non-implicit (user-created) Connector; an implicit Connector the user
   renamed so its name no longer starts with `Auto: `; any Connector another source still references.
3. Renaming the source alone does not prevent cleanup.
4. Only the deleting user's own Connector can be removed. All reads and deletes are owner-scoped (RLS +
   `findByIdOwned`), so no cross-tenant path exists.
5. The source delete's response and outcome are unchanged. A Connector cleanup failure is logged (ids only) and is never
   surfaced as a source-delete error. No credential value, ciphertext or exception message that could contain one is
   logged.
6. The frontend Connectors list does not keep showing a Connector that was removed this way (stale-cache check).
7. Out of scope: prod leftover cleanup (HEL-1495); no migration.
