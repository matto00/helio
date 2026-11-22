## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 37953d7ebe5e8b115295144738f9d4d509ff9c21 against a live-resolved base 4f57c50019253cfd763ef7374b81733ec4e948ec
(`resolve-review-base.sh`, exit 0). Scratch outputs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1797/skeptic/`.

### What I verified (with evidence)

**AC1: `removedPlacementCount` removed, consumers and schema handled.**
- `git grep`-equivalent over the whole tree (excluding `.git`) finds `removedPlacementCount` only in archived changes and in this
  change's own artifacts. There are no hits in `frontend/`, `helio-mcp`, `schemas/`, `e2e` or `openspec/specs`. The undo response
  schema already makes `resultingState` optional, so it needs no schema edit.
- `PatchSetUndoService.scala:130`: the step create-undo is now
  `restoreCreateUndo(edit, id => pipelineService.deleteStep(...).map(_.map(_ => ())))`. Its missing-newId string
  `edit N (${targetKind} ${op}): journal is missing its captured newId` renders exactly as the old hand-written
  `edit N (pipelineStep create): ...`. A delete failure still goes through `restoreFailed`. Both strings are byte-identical.
- Red first, reproduced by me: I restored the pre-removal `PatchSetUndoService.scala` (`663fd93d6^`) under the HEAD tests and
  ran `PatchSetUndoRoutesSpec` + `PatchSetUndoLaneSpec`. Exit 1, with 2 failures:
  `Some({"removedPlacementCount":0}) was not equal to None (PatchSetUndoLaneSpec.scala:138)` and the seam test
  `true was not equal to false (PatchSetUndoRoutesSpec.scala:219)`, which is the "no `resultingState` key" assertion. After
  the revert, `git status` was clean. The seam test goes through the real route (`Post(.../undo) ~> routesFor`) and also checks
  the body against `patch-sets/patch-set-undo-response.schema.json`. (`seam-red.txt`)

**AC2: stale cascade comment.** `PatchSetUndoLaneSpec.scala:84-86` now describes the HEL-1720/HEL-1795 refusal and that no
count is reported. This matches what the test asserts (refused while bound, removed once the placement is gone).

**AC3: split without changing behaviour.**
- Split commit `aa4011c2b` touches only `PatchSetUndoRestorers.scala`, `PatchSetUndoService.scala` and an evidence file. No
  test file is changed, so no assertion changed in the split.
- Verbatim check: I diffed the old service's restorer block against the new file, ignoring whitespace. The only differences
  are the dropped `private` modifiers, the class/companion wrapper with imports, and the move of
  `missingPriorState`/`restoreFailed` into the companion. Every method body is identical. The logger and `restoreAll` stay in
  the service.
- Sizes: service is 232 lines (was 426) and restorers is 199.
- The executor's records show 261 tests before the split and 261 after it, in 4 shards, all green. The only later changes are
  +3 new tests (seam + 2 guards), giving 264.

**Fresh re-run (my own, lane DB `helio_hel1797`, `nice -n 19 sbt -J-Xmx3g`, 5 shards, each exit 0).** The executor's 32-suite
undo set plus 20 more specs that construct `PatchSetApplyService`/undo fixtures (preview, grant, routes, stale-check,
pipeline-create, `ProposalDryRunParitySpec` and others). I added those because the apply loop changed, and the executor's set
did not include them. Totals: 122 + 86 + 56 + 76 + 188 = **528 tests, 0 failed**. (`shard00..04.txt`)

**Driver-added tidy items.**
- dataSource create arm: the 290-character line is now `deleteCreatedDataSource`, with the same expression.
- `ConcurrentHashMap`: replaced by an immutable map threaded through `loop` exactly like `children`, returned in the `Right`
  tuple and passed to `journalSuccess`. `Option(map.get(i))` became `map.get(i)`, which is equivalent. The failure branch never
  read it. The apply specs above are green.
- The warning now names roots. `doomedOutputIds` arrows are aligned.
- `describeRoot` comment: verified. The only `CREATE POLICY ... ON data_sources` is `data_sources_owner` (V35:43), and no
  migration defines a data-source grant or share table. Owned equals readable, so the comment is true.

**Guards: pass on current code, and each one fails under mutation (reproduced by me, each reverted, `git status` clean).**
- (a) I dropped `|| refs.panels.nonEmpty` in `PatchSetUndoDatasetLaterWork.scala:67`. Exit 1, and exactly the new form-panel
  guard failed (15 passed, 1 failed). (`mut-a.txt`)
- (b) I changed `case Some(ids) => false` in `PatchSetUndoLaterChildren.scala:71`. Exit 1, with 8 failures including the new
  "excuse the inline roots ... (guard)". As the design-gate round 2 noted, the existing clean-undo test also fails under this
  mutation. The new guard is not a duplicate: it asserts the blocker set directly over 3 roots with `appliedAt = EPOCH`, so the
  timestamp fallback cannot excuse the roots. (`mut-b.txt`)

**Spec delta.** `openspec validate tidy-patchset-undo-service --strict` prints "Change ... is valid". REMOVED names the exact
canonical heading (`openspec/specs/patch-set-lane-edits/spec.md:36`). The ADDED requirement matches the shipped behaviour
(no `resultingState`, refusal rules delegated to `patch-set-undo`).

**Other.** `node scripts/check-scala-quality.mjs` is clean (soft warnings only). No UI is touched, so section 4 does not apply.
The evaluator's claims (evaluation-1.md) are consistent with everything I measured independently.

### Verdict: CONFIRM

### Non-blocking notes
- `PatchSetUndoService.scala:130` (the new `pipelineStep` create arm) is 190 characters. That is shorter than the 290-character
  line it replaced and about as dense as its sibling arms, but a named helper like `deleteCreatedDataSource` would read better.
- The executor's D4 "undo spec set" left out about 20 `PatchSetApplyService`-constructing specs. They are all green in my run,
  so this changes nothing here, but a future enumeration should include them whenever the apply service is touched.
- As already noted in files-modified.md, the `PipelineStepRepository.deleteInternal` doc still calls its `Option[Int]`
  `removedPlacementCount`. This is internal and out of scope, and belongs in a PR note.
