# Files modified — HEL-1121 row-listing-api

- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — new `listRows` method (D1/D2/D7: RLS-scoped via `ctx.withUserContext`, `limit+1` probe for `nextCursor`, page+total in one transaction, no `lockSource`) and the `RowListPage` case class.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — new `listRows` method (D6 precedence: malformed cursor/limit → 400, ACL lookup → 404, kind check → 400, success), `parseCursor`/`parseLimit` helpers, and the `RowListResult` case class.
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — new `RowListResponse` type reusing the existing `RowResponseRow` (D4) plus its `jsonFormat3` implicit.
- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` — new `GET /api/data-sources/:id/rows` route, parsing `cursor`/`limit` as raw optional strings so malformed values route through the service's own 400 handling.
- `schemas/sources/row-list-response.schema.json` — new schema, `$ref`-ing the existing `row-response-row.schema.json`.
- `frontend/src/features/sources/types/dataSource.ts` — new `RowListResponse` TS type.
- `frontend/src/features/sources/services/dataSourceService.ts` — new `fetchSourceRows` service function.
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositorySpec.scala` — `listRows` repository tests: nonexistent source, empty source, single/multi-page, cursor=0 boundary, concurrent-append paging stability (AC #1, task 4.6), no-regression assertion for `readDatasetRows`'s `{columns, rows}` shape (AC #4, task 4.7).
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala` — RLS test (task 4.4, MUST): pinned outcomes (a) non-owner direct `listRows` call → `SourceNotFound`, (b) owner positive control, (c) raw `SELECT` against `dataset_rows` under the non-BYPASSRLS role denied vs. privileged pool allowed (the test that actually exercises the `dataset_rows_owner` RLS policy), (d) structural note that `listRows`'s SQL carries no extra ACL predicate.
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — new `GET /api/data-sources/:id/rows` describe-block: paging/cap/cursor-boundary/malformed-input/wrong-kind/ACL-404/nonexistent-404 tests, plus the round-trip test (AC #3, task 4.5, MUST): GET a row, PATCH using its `updatedAt` exactly as returned in the JSON body, assert `200`.
- `backend/src/test/scala/com/helio/api/protocols/sources/DataSourceProtocolSpec.scala` — direct spray-json unit test (AC #5, task 4.8): `nextCursor` key is genuinely absent (not `null`) when `None`, present as a JSON number when `Some`.

## Verification evidence

- `sbt compile` / `sbt Test/compile` — clean (pre-existing warnings only).
- `sbt test` (full suite) — 4180 tests, 0 failures.
- `node scripts/check-schema-drift.mjs` — schemas in sync with `JsonProtocols`/protocols (88 checked).
- `npm run lint` / `npm run format:check` / `npm test` / `npm --prefix frontend run build` — all clean.

## Cycle 2 (skeptic-final-1.md REFUTE — doc/comment-accuracy fixes, no behavior change)

- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala` — replaced task 4.4(d)'s placebo `succeed` (backed by a comment claiming it "re-runs" a probe that never actually ran) with a comment pointing at the real test that pins the property: `DataSourceRepositorySpec`'s "listRows returns the source's rows regardless of which AuthenticatedUser..." test.
- `openspec/changes/row-listing-api/design.md` — corrected D7's false claim that the page query and `total` count "reflect the same read snapshot". `ctx.withUserContext` has no isolation-level override, so both statements run at Postgres's default READ COMMITTED, each taking its own snapshot; a concurrent commit between them can make `total` reflect different data than the page. No behavior change — this was a documentation-only inaccuracy; the existing `total`-staleness trade-off already covers the corrected claim.
- `openspec/changes/row-listing-api/specs/dataset-row-write-api/spec.md` — fixed a dangling cross-reference ("the `dataset-row-write-api` change's design.md") that would point at nothing once archived (`dataset-row-write-api` is a capability spec name, not a change name) — now names `row-listing-api`'s design.md (D7) and tasks.md (4.4) directly.

### Verification evidence (cycle 2)

- `sbt Test/compile` — clean.
- `sbt testOnly RlsOwnerTablesSpec DataSourceRepositorySpec DataSourceRoutesSpec DataSourceProtocolSpec` — 214 tests, 0 failures.
- `sbt test` (full suite) — 4180 tests, 0 failures.
- `node scripts/check-schema-drift.mjs` / `node scripts/check-openspec-hygiene.mjs` — clean.
- `npm run lint` / `npm run format:check` — clean.

## Cycle 3 (skeptic-final-2.md REFUTE — two factual corrections in one comment, no behavior change)

- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala` — the cycle-2 fix to task 4.4(d)'s comment (lines ~617-631) still had two errors: (1) it called the spec's fixture "single-role" when it is genuinely two-role (`helio_app_test` non-superuser/non-BYPASSRLS for `withUserContext`, `helio_privileged` BYPASSRLS for `withSystemContext`); (2) it cited `DataSourceRepositorySpec.scala:674` for the real test, which had shifted to line 682. Both corrected; verified the actual line number by grep rather than trusting either the prior citation or the skeptic's own claimed replacement.

### Verification evidence (cycle 3)

- `sbt Test/compile` — clean.
- `sbt testOnly RlsOwnerTablesSpec DataSourceRepositorySpec` — 72 tests, 0 failures.
- `sbt test` (full suite) — see below.
- `node scripts/check-schema-drift.mjs` / `node scripts/check-openspec-hygiene.mjs` — clean.

## Notes for Delivery (non-blocking, per tasks.md 7.1)

No existing route exposes a dataset source's DECLARED schema (`DatasetFieldDeclaration`) — only
`inferredSchema` is ever returned, and there is no `GET /api/data-sources/:id` at all (design.md
D5). HEL-1080's grid will need this; not solved in this ticket. Should be filed as a standalone
follow-up ticket at Delivery, same precedent HEL-1078 set in filing this ticket. Task 7.1 in
`tasks.md` is left unchecked deliberately — it's an action for the Delivery phase, not something
completed during implementation.

No migration was needed — the existing `idx_dataset_rows_data_source_id` index (V106) already
supports the `WHERE data_source_id = ? [AND seq > ?] ORDER BY seq LIMIT ?` query shape. Confirmed
during implementation; the premise held.

The known CI flake `e2e/focus-presence-guard.spec.ts:163` (HEL-1119) was not encountered — no e2e
gates were run for this backend/schema/frontend-types-only change.
