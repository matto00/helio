## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 6d298d5f83a56041188fb619bb0fd4ad333bb9ca (= BASE; origin/main is still 6d298d5f8 after a fetch, and the change dir is untracked). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/split-patchset-apply-resolvers/HEL-1479`.

### What I verified (with evidence)

**Round-1 CR1 (HEL-1480 overlap): addressed by D7 and task 3.8.**
- I read HEL-1480's design.md read-only at `.claude/worktrees/task/pipelineservice-split-followups/HEL-1480/openspec/changes/pipelineservice-split-followups/design.md`.
  - Its D2 confirms that its ONLY edit to `PatchSetApplyResolvers.scala` is the :178 doc line. Its widened sweep explicitly fences the rest of that file.
  - Its D3 edits `ExistenceNotLeakedRoutesSpec` `sites` for pipeline-step and analyze rows only. It explicitly does not touch any `PatchSetApplyResolvers.scala` row, `patchKindExemptions` or `expectedForbiddenProducers`. So it cannot disturb D1's pin resolution.
- HEL-1480 has no commits yet: its HEAD is 6d298d5f8 and only its change dir is untracked.
- D7 covers everything round 1 asked for:
  - (a) BASE comes from one variable, and each evidence file states its SHA.
  - (b) If HEL-1480 merges first: merge origin/main in, apply HEL-1480's :178 text inside the moved block, re-pin BASE to the merge-base, and regenerate D6a and D6b. Re-run `ExistenceNotLeakedRoutesSpec` plus the patchsets specs. Re-run full `testFull` against a re-baselined BASE if non-comment backend code changed. HEL-1480 adds tests and deletes dead code, so this condition will trigger, and that is correct.
  - (c) If this change merges first: relay the :178 location (`PatchSetPipelineStepResolvers.scala`) to the HEL-1480 lane.
- The "silent revert" risk is now closed mechanically, not just by policy. After the re-pin, D6a's forward check compares the moved block against the NEW BASE text. A resolution that reverted to the old text would fail it.
- The conflict cannot auto-merge silently either. This branch removes the :175-227 hunk that HEL-1480 modifies, so git will report a conflict.
- No other live lane touches the file. Of the other worktrees, `matt-audit-repo` (666db9f87) is a stale ancestor of main with no local changes, and HEL-1465 does not touch these files.

**Round-1 CR2 (factual corrections): addressed.**
- (a) `grep -n 'PatchSetApplyResolvers.scala'` on the spec gives 12 `Row(` lines (412, 421, 423, 429, 431, 433, 435, 437, 440, 442, 444, 446) plus :498 and :529. The Context now says 12. A leftover "13" remains in Planner Notes (see the non-blocking notes).
- (b) D1 now gives the true reasons:
  - `authorizeEditorOnDashboard` is called only by the panel resolvers and is kept here for producer :108 and the :106 call.
  - `requireVisibleStep` is kept for locality next to `authorizeEditorOrOwnerOnPipeline`. That reasoning holds: `resolvePipelineStepCreate` needs that helper widened anyway.
- (c) `PatchSetUndoService.scala:245-246` is now in the Context list and in task 3.7. My `grep` of `PatchSetApplyResolvers` across `backend/src` finds no other prose mention of a MOVED member. The remaining hits name the object, `resolveAll` or `resolveDashboardUpdate`, all of which stay.
- The round-1 non-blocking note (wildcard rule vs the file-level `import PatchSetApplyServiceJson._`) is resolved explicitly in D3.

**Whole-design re-check (not just the deltas).**
- **Pins re-derived at BASE.**
  - `Forbidden(` code lines are exactly :108, :126, :356 and :388. `requireAccess(` is called at :106 and :354.
  - The file has 18 `case ("` dispatch lines.
  - I read the spec's guard implementations (:475-500):
    - `codeLines` drops comment and doc lines.
    - `forbiddenProducerCounts` keys on the file name and excludes `Forbidden(_)`.
    - `helperCall` is `\b(requireOwnerOnly|requireAccess|authorizeResourceWithSharing|authorizeResource)\(` and skips `def` lines.
    - `patchSetDispatchPairs` is `.find(...).get` on the file name.
  - The D1 layout keeps all six sites and every dispatch line in the same file. The new scaffold lines (`import PatchSetResolverSupport.{...}`, `private[patchsets] object ...`) match none of these regexes, and no moved body contains a producer, a helper call or a quoted tuple case.
  - D6f's four scratch mutations each hit a real mechanism of these functions.
- **Dependencies.** The dashboard resolvers (339-413) call only `requireTargetId`, `decodeCreatePatch` and their own `buildDashboardUpdateResolved`. That matches D3's import list for the kept object. `resolveEdit` dispatches to exactly 14 non-dashboard `resolve<Kind><Op>` members (panel 3, dataSource 3, pipeline 3, pipelineStep 3, output 2). With the 5 support helpers that gives the 19 widenings D2 and Risks claim.
- **Size.** The kept file is roughly 1-49 + 51-92 + 95-152 + 339-413 + scaffold, about 240-260 lines, so the "~250" claim is plausible.
- **Round 1's other checks still stand.** I re-checked the parts this round's edits could have changed: the block inventory, implicit and name resolution, the bytecode argument and D6 sufficiency. D1 and D2 assign the same blocks as in round 1, and D6 is unchanged apart from the BASE variable.
- **No placeholders or contradictions** affect implementation. Tasks 1.x-3.8 map onto D1-D7. AC1-AC7 are each covered:
  - AC1: D1/D2, tasks 2.x
  - AC2: D6a, task 3.1
  - AC3: D6b, task 3.2
  - AC4: D6e, tasks 1.2 and 3.6
  - AC5: D6d, task 3.4
  - AC6: D1 + D6f, task 3.5
  - AC7: D6c + task 3.7

### Verdict: CONFIRM

### Non-blocking notes
- design.md Planner Notes still says "the spec pins exist as described except 13 rows, not ~15", which contradicts the corrected Context ("12 route rows"). The Context is authoritative and correct (12). Fix the stray "13" when convenient.
- If D7's merge-first path is taken, re-run D6f's four guard red runs after the reconcile as well. HEL-1480's `sites` edits do not change the guard mechanics, but re-running them is cheap and keeps AC6's evidence on the final BASE.
- No gate defects. No mtime-ordered evidence was relied on.
