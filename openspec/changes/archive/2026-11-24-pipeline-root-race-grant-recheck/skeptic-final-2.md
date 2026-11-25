## Skeptic Report — final gate (round 2, skeptic-final-2.md)

I reviewed HEAD `add99997c7accbdb42ec9d59fed4780ac9ac283d` against the live-resolved base `737adb3525afa48d2f75576f948221910b732f8d`
(`resolve-review-base.sh main origin`, exit 0). The change is backend-only with no UI, so step 4 does not apply and I started no servers.
Scratch outputs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1707/skeptic-final-2/`.

### What I verified (with evidence)

**Nothing in production changed after round 1.** `git diff --stat f0d21c75b HEAD -- backend/src/main` is empty. Commit add99997c
touches only `OutputDeleteCurrentAccessRlsSpec.scala` (a rename, a comment, and the case moved into the guard block), m15/m16
evidence, `files-modified.md`, `evaluation-2.md` and `skeptic-final-1.md`. No migration was added; the latest is still V148.

**I re-read the production diff myself.** I read `PipelineWriteAccess`, `PipelineWriteRefusal`, `PipelineRootRepository`,
`OutputRepository` and `OutputService` cold:
- `currentAction` is a plain read on the privileged connection: owner, or a `resource_permissions` row with role `editor`.
- `requireAction` comes right after `lockPipelines` at root add and in both Output delete paths.
- Root add uses `.headOption`, and a `false` lock result raises `PipelineGone`. Both are fixes for item 1.
- A refusal maps to 403 for a viewer and to the route's not-found otherwise. Output delete maps it to `404 Output not found`.

**Round-1 change request 1 is addressed, and I re-ran the evidence myself.** I used a throwaway detached worktree at HEAD and
removed it afterwards (`git worktree list | grep -c skeptic` returns 0). The spec under test is `OutputDeleteCurrentAccessRlsSpec`.

- (a) Done. Line 38 is now `"GUARD: refuse (404, nothing deleted) a creator whose grant was fully revoked"`. It sits in the
  `// GUARDS (green on main)` block, with a comment saying it was already 404 on main through the RLS-scoped `findById`, and
  that the R2 re-check is only a second detector there.
- (b) Done. I re-ran all three mutations rather than trusting the recorded files, because `evidence/mutation-m15-*.txt` is only
  2 lines.

  | Run | Mutation | Result | Output file |
  | --- | --- | --- | --- |
  | Unmutated | none | 6 passed, 0 failed, exit 0 | `baseline.txt` |
  | m15 | only the `delete` read changed from `findById(id, user)` to `findByIdInternal(id)` | 6 passed, 0 failed, exit 0 | `m15-rerun.txt` |
  | m10 | only the two R2 `requireAction` calls replaced with `DBIO.successful(())` | 4 passed, 2 failed | `m10.txt` |
  | m16 | m15 and m10 together | 3 passed, 3 failed | `m16.txt` |

  - **m15:** sbt reused cached compile output (it reported a 100% disk-cache hit), so I checked the compiled class. Running
    `javap` on the compiled `OutputService.class` shows `delete(...)` calling `OutputRepository.findByIdInternal`, so the
    mutation was really in effect when the tests ran green.
  - **m10:** the downgraded-viewer delete case fails with `200 OK was not equal to 404`, and the undo case fails with
    `Vector("restored") was not equal to Vector("failed")`. The revoked-creator GUARD stays green.
  - **m16:** the revoked-creator GUARD now fails as well: `200 OK was not equal to 404 Not Found (...Spec.scala:43)`.

  Together these show the GUARD fails only when both mutations are applied, which is what the comment claims. The recorded
  m15, m10 and m16 files match my runs exactly.
- (c) Done in `files-modified.md` (the "Final-gate fix" paragraph). The PR body does not exist yet; the orchestrator must carry
  that statement into it at delivery.

**The new and extended specs pass at HEAD.** I ran the 4 spec files unmutated: `OutputDeleteCurrentAccessRlsSpec`,
`PipelineRootEditorGuardsRlsSpec`, `PipelineGrantRecheckRaceSpec` and `PipelineRootWriteGrantsSpec`. Result: exit 0,
`succeeded 35, failed 0` (`head-new-specs.txt`). That matches round 1. Round 1's fresh runs of the broader suites (shard1: 340 passed;
shard2: 315 passed) were against identical production code, so I did not repeat them.

**Acceptance criteria trace:**
- **(1) Met.** `PipelineGrantRecheckRaceSpec` cases 1a and 1b use the `RaceLocks` hook, with no sleeps. The red run on main and
  mutations m1a/m1b were independently reproduced in round 1, and the production code they cover has not changed since.
- **(2) Met.** The enumeration is `.concertino/runs/HEL-1707/evidence/editor-privileged-write-enumeration.md`, and the scope
  ruling was Q1=A. The re-check is at every ruled site, with mutations m2-m10.
- **(3) Met.** `PipelineRootEditorGuardsRlsSpec` is labelled GUARD. Mutations m11 and m13 make it fail; m12 alone stays green and
  is recorded as such.
- **(4) Met.** `PipelineRootWriteGrantsSpec` has GUARD cases for UPDATE on `panels` and EXECUTE on `hel1629_lock_pipelines`
  (m14).
- **No migration**, as required.

### Verdict: CONFIRM

### Non-blocking notes
- The PR body must say three things:
  - A creator whose grant was fully revoked already got a 404 on Output delete before this change.
  - The only visible R2 change is that a creator downgraded to viewer can no longer delete the Output or undo its creation.
  - Reorder and step create on a pipeline deleted mid-request now answer 404, where before they gave a 422 or a database error.
- The m15 evidence file records only the summary line. That is enough now that it has been reproduced and checked against the
  compiled bytecode above.
- Gate-defect check: no report in this chain relies on file timestamps (mtimes) to show the order of events.
