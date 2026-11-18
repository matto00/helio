# HEL-1742 fail-first record

Honest account: the implementation was written before the specs in this run, so a "red before any code" run
does not exist for these specs. The red evidence is the opposite direction, applied to every new test and guard:
each is shown to turn red when exactly the behavior it protects is removed (mutations.md, M1-M16, each applied,
run with `sbt testOnly <spec>`, then reverted).

Task 0.1 (route specs red when the routes do not exist): M7 (`OutputRoutes` not given the read service by
`ApiRoutes`) turns 8 of the 12 `OutputInsightRoutesSpec` tests red, and M8 (`PublicDashboardRoutes` not given
it) turns 4 of the 7 `OutputInsightPublicRoutesSpec` tests red. That is the "no route / 404" state the tasks asked
for, reached by removing the wiring instead of by running before the code existed.

Task 0.2: the shared dev DB's applied max migration, read-only, before any local change:

```
$ psql -XAtc "select max(version::int) from flyway_schema_history" helio
140
```

140 < 142, so V142 (and V141) apply cleanly there; no lane-private DB was needed. Nothing was applied to the
shared DB by this run: the manual RLS check (rls-live-check.md) applies V141+V142 inside one transaction that
is rolled back (re-checked after the run: max still 140).

Non-mutation guards pinned by an unmodified-tree run (all green), full command and totals in the final report.

Note: the migration was renumbered V142 -> V145 in cycle 2 (C1); references above to V142 mean this file.
