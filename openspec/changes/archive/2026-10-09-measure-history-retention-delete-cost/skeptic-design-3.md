## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/measure-history-thinning-delete/HEL-1284`. HEAD is `023aa4bbe4144436c871cdd41d57c71f2a275bb8`, and the only untracked path is the change dir.
- **Round-2 CR1 (no `.env`, no `sbt run`): the safety property holds.** I checked three things.
  - `Database.initApp` (Database.scala:17-31) configures Flyway with nothing but `dataSource` and `locations("classpath:db/migration")`. It sets no placeholders, callbacks or schemas.
  - `db/migration` holds 118 SQL files, V1..V118 contiguous, and there are no Java/Scala migrations (`grep BaseJavaMigration|package db.migration` returns nothing). So `filesystem:<worktree>/backend/src/main/resources/db/migration` is equivalent to the classpath location and should reach version 118.
  - A jshell process with a literal URL never reads `.env` and never starts Main or the scheduler.
- **Does `sbt "export Runtime/fullClasspath"` touch the DB or read `.env`? No.**
  - In sbt 2.0.9, `envVars` is a `TaskKey` (`javap sbt/Keys$` from `main_3-2.0.9.jar`: `public sbt.TaskKey<Map<String,String>> envVars()`). `loadDotEnv` (build.sbt:124-125) therefore runs only when `run` or `test` executes, not at project load and not for a classpath export.
  - There are no source/resource generators or compile hooks that touch the DB (the only plugin is sbt-assembly).
- **Can that command produce a usable `--class-path`? No. This is a hard execution defect in D1.**
  - Bytecode: `sbt.Classpaths$.exportVirtualClasspath(TaskStreams, Seq)` in `main_3-2.0.9.jar` prints `Attributed.data(cp).toString` on the export stream. That is the `toString` of a Scala `Seq[HashedVirtualFileRef]`. There is no `FileConverter.toPath` and no path-separator join.
  - Independent repo evidence: `openspec/changes/archive/2026-10-06-deterministic-verify-history-read/evidence-probes.md:30-33` (same sbt 2.0.9, two days ago) records that `export Runtime/fullClasspath` "returned virtual references (`${OUT}/jvm/.../helio-backend_2.13-0.1.0-SNAPSHOT.jar>sha256-...`, 254 entries `${CSR_CACHE}/https/repo1...`) that `java -cp` cannot use". That ticket switched to the `sbt assembly` jar.
  - Two independent readings agree, so this is not a flaky measurement. `jshell --class-path` fails on this output the same way `java -cp` did.
- **Can Flyway 10.20.1 + flyway-database-postgresql run from jshell? Yes, given a real classpath.**
  - I ran a no-DB probe: JDK 21.0.12 `jshell --class-path flyway-core-10.20.1.jar:flyway-database-postgresql-10.20.1.jar` (from the coursier cache). `Flyway.configure().getPluginRegister().getPlugins(DatabaseType.class)` returned `[..., PostgreSQLDatabaseType]` under jshell's `RemoteClassLoader` context loader. No connection was attempted.
  - `MigrateResult` has public `database` (inherited from `OperationResultBase`) and `targetSchemaVersion` fields (`javap`), so D1's positive check is implementable.
  - The assembly jar keeps Flyway's plugin discovery intact. Its merge strategy concatenates `META-INF/services` (build.sbt:93), and an existing `helio-backend.jar` contains `META-INF/services/org.flywaydb.core.extensibility.Plugin` listing `PostgreSQLDatabaseType`, plus `org/postgresql/Driver.class`.
- **Migration side effect outside the scratch DB.** V34 runs `GRANT helio_privileged TO current_user`, a cluster-global role-membership write that depends on D1's unspecified `<user>`. It is a no-op only if `<user>` is the role that already migrated `helio`.
- **Round-2 non-blocking notes: all addressed.**
  - The catch-all is excluded from D4 because of the V88 CHECK.
  - Task 3.2 is reworded to a scratch-only apply with no ownership claim, and D6 states ownership as an assumption.
  - Proposal.md now says "reach the owner's tier only through `pipeline_id` and filter on `captured_at`; no index leads with either".
  - D2's age-purge depth is now unambiguous: 1/24 of each tier's Outputs have one daily point past the cap by less than 1 h, which matches an hourly tick.
- **AC coverage is unchanged and complete.** Plans and timings map to 2.1-2.2, the conditional index with before/after plans to 3.1-3.3, and per-tick cost plus the cadence/lock verdict to 4.1. V120 is consistent with the ticket.
- **Task 5.1.** None of the OutputHistory*/NodePayloadHistory* test specs reference `DATABASE_URL` (grep), so `Test / envVars` loading `.env` does not point them at `helio`.

### Verdict: REFUTE

The safety design of D1 is now correct. Its named classpath source, `sbt "export Runtime/fullClasspath"`, provably cannot produce a usable classpath on this repo's sbt 2.0.9: it prints `${OUT}`/`${CSR_CACHE}` virtual refs inside a Scala `List(...)`. That is shown by the bytecode and by this repo's own recorded probe from 2026-10-06. Task 1.1 fails at its first step, and C3 then leaves the executor to improvise how to get Flyway onto a classpath, which is the step this plan has spent three rounds pinning down. The fix is one line.

### Change Requests

1. **D1 and tasks 1.1: replace `sbt "export Runtime/fullClasspath"` with a classpath source that yields real paths.** Recommended: `nice -n 19 sbt assembly` in the worktree's `backend/`, then `jshell --class-path <worktree>/backend/target/scala-2.13/helio-backend.jar` (build.sbt:89 pins this path).
   - The jar is proven in-repo: it is the Dockerfile artifact, used by the 2026-10-06 change, and keeps `META-INF/services` concatenated.
   - `assembly` does not execute `run`/`test`, so `envVars`/`.env` is never evaluated. State this in D1 and keep the separate `sbt --client shutdown`/no-lingering-server hygiene the prior change used.
   - An acceptable alternative is the three cached jars (flyway-core, flyway-database-postgresql 10.20.1, postgresql 42.7.13) plus flyway-core's runtime dependencies. If that route is taken, the plan must name how the full dependency set is obtained. Do not name `export Runtime/fullClasspath` in either case.
   - In the same edit, replace D1's `<user>` placeholder with the concrete role. V34's `GRANT helio_privileged TO current_user` is a cluster-global write, and it is a no-op only for the role that already migrated `helio` (the local superuser). Add one line to C2/D1 saying that GRANT is the only cluster-global effect and is expected to be a no-op.

### Non-blocking notes

- D1 says "Nothing reads `.env`", but strictly the sbt build file contains `loadDotEnv`. The precise claim is that no task that evaluates `envVars` (`run`, `test`) is invoked during migrate. Word it that way so an evaluator does not trip on C3's "anything that reads backend/.env".
- Task 5.1: CLAUDE.md says to prefer `sbt testFull` over bare `sbt test`, because sbt 2 caches results and a repeat run can execute zero tests. If `testOnly` is used, record the executed-test count so a cached no-op run is visible.
- Flyway 10.20.1 against local PG 18.4 may log a "newer than tested" warning. That is expected (the `helio` DB was migrated by the same Flyway) and should be recorded as such, not treated as a failure.
