# HEL-1497 red evidence

Logs live under `.concertino/runs/HEL-1497/` in the main checkout (`red1.log`, `green1.log`, `mut-*.log`).

## Red first (tests written before the cleanup call existed)

`DataSourceDeleteAutoConnectorSpec` (real `VerifiedEmbeddedPostgres.start`), run with the new helper and the optional
`connectorRepo` parameter present but `DataSourceService.delete` NOT calling the cleanup (i.e. behaviour of unmodified
main):

```
[info] - should remove the source's unadopted Auto Connector and its credential row *** FAILED ***
[info] - should keep a reused Auto Connector while another source references it, and remove it with the last one *** FAILED ***
[info] - should still clean up when only the source was renamed *** FAILED ***
[info] - should leave the source delete's outcome unchanged and log no credential when the Connector cleanup fails *** FAILED ***
[info] - should remove an unreferenced Auto Connector named by connectorId, and keep a user-created one *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=5 aborted=0 unreadable=0
[info] Tests: succeeded 4, failed 5, canceled 0, ignored 0, pending 0
```

The 4 passing are guards (keep cases that hold on main too): renamed Connector kept, user-created `Auto: ` Connector
kept, cross-tenant survives, null-repo no-op. Their failability is shown by mutations (a), (b), (d) below.

## Green after the change

```
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Tests: succeeded 17, failed 0, canceled 0, ignored 0, pending 0
```
(`DataSourceDeleteAutoConnectorSpec`, `DataSourceDeleteAutoConnectorRoutesSpec`, `InlineSourceLeakPathsRoutesSpec`.)

## Mutations (each applied, run, reverted; the three specs above)

| # | Mutation | Test(s) turned red |
|---|----------|--------------------|
| a | drop the `implicit` check | `keep a user-created Connector even when its name starts with 'Auto: '`; `remove an unreferenced Auto Connector named by connectorId, and keep a user-created one` |
| b | drop the `Auto: ` prefix check | `keep an implicit Connector the user renamed so it no longer starts with 'Auto: '`; `never remove an explicitly named Connector when the inline source naming it is compensated (guard)` |
| c | default zero `dependentCount` in the new helper | `keep a reused Auto Connector while another source references it, and remove it with the last one`; `keep the Auto Connector when a second source references it, while still removing the call-created source` |
| d | remove `r.ownerId === ownerUuid` from `ConnectorRepository.findByIdOwned` | `never remove another user's Connector, even when the deleter's own source is forged to reference it` |
| e | unfixed `ApiRoutes` order (`dataSourceService` built before `connectorRepo`, so it receives `null`) | `DataSourceDeleteAutoConnectorRoutesSpec`: `remove the source's unadopted Auto Connector and its credential row` |
| f | log `ex.getMessage` instead of class + SQLSTATE in the cleanup failure path | `leave the source delete's outcome unchanged and log no credential when the Connector cleanup fails` |
| g (extra) | `DataSourceService.delete` does not call the cleanup | 7 tests incl. the route test and the `InlineSourceLeakPathsRoutesSpec` compensation test |

Each log shows `[hel1468-guard] ScalaTest summary: failed=N` with N matching the red tests.

## Existing specs reconciled (task 3.6)

None needed. The full `sbt testFull` passed with no existing spec changed for premise (only `InlineSourceLeakPathsRoutesSpec`
was extended: its `DataSourceService` is now wired WITH `connectorRepo`, and one test was added; its explicit-Connector
guard test is unchanged and still passes):

```
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Total number of tests run: 7113
[info] Tests: succeeded 7113, failed 0, canceled 4, ignored 0, pending 0
```

Frontend: `npm run lint` clean, `npm run format:check` clean, `npm --prefix frontend run typecheck` clean, `npm test`
536 suites / 5825 tests passed, `npm --prefix frontend run build` succeeded.
