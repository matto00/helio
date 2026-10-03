## 1. Reproduce red on main
- [x] 1.1 For each of the three defects, write a failing route/service test on PATCH /api/panels/:id and capture the red output (500 / 200 persisted dup / 200 ignored)
- [x] 1.2 Enumerate (incl. batch PATCH and snapshot restore) and persist as write-paths.md in this change dir; enumerate every controls write path from code (design D4 table) and reproduce each defect per path; record table in the PR

## 2. Fix
- [x] 2.1 Map controls decode failures to 400 on PATCH (D1) and any other path found red
- [x] 2.1b Make non-array `controls` a strict decode failure on create/batch/import/contents/duplicate (D1b), keeping row-mapper tolerance; add shared structural helper (D1c)
- [x] 2.2 Reject duplicate control ids on all paths (D2)
- [x] 2.3 Reject controls on non-output panels on PATCH (and any other path found red) (D3)
- [x] 2.4 Confirm 404-before-validation ordering; run ExistenceNotLeakedRoutesSpec

## 3. Wiring test
- [x] 3.1 Add behavioural wiring test with a REAL DbContext + seeded Output, driving propose and PUT contents (D5)
- [x] 3.2 Mutation-prove it (green; propose-arg-only removal red; contents-arg-only removal red; restore green; paste each)

## 4. Gates
- [x] 4.1 `cd backend && nice -n 19 sbt testFull` green (name any known flake)
- [x] 4.2 Update openspec spec delta/docs if behaviour text changes; commit

## Standing Constraints
