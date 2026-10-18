# Release exposure (HEL-1654)

$ git rev-parse v0.9.8^{commit}
29cb0a60f41e72b0a6b26c15a28360c504fffdb8

$ git merge-base --is-ancestor 544bd79ea v0.9.8; echo exit=$?
exit=1  (0 = ancestor, 1 = NOT an ancestor)

$ git ls-tree -r --name-only v0.9.8 | grep -c V137
0

$ git ls-tree -r --name-only v0.9.8 | grep -c DraftSaveDeadlockSpec
0

$ git tag --contains 544bd79ea
(empty = no release tag contains HEL-1629)

$ git ls-tree -r --name-only HEAD | grep V137
backend/src/main/resources/db/migration/V137__lock_pipelines_for_definition_writes.sql
backend/src/test/scala/com/helio/infrastructure/persistence/V137LockPipelinesMigrationSpec.scala
