# Red / mutation evidence (HEL-1236)

## RED on unmodified logic (JoinColumnCollisionSpec, helper absent)
```
[info] - should keep the left value under the original name and surface the right value as right_<name> *** FAILED ***
[info]   List(Map("id" -> "1", "cnt" -> 99)) was not equal to List(Map("id" -> "1", "cnt" -> 10, "right_cnt" -> 99)) (JoinColumnCollisionSpec.scala:71)
[info] - should rename every colliding column, deterministically *** FAILED ***
[info]   List(Map("id" -> "1", "a" -> 10, "b" -> 20, "c" -> 30)) was not equal to List(HashMap("a" -> 1, "id" -> "1", "b" -> 2, "c" -> 30, "right_a" -> 10, "right_b" -> 20)) (JoinColumnCollisionSpec.scala:77)
[info] - should never overwrite a pre-existing right_<name> column on the left *** FAILED ***
[info]   List(Map("id" -> "1", "cnt" -> 3, "right_cnt" -> 2)) was not equal to List(Map("id" -> "1", "cnt" -> 1, "right_cnt" -> 2, "right_cnt_2" -> 3)) (JoinColumnCollisionSpec.scala:83)
[info] - should never land a rename on a real right-side column named right_<name> *** FAILED ***
[info]   List(Map("id" -> "1", "cnt" -> 3, "right_cnt" -> 4)) was not equal to List(Map("id" -> "1", "cnt" -> 1, "right_cnt_2" -> 3, "right_cnt" -> 4)) (JoinColumnCollisionSpec.scala:89)
[info] - should left join: a matched row carries both values; an unmatched row keeps the left value *** FAILED ***
[info]   List(Map("id" -> "1", "cnt" -> 99), Map("id" -> "2", "cnt" -> 20)) was not equal to List(Map("id" -> "1", "cnt" -> 10, "right_cnt" -> 99), Map("id" -> "2", "cnt" -> 20)) (JoinColumnCollisionSpec.scala:95)
[info] - should keep the left value and surface the right value as right_<name> *** FAILED ***
[info]   List(Map("id" -> "1", "cnt" -> 99)) was not equal to List(Map("id" -> "1", "cnt" -> 10, "right_cnt" -> 99)) (JoinColumnCollisionSpec.scala:106)
[info] - should project the left column unchanged and the right column as right_<name> *** FAILED ***
[info]   Vector("id", "cnt") was not equal to Vector("id", "cnt", "right_cnt") (JoinColumnCollisionSpec.scala:112)
[info] Tests: succeeded 0, failed 7, canceled 0, ignored 0, pending 0
[info] *** 7 TESTS FAILED ***
```

## MUTATION (prefixing disabled in JoinColumnNaming.resolve: chosen = col, keyDropped = false)
```
[info] Tests: succeeded 135, failed 41, canceled 0, ignored 0, pending 0
[info] *** 41 TESTS FAILED ***
failing test lines: 42
```

## Full gate (cd backend && nice -n 19 sbt testFull)
```
[info] Suites: completed 371, aborted 0
[info] Tests: succeeded 5371, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] elapsed time: 371 s (0:06:11.0), cache 34%, 138 disk cache hits, 263 onsite tasks
exit 0
```
