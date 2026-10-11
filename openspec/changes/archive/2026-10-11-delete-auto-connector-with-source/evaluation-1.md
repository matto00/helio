## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 903dd7e2f24d8acf961e1d2d1a56d9e055c6ed72 (base 48931ae90, resolved live via resolve-review-base.sh).
Worktree clean at review time.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (unadopted, unreferenced Auto Connector and its credential row are removed). `DataSourceService.deleteAfterPrecheck`
  chains `removeUnadoptedConnector` after a successful delete. `ImplicitConnectorCleanup.deleteIfUnadoptedImplicit`
  requires `ConnectorAuthShape.parse(config).implicit` and the `Auto: ` prefix, and deletes through
  `connectorRepo.delete(..., countRestSourcesReferencing)`, which is the real count and runs under system context, so
  it counts globally. The credential row is removed by `ConnectorRepository.delete`. Tested at service level, at route
  level, and through the credential table.
- AC2 (keep rules), AC3 (renaming the source does not block) and Q3 (keep while referenced): each has a dedicated
  test in `DataSourceDeleteAutoConnectorSpec`.
- AC4 (owner-scoped). `findByIdOwned` (explicit `owner_id` filter) is used in the helper and is checked again in
  `ConnectorRepository.delete`. The cross-tenant test is built as D7 requires: A's Connector has no referencing
  source, so the global count is 0, and B deletes a forged reference. The tests run as the superuser, which bypasses
  RLS, so this test isolates the owner predicate. Mutation (d) proves that.
- AC5 (outcome unchanged, log-safe). The cleanup is chained outside the zero-root `.recover`. `Left` is passed through
  untouched. The helper's `.recover` catches every non-fatal error. A non-UUID `connectorId` is caught by `Try` and
  skipped with a warn. Failure logs carry the context (source id), the connector id, `getSimpleName` and the SQLSTATE
  only. No `getMessage` is added in `src/main`. A fresh `testFull` log contains 0 occurrences of the spec's sentinel.
- AC6. `connectorsSlice` resets `status` to `"idle"` on `deleteSource.fulfilled`, and `ConnectorsPage.tsx:141`
  refetches on idle. There is no circular import (`sourcesSlice` does not import connectors).
- AC7. No migration file in the diff.
- Tasks 1.1-3.9 are all checked and match the implementation. `openspec validate ... --type change` is valid.
- CONSTRAINTS C1-C4 are all honored. C4: `deleteIfAuto` and `deleteCallCreated` are byte-identical. The only
  pre-existing line touched is `autoName`, now `s"$AutoPrefix$sourceName"`, which produces the same string (see
  suggestions). C3: both new specs use `VerifiedEmbeddedPostgres.start` (RoutesSpec:70, Spec:61), and
  `[hel1468-guard]` is visible.
- D3 init order. `connectorRepo` now precedes `dataSourceService` in `ApiRoutes.scala` (moved block, not
  duplicated). It is the only production `new DataSourceService(` site, so the single seam (D1) holds. The route test
  goes through the real `ApiRoutes`, and mutation (e) turns it red.
- The commit message has no claude.ai session link and no Claude-Session trailer.

### Phase 2: Code Review — PASS
Gates, all run fresh by the evaluator in WORKTREE_PATH. Logs are under `.concertino/runs/HEL-1497/eval1-*.log`.
- `sbt -batch testFull` (nice 19): `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, 7113 run,
  7113 succeeded, 4 canceled (pre-existing). The new specs ran in-suite.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run check:scala-quality`: all clean. The
  inline-FQN check is clean, and a manual grep of the added lines found none.
- `npm test`: 536 suites / 5825 tests passed (plus 47/450 in the second project).
- `npm --prefix frontend run build`: succeeded.

Mutation evidence spot-check. I did not re-apply any mutation, because the evaluator never modifies code. I read the
raw logs in `.concertino/runs/HEL-1497/` (`red1.log`, `green1.log`, `mut-a..g.log`). Each log is a genuine sbt
testSelected run, and its failing test names and `[hel1468-guard] failed=N` lines match the red-evidence.md table
exactly:
- (a) 2 failed
- (b) 2 failed, including the pre-existing explicit-Connector guard in `InlineSourceLeakPathsRoutesSpec`
- (c) 2 failed
- (d) cross-tenant, 1 failed
- (e) route spec, 1 failed
- (f) log-safety, 1 failed
- (g) 7 failed

The red baseline (red1.log) shows 5 failures with 4 guards passing. All 4 guards are covered by mutations (a), (b),
(d), plus the null-repo no-op. The red baseline was taken against a main-equivalent `delete` body, not literal main,
because the spec needs the new constructor parameter to compile. That is acceptable.

Code-quality checklist:
- DRY: the helper sits beside `deleteIfAuto`, and `AutoPrefix` is shared with `autoName`.
- Readability: good.
- Modularity: one seam (D1).
- Types: no escape hatches beyond `asInstanceOf[RestSource]` in test fixtures.
- Error handling: never throws, never alters the outcome.
- Tests: meaningful and mutation-proven.
- No dead code, and no over-engineering.

### Phase 3: UI Review — N/A
The only frontend change is a non-visual reducer case in `connectorsSlice.ts`, covered by a unit test. The caller
waived the UI review beyond it, and no server-backed flow changed visually.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `InlineSourceCleanup.scala` `object ImplicitConnectorCleanup.autoName` was rewritten to use `AutoPrefix`. The
  behavior is identical, but it is an edit to a pre-existing line in the file HEL-1493 is also changing. If the
  rebase onto HEL-1493 conflicts, resolve it additively, as design.md Risks already notes.
- `DataSourceService.scala` grows from 1405 to 1434 lines, well past the ~400-line soft budget. Per CONTRIBUTING, the
  PR description should propose a split. This is not caused by this change.
- The Connector cleanup is awaited outside any transaction with the source delete (D4). That is documented and
  accepted. A slow DB adds latency to `DELETE /api/data-sources/:id` but cannot change its result.
