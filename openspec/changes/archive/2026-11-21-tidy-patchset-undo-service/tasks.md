## Standing Constraints

## 1. Backend — baseline and split

- [x] 1.1 Enumerate the undo spec set (design D4), run it in sub-600 s shards on the lane DB, commit list + output (.txt) with counts under `evidence/`
- [x] 1.2 Split `PatchSetUndoService` per design D2 (no test file touched); verify compile + same count, all green; commit the after-record
- [x] 1.3 Tidy per design D3 (dataSource arm wrap, immutable dataset map, warning text, arrows, describeRoot comment after verifying data-source sharing); verify the undo + apply specs stay green

## 2. Backend — removedPlacementCount

- [x] 2.1 Red first: change `PatchSetUndoLaneSpec` line-138 assertion to `resultingState shouldBe None` and add the route-level seam assertion (design D1); record both failing on current code
- [x] 2.2 Remove `removedPlacementCount` + `countPlacementsForStep` keeping failure strings byte-identical; verify 2.1 goes green and the set stays green
- [x] 2.3 Correct the `PatchSetUndoLaneSpec` 84-86 comment and the restorePipelineStepCreate doc; verify by reading

## 3. Tests — guards

- [x] 3.1 Add guard (a) per design D5(a): form panel on an inline root with a later row → undo succeeds, source kept; record pass + mutation red
- [x] 3.2 Record existing sourceId-root tests, add guard (b) per design D5(b) for inline roots; record pass + `Some(ids) => false` mutation red
- [x] 3.3 Final full undo spec set run; commit record; `git diff --stat` shows backend + change dir only
