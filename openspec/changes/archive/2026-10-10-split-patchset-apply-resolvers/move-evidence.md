# Move evidence (HEL-1479, D6a/D6c/D6f)

Regenerated in cycle 2 against `BASE=55b53be4a` (`git merge-base HEAD origin/main` after merging HEL-1480, merge commit `46c0ba9b4`; D7 protocol: the one-line `validateEmbeddedStepReferences` doc edit of HEL-1480 at BASE line 178 is inside the moved block in `PatchSetPipelineStepResolvers.scala` lines 22-23, verified; BASE is now 854 lines, so every BASE span after line 178 shifts by one versus the superseded `6d298d5f8` set kept in `move-check/superseded-6d298d5f8/`). Every
script under `move-check/` takes `BASE` and `W` as environment variables (D7); nothing hard-codes the SHA.

## Files

- `PatchSetApplyResolvers.scala` (kept, 233 lines): object doc + header, `resolveAll`, `resolveEdit` (dispatch text unchanged),
  the four dashboard resolvers, closing brace, then a second top-level `private[patchsets] object PatchSetResolverSupport`
  with the five shared helpers (D1).
- New, each a `private[patchsets] object`: `PatchSetPanelResolvers` (131), `PatchSetDataSourceResolvers` (77),
  `PatchSetPipelineResolvers` (142), `PatchSetPipelineStepResolvers` (264), `PatchSetOutputResolvers` (85).
- `services/patchsets/README.md`: "Holds" list gains the five new object names (alphabetical).

No dependency the design inventory missed: the generator's cross-destination reference scan (`gen.py --report`) reports
exactly the 19 widenings design.md names (5 support helpers + 14 dispatched resolvers) and no other cross-object reference.
No member was moved away from its D1/D2 destination; no receiver-qualified call was needed (all cross calls use named member imports).

## D6a inventory (every non-blank BASE line 20..854 is claimed exactly once)

| BASE span | block | destination | declaration widened to `private[patchsets]` |
|---|---|---|---|
| 20-32 | `object-doc-and-header` | `PatchSetApplyResolvers` | no |
| 34-49 | `resolveAll` | `PatchSetApplyResolvers` | no |
| 51-92 | `resolveEdit` | `PatchSetApplyResolvers` | no |
| 95-99 | `requireTargetId` | `PatchSetResolverSupport` (in `PatchSetApplyResolvers.scala`) | yes |
| 101-110 | `authorizeEditorOnDashboard` | `PatchSetResolverSupport` (in `PatchSetApplyResolvers.scala`) | yes |
| 112-128 | `authorizeEditorOrOwnerOnPipeline` | `PatchSetResolverSupport` (in `PatchSetApplyResolvers.scala`) | yes |
| 130-142 | `requireVisibleStep` | `PatchSetResolverSupport` (in `PatchSetApplyResolvers.scala`) | yes |
| 144-152 | `decodeCreatePatch` | `PatchSetResolverSupport` (in `PatchSetApplyResolvers.scala`) | yes |
| 154-166 | `pipelineSummaryResponse` | `PatchSetPipelineResolvers` | no |
| 169-173 | `standalone-HEL-904-comment` | `PatchSetPanelResolvers` | no |
| 175-228 | `validateEmbeddedStepReferences` | `PatchSetPipelineStepResolvers` | no |
| 231-258 | `resolvePanelUpdate` | `PatchSetPanelResolvers` | yes |
| 260-283 | `resolvePanelDelete` | `PatchSetPanelResolvers` | yes |
| 285-310 | `resolvePanelCreate` | `PatchSetPanelResolvers` | yes |
| 313-338 | `rejectUnboundOrBadlyBoundForm` | `PatchSetPanelResolvers` | no |
| 340-361 | `resolveDashboardUpdate` | `PatchSetApplyResolvers` | no |
| 363-372 | `buildDashboardUpdateResolved` | `PatchSetApplyResolvers` | no |
| 374-397 | `resolveDashboardDelete` | `PatchSetApplyResolvers` | no |
| 399-414 | `resolveDashboardCreate` | `PatchSetApplyResolvers` | no |
| 417-440 | `resolveDataSourceUpdate` | `PatchSetDataSourceResolvers` | yes |
| 442-461 | `resolveDataSourceDelete` | `PatchSetDataSourceResolvers` | yes |
| 463-477 | `resolveDataSourceCreate` | `PatchSetDataSourceResolvers` | yes |
| 482-512 | `resolvePipelineUpdate` | `PatchSetPipelineResolvers` | yes |
| 514-537 | `resolvePipelineDelete` | `PatchSetPipelineResolvers` | yes |
| 539-543 | `prefixedWithEdit` | `PatchSetPipelineResolvers` | no |
| 545-591 | `resolvePipelineCreate` | `PatchSetPipelineResolvers` | yes |
| 594-633 | `resolvePipelineStepUpdate` | `PatchSetPipelineStepResolvers` | yes |
| 635-670 | `resolvePipelineStepDelete` | `PatchSetPipelineStepResolvers` | yes |
| 672-702 | `buildPipelineStepDeletePriorState` | `PatchSetPipelineStepResolvers` | no |
| 704-754 | `resolvePipelineStepCreate` | `PatchSetPipelineStepResolvers` | yes |
| 756-783 | `authorizeSecondSourceForCreate` | `PatchSetPipelineStepResolvers` | no |
| 785-785 | `standalone-output-section-comment` | `PatchSetOutputResolvers` | no |
| 787-799 | `findOwnedOutput` | `PatchSetOutputResolvers` | no |
| 801-828 | `resolveOutputUpdate` | `PatchSetOutputResolvers` | yes |
| 830-853 | `resolveOutputDelete` | `PatchSetOutputResolvers` | yes |
| 854-854 | `object-close` | `PatchSetApplyResolvers` | no |

Scaffold lines (the only non-moved lines), tagged by D3 category and listed in `move-check/spec.json`:
`package`/`imports` (pruned per file; each file keeps `import PatchSetApplyServiceJson._` exactly as BASE has it),
one-line `object-doc`, `object-scaffold` (`private[patchsets] object X {` and the closing `}`), named `member-import`
lines. The checker output (`move-check/check-green.txt`) gives the per-file scaffold/moved/substituted counts.

## Checker (forward, reverse, coverage, block rule)

`move-check/check.py` (adapted from HEL-1463's): forward (each block's BASE text equals its destination text, only the
declared `private` -> `private[patchsets]` substitutions), reverse (each non-blank line of the six files is consumed
positionally by the next expected block or tagged scaffold line), coverage (all 792 non-blank BASE lines 20..854 claimed once),
block rule (no doc split from its member). Green run: `move-check/check-green.txt` (PASS; 36 blocks; unclaimed 0; multiply-claimed 0; BASE=55b53be4a).
Red runs on scratch copies: `move-check/red-runs.txt`:
- RED 1: `NotFound(` -> `Conflict(` inside `PatchSetOutputResolvers.findOwnedOutput` -> forward FAIL naming base line 796.
- RED 2: a duplicated `  }` inserted before the final brace of `PatchSetPanelResolvers` -> reverse FAIL (scaffold mismatch + UNACCOUNTED line).

## Grep guards (D6c) — `guard-evidence.txt`

No new file contains a `ServiceError.Forbidden(` or access-helper code line; the kept file has exactly 4 producer code
lines, 2 `requireAccess(` code lines and all 18 `case ("kind", "op")` dispatch lines (BASE: 18); no inline FQN outside
import/package lines in any of the six files; `npm run check:scala-quality` exits 0 ("clean", soft warnings only); the one soft warning among the six files is `PatchSetPipelineStepResolvers.scala` (264 lines, soft budget 250, accepted in design.md Risks); BASE's single 854-line file warning is gone.

## ExistenceNotLeakedRoutesSpec pins (AC6/D6f)

Resolution: the ticket's first branch. The dispatch, all four Forbidden producers and both `requireAccess(` calls stay in
`PatchSetApplyResolvers.scala`; the spec is NOT edited (zero diff under `backend/src/test`). Each guard is shown still failable
after the split (scratch edits via `move-check/guard-mutate.py`, reverted; BASE=55b53be4a, re-run in cycle 2 after the merge; logs `.concertino/runs/HEL-1479/evidence/guard-G*.log`, GREEN `guard-GREEN.log`):

| # | Scratch edit | Result |
|---|---|---|
| G1 | add `private def hel1479Probe = ServiceError.Forbidden()` to `PatchSetOutputResolvers` | `pin the per-file count of ServiceError.Forbidden producers` FAILED; the printed actual map now has `"PatchSetOutputResolvers.scala" -> 1` |
| G2 | change the Viewer `Left(ServiceError.Forbidden())` in `PatchSetResolverSupport.authorizeEditorOnDashboard` to `Conflict(...)` | same test FAILED; actual map shows `"PatchSetApplyResolvers.scala" -> 3` |
| G3 | add a non-`def` code line `ctx.accessChecker.requireAccess(...)` to `PatchSetPanelResolvers` | `name every source file that calls a shared access helper` FAILED: `HashSet("PatchSetPanelResolvers.scala") was not empty` |
| G4 | add `case ("panel", "rename") => ...` to `resolveEdit` | `cover every (kind, op) the patch-set resolvers dispatch` FAILED: `HashSet("panel:rename") was not empty` |
| G5 | reverse-direction dispatch probe: delete the `case ("pipeline", "delete")` dispatch line from `resolveEdit` | `cover every (kind, op) ...` FAILED: `stale exemption/coverage entries no longer dispatched: HashSet("pipeline:delete") was not empty` |
| - | all reverted | `ExistenceNotLeakedRoutesSpec` GREEN: 61 passed, 0 failed (`guard-GREEN.log`) |

Honest note on G3 (cycle 1, BASE 6d298d5f8; log in `evidence/superseded-6d298d5f8/`): my first G3 attempt put the probe on a `def` line, which the guard deliberately ignores (it skips lines
containing `def `/starting `def `), so it stayed green . That is the guard's
documented definition-vs-call distinction, not a hole; the retried G3 (call on a non-def line) is red as shown.

## Follow-up candidates (none fixed here; C3/C4)

1. Stale positional words / doc links inside moved comments, left byte-identical (C4): the `validateEmbeddedStepReferences` doc
   (already corrected upstream by HEL-1480, now inside the moved block) is fine, but other moved comments still cite `PipelineService`
   internals that HEL-1463 relocated (see candidate 8); the `resolveEdit` comment "(added for `pipelineStep` create, above)" is unchanged and still true;
   the `resolvePipelineStepCreate` docs cite `authorizeEditorOrOwnerOnPipeline` and `resolvePipelineStepUpdate`, which now live in other objects;
   `// ── output (HEL-907 ...)` section comment now heads a file of only output resolvers.
2. Stale prose mentions of moved members (not edited): `PatchSetPreviewProjection.scala:355` (`PatchSetApplyResolvers.pipelineSummaryResponse`),
   `RefinementEditShapeSpec.scala:31` (`.resolvePipelineStepUpdate`/`validateEmbeddedStepReferences`), `PatchSetPreviewServiceSpec.scala:504`
   (`.validateEmbeddedStepReferences`), `PatchSetUndoService.scala:245-246` (`PatchSetApplyResolvers .buildPipelineStepDeletePriorState`).
3. D5: the four output rows in `ExistenceNotLeakedRoutesSpec` still name `PatchSetApplyResolvers.scala` as the access site while the owner
   check (`findOwnedOutput`) now lives in `PatchSetOutputResolvers.scala`. Documentary only (guard unaffected); spec is HEL-1480's.
4. `PatchSetPipelineStepResolvers.scala` is 264 lines, over the ~250 soft budget (accepted in design.md Risks).
5. HEL-1480 (D7): merged first; its one-line doc edit is inside the moved `validateEmbeddedStepReferences` block (`PatchSetPipelineStepResolvers.scala`); nothing further to relay.
6. Coverage observation: `PatchSetResolverSupport.requireTargetId`'s BadRequest message is not asserted by any existing spec (a Conflict mutation of it
   stayed green in the scoped run); the support object is instead covered by the `authorizeEditorOnDashboard` mutation (M1). Not a defect.
7. No behavioural defect was noticed in the moved code.
8. Stale `PipelineService` citations inside the moved resolver code (comments only; C4 forbids editing them here): moved docs and comments in the
   `PatchSet*Resolvers` files still point at `PipelineService.updateStep`/`addStep`/`deleteStep` internals that HEL-1463 split into collaborators.
   Candidate: a comment sweep ticket.
9. `PipelineProtocol.scala:60` cites `PipelineService.resolveInlineOrExistingRoot`, which no longer lives there (HEL-1463). Out of scope here.
