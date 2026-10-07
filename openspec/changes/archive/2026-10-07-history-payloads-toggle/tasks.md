## Standing Constraints

- [C1] Gate the toggle only on the response's `historyPayloadsAvailable` (pipeline owner's tier), never on `User.tier`.
- [C2] e2e screenshots/evidence go through `e2e/support/evidencePath.ts`; no `openspec/` path in e2e code (HEL-1363).
- [C3] Do not edit hel1277/hel1350/hel1275 e2e spec screenshot code.


## 1. Backend

- [x] 1.1 Add `NodePayloadHistoryRepository.payloadsAvailableFor` (privileged pool, one batched query, unknown → false); verify with a repository spec covering free/beta/owner and an unknown id
- [x] 1.2 Add `historyPayloadsAvailable: Option[Boolean] = None` to `OutputResponse` plus JSON format; verify None is omitted and Some is serialized
- [x] 1.3 Add `payloadAvailability: Option[(NodePayloadHistoryRepository, PayloadHistoryConfig)] = None` to `OutputRoutes`, pass `Some((resolvedNodePayloadHistoryRepo, payloadHistoryConfig))` from `ApiRoutes` (never the nullable `nodePayloadHistoryRepo` param), populate all 5 REST sites; verify `sbt compile`
- [x] 1.4 Add optional read-only `historyPayloadsAvailable` boolean to `schemas/outputs/output.schema.json`; verify the schema-drift check passes


## 2. Frontend

- [x] 2.1 Add `historyPayloadsAvailable?: boolean` to `Output` in `types/output.ts`; verify typecheck
- [x] 2.2 Create `outputEditor/HistoryPayloadsField.tsx` (+css) with the owner-ruled copy, shared `Toggle`, disabled note and `/settings#beta-access` link; verify it renders in a unit test
- [x] 2.3 Wire it into `OutputEditorSheet` (edit mode only), seeding from `config.historyPayloads === true`; on edit Save add `historyPayloads` ONLY when `historyPayloadsAvailable === true` and the toggle differs from its seed, else omit the key (D5); verify unit tests
- [x] 2.4 Add `id="beta-access"` to the Beta access `<section>` in `SettingsPage.tsx`, plus a settle-aware hash scroll-into-view (D6); verify a unit test


## 3. helio-mcp

- [x] 3.1 Add `HISTORY_PAYLOADS_CONFIG_DOC` and append it to `update_output`'s description; verify the helio-mcp build


## 4. Tests

- [x] 4.1 Backend route spec through production `ApiRoutes` wiring: all 5 REST sites emit the key; free/beta/owner pipeline owners; cross-tier editor grantee gets the owner's tier; client-sent config value is ignored. Run `sbt testFull` on the targeted spec
- [x] 4.2 Frontend tests: a changed enabled toggle sends true/false; an unchanged toggle omits the key (absent, null and true seeds); disabled shows note and link and omits the key; create mode has no section; a beta viewer on a free-owned pipeline sees disabled
- [x] 4.3 helio-mcp tests: PATCH body carries `config.historyPayloads: true`; description mentions key, caps and `historyPayloadsAvailable`
- [x] 4.4 e2e spec (new file): beta-owner enable → save → reopen shows on; free-owner disabled → link → after `waitForSettingsAuditTable` the "Beta access" heading is in the viewport; light and dark screenshots via `evidencePath`
- [x] 4.5 Manual visual check of the running app in both themes against neighbouring editor sections (DESIGN.md); record evidence paths
