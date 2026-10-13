## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `cace9cf07959fbdb41537246214c6e16da5bc096`. I reviewed the cycle-2 delta (`f853b0f3d..cace9cf07`) against the evaluation-1 change requests. The diff base is unchanged (`62164029270bcaadfc0fde2b0f43263cd1314b03`).

### Phase 1: Spec Review — PASS

- **CR1 (union message names every colliding field): fixed.** `MultiInputSchemaInference.timestampNumberCollision` now collects every qualifying collision. It emits one message that lists each one as `'name' (parentType vs secondaryType)`. This matches the spec delta: "SHALL name every such field and both of its types". The single-collision RED tests still assert `ts`, the parent type and the secondary type, and they pass.
- **Red evidence for CR1, re-checked.** The cycle-2 red in `red-evidence.md` was run against the old `.headOption` code. That code also had the old message format, so the test fails on the very first substring (`'ts' (timestamp vs integer)`). It would have failed even if the old code had named every field. On its own, that evidence does not show the test guards "every field". I closed the gap with the proper mutation: I kept the new message format and limited it to the first collision (`collisions.take(1)`). The new test went red for exactly the right reason: it included `'ts' (timestamp vs integer)` but not `'n' (float vs timestamp)` (`TimestampNumberParitySpec.scala:154`, 1 failed / 32 succeeded, `[hel1468-guard]` present). Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1491/evidence/openspec/changes/timestamp-type-fillnull-union/.eval2-mut.txt`. I restored the mutation afterwards.
- **C1–C4 still honored.**
  - C2: there is no change to `FillNullStep`/`UnionStep` in the delta.
  - C3: the mutation evidence is now committed, as `mutations.md`.
  - C4: no inline FQN in the diff, and `[hel1468-guard]` appears in every run.

### Phase 2: Code Review — PASS

- **CR2 (inline FQN): fixed.** `import scala.util.Try` is at the top of `StepSchemaInference.scala`, and line 73 uses `Try(...)`. `check:scala-quality` is clean. A pre-existing `scala.util.Try` at `MultiInputSchemaInference.scala:107` is not part of this diff and is out of scope.
- **CR3 (mutation evidence untracked): fixed.** `mutations.md` is tracked and in the commit, and `files-modified.md` is updated.
- **Gates.** I ran targeted `testOnly` on the same 20 suites as cycle 1:
  - Result: 684 succeeded, 0 failed, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1491/evidence/openspec/changes/timestamp-type-fillnull-union/.eval2-run.txt`.
  - `prettier --check` passes on the docs file and the change dir.
  - I did not run a full `testFull`: the delta is confined to one analyze helper, one import and one test, and the machine-wide cap applies.

### Phase 3: UI Review — N/A

No UI trigger paths changed.

### Docs

- **CR4: fixed.** `docs/compute-expression-grammar.md:368-371` now says the projected type is unchanged: the parent lane's type for a union, and the input type for fillnull. It scopes the `$ts + ...` consequence to a timestamp column. It also states the reverse-union consequence: the projection stays numeric while timestamp strings arrive. This is accurate.
- **Guard rename (cycle-1 suggestion): done** (`TimestampNumberParitySpec.scala:173`).

### Overall: PASS

### Non-blocking Suggestions

- `mutations.md`:
  - The M3 entry still quotes the old test name, "a collision that does not share a name".
  - The M5 entry points at the cycle-2 red in `red-evidence.md`. That red was a message-format failure, not a first-field-only one. Consider recording the real M5 (keep the new format, `collisions.take(1)`), which I reproduced above.
- M6 says a write-time mutation is "not mechanically applicable". A mutation that makes `rawConfigProblem` reject `mean` outright would still turn the save-path guard red. This is optional.
