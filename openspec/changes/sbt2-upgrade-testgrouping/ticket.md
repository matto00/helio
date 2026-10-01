# HEL-1018: sbt upgrade fails to load build.sbt: testGrouping needs a JsonFormat or opt-out for task caching

## Description
Dependabot PR #489 bumps sbt 1.10.10 -> 2.0.9 (a MAJOR), sbt-assembly 2.3.1 -> 2.5.0 and ~54 libs. build.sbt fails to load on sbt 2:
`given evidence sjsonnew.JsonFormat[Seq[Tests.Group]] is not found; opt out of caching by annotating the key with @transient, or as foo := Def.uncached(...), or provide a given value`.
`Test / testGrouping` (backend/build.sbt) is HEL-924's grouping (8 hash-bucketed forked groups, Tags.ForkedTestGroup cap) that bounds concurrent EmbeddedPostgres suites. The fix must change caching behaviour only, never the grouping.
Options: (1) @transient, (2) Def.uncached(...), (3) given JsonFormat. (1)/(2) preferred; record the choice and why the others were declined.

## Acceptance Criteria
- sbt loads build.sbt and `sbt test` runs to completion on the updated sbt version.
- The grouping itself is unchanged - demonstrated by comparing group structure (names -> test-class sets) before and after.
- Full backend suite green, no new intermittent failures across at least two consecutive runs.
- Chosen remedy and reason for declining the other two recorded in-source at the definition site.
- PR #489 (or its successor) goes green.

## Driver scope decisions
- This PR is the build-tool migration only: backend/project/build.properties -> sbt 2.x, plugin bumps sbt 2 needs, build.sbt changes sbt 2 requires. No ~54 library bumps; keep Jackson 2.18.11 pins (HEL-1213).
- Trace CD path (cd-backend.yml, Dockerfile): the assembly jar must still build and the app must boot (/health). scripts/concertino/ is a render target - never hand-edit.
- If sbt 2 is infeasible (plugin without sbt 2 release), escalate with evidence.
- AC emphasis: full suite green twice consecutively; grouping unchanged; assembly jar builds and app boots against dev DB.
