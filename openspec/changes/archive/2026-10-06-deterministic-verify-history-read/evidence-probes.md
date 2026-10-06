# Evidence: probes (tasks 1.1-1.3)

Full logs: session scratchpad `hel1297-*` (not committed).

## 1.1 `.env` vs shell `DATABASE_URL` under `sbt run`

Scratch `probe1297.ProbeEnv` (deleted afterwards, never committed) printed `DATABASE_URL` minus its query string, run as
`DATABASE_URL='jdbc:postgresql://shellhost.invalid:1/shell_probe_db' sbt "runMain probe1297.ProbeEnv"`:

    PROBE DATABASE_URL = jdbc:postgresql://localhost:5432/helio

`backend/.env` WINS over a shell-exported `DATABASE_URL` (`Compile / run / envVars ++= loadDotEnv`). An `sbt run`
launcher therefore cannot be pointed at a dedicated DB by the shell; the launcher must build the JVM environment itself.

## 1.2 D2 observable on a dedicated DB

Every isolated run printed (tick interval 5 s), e.g. run `3fa19dca`:

    D2: pipeline_schedules scan counter at first health v0=2; waiting for >= 4
    D2: 2026-10-06T16:45:44.427Z counter=3 (v0+1)
    D2: 2026-10-06T16:45:49.485Z counter=4 (v0+2)
    D2: second scheduler tick observed - startup retention pass completed

Every isolated run in this change showed v0=2 and +1 per ~5 s (= `SCHEDULER_TICK_INTERVAL_SECONDS`), proceeding at v0+2.

## 1.3 CREATEDB and launch artifact

- The `backend/.env` role has CREATEDB/superuser: every run's `canCreateDb` check (`rolcreatedb or rolsuper`) passed and
  `createdb` succeeded.
- DEVIATION from D3's example: sbt 2's `export Runtime/fullClasspath` returned virtual references
  (`${OUT}/jvm/.../helio-backend_2.13-0.1.0-SNAPSHOT.jar>sha256-.../13809038`, 254 entries `${CSR_CACHE}/https/repo1...`) that
  `java -cp` cannot use, and `export Compile/run/javaOptions` printed nothing. The launcher therefore runs the production
  `sbt assembly` jar (`backend/target/scala-2.13/helio-backend.jar`, the artifact the Dockerfile ships) as
  `nice -n 19 java <opens> -jar ...`, so the recorded PID is the server JVM. The EFFECTIVE `Compile / run / javaOptions` (project-level `build.sbt:107-121`
  incl. `jdk.internal.ref`, `jdk.internal.misc`, `java.nio.channels.spi/sun.nio.ch`, plus the `:224-235` addendum, de-duplicated; matches the Dockerfile
  ENTRYPOINT) is in `isolatedBackend.ts` (`JAVA_OPTIONS`).
  Build: `nice -n 19 sbt assembly` -> `[success] elapsed time: 18 s`, then `sbt --client shutdown` (separate call).
