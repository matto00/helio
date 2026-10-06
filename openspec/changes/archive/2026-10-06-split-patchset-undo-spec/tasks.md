## Standing Constraints

## 1. Baseline

- [x] 1.1 On the unmodified branch, run `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly com.helio.services.patchsets.PatchSetUndoServiceSpec"` (Bash timeout 600000; then `sbt --client shutdown` as a separate call) and record the succeeded count (expect 19) — verify: count captured in split-equivalence.md

### Backend

## 2. Split

- [x] 2.1 Create `PatchSetUndoServiceFixture.scala` (trait, D2) with the fixture moved verbatim (`private`→`protected`) — verify: compiles
- [x] 2.2 Create `PatchSetUndoPanelDashboardSpec.scala` with the five D1 panel/dashboard tests moved verbatim — verify: testOnly passes 5
- [x] 2.3 Create `PatchSetUndoLaneSpec.scala` with the five D1 lane tests moved verbatim — verify: testOnly passes 5
- [x] 2.4 Create `PatchSetUndoRefusalSpec.scala` with the five D1 refusal tests moved verbatim — verify: testOnly passes 5
- [x] 2.5 Create `PatchSetUndoRepoWiringSpec.scala` with both HEL-1256 blocks + `undoServiceWithoutOutputRepo` — verify: testOnly passes 4
- [x] 2.6 Delete `PatchSetUndoServiceSpec.scala` — verify: `git ls-files` no longer lists it; no file over ~400 lines
- [x] 2.7 Update the D7 comment pointers (Routes:44, Inverse:19, ApplyService:186,290; Hel914Ac1EndToEndSpec:63 carved out) — verify: `grep -rn PatchSetUndoServiceSpec backend/src` hits only Hel914Ac1EndToEndSpec.scala:63

### Tests

## 3. Equivalence and gates

- [x] 3.1 Run the D5 mechanical checks 1-4 (names, body-scoped assertion multiset, per-test body, fixture diff with only the enumerated allowed deltas) against the base — verify: all diffs empty, recorded in split-equivalence.md
- [x] 3.2 Run `testOnly` of the four new suites (same env/timeout/shutdown rules as 1.1) — verify: 19 succeeded total, recorded in split-equivalence.md
- [x] 3.3 Run `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` — (Bash timeout 600000; `sbt --client shutdown` separately) — verify: green, including RouteTestBaseGuardSpec
