# HEL-1293: Split PatchSetUndoServiceSpec (~773 lines) by concern

## Description

origin_kind: followup
origin_ticket: HEL-1256

`PatchSetUndoServiceSpec.scala` is about 773 lines, well past CONTRIBUTING's ~400.
(Re-measured on main f78b4c518: 805 lines, 19 test cases; grew in HEL-1256 and HEL-1295.)

## Acceptance Criteria

- Split it into concern-focused specs, for example panel undo, lane create/delete undo, and repo-missing rejections.
- Share fixtures through a trait rather than copying setup.
- The change must preserve behaviour: the test count is the same before and after, and no assertions change.

## Driver constraints (this run)

- Show test counts before and after, and a mechanical assertion-equality check (sorted test names + assertion lines, before vs after).
- Refactor discipline: any bug found is noted as a spinoff, not fixed here.
- Do not edit `PatchSetApplyResolvers` (HEL-1337 in flight), `ci.yml`, `playwright.config.ts`, `.gitignore`.
- `nice -n 19 sbt testFull` with at most 2 workers (`HEL924_TEST_GROUP_CONCURRENCY=2`), Bash timeout 600000; `sbt --client shutdown` as a separate call.
