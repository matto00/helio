## Standing Constraints

- [C1] Undo stays all-or-nothing: a blocking panel refuses the whole undo with 409 and restores nothing (owner ruling, HEL-1720 escalation).
- [C2] A refusal names only panels the undoing user can read (title + dashboard name); unreadable ones are only counted. No other tenant's titles, dashboard names or ids in the message or INFO+ logs (owner ruling).
- [C3] One shared bound-panels check covers the output, pipelineStep, pipeline and dashboard create arms; panels created by the same patch set never block; draft-save undo is HEL-1792, out of scope (owner ruling).
- [C4] Cross-user cases are proven on the non-BYPASSRLS app role helio_app_test; the cross-user panel is built through the real PanelService.duplicate path (premise correction, driver-confirmed).

## 1. Red test (before any behaviour decision)

- [x] 1.1 Two-user red spec. Premise correction (probe evidence: probe-b-cannot-bind.txt): an editor grantee cannot bind a panel to another user's Output through PanelService.create/update (PanelBindingChecks.rejectMissingOutput uses findByIdOwned). The reachable cross-user path is PanelService.duplicate: user B, an editor grantee on user A's dashboard, duplicates a panel bound to the created Output; the copy is owned by B (PanelMutationRepository.duplicate sets owner_id = B) and bound to A's Output. Spec: A applies a patch set creating an Output; A binds a panel to it (outside the set) on A's dashboard; B (editor on that dashboard) duplicates it; A undoes; assert B's panel still exists (red today). Services wired on helio_app_test (non-BYPASSRLS).
- [x] 1.2 Same-user variant: user A binds a NEW panel (not in the patch set) to the created Output after apply, then undoes. Assert the panel still exists (red today).
- [x] 1.3 Record the red run (failing assertions) under .concertino/runs/HEL-1720/evidence/ and commit the spec + red transcript before any implementation.

## 2. Shared bound-panels check (design D2, D3)

- [x] 2.1 Add the shared helper that computes doomed − excused panels for an edit and the full edit list (design D2), using internal reads for the doomed set. Verify with cases in the new spec: self-created panel excused, later panel never excused. (The panel-update excusal is not implemented: see design D2.)
- [x] 2.2 Build the blocker message (design D3): readable panels named as "<title>" on dashboard "<name>", unreadable ones counted, names and lookups capped at 10 with "+N more" (or one batched read). Verify with a test asserting an unreadable panel's title, dashboard name and id are absent from the 409 message, and that the Phase-2 failure reason (D4, logged at ERROR) is the fixed phrase plus a count.
- [x] 2.3 Wire the helper into PatchSetUndoConflictCheck for the output, pipelineStep, pipeline and dashboard create arms. Verify: the red tests in PatchSetUndoBoundOutputPanelsSpec go green, with the TODOs replaced by assertions that the undo returns a Conflict naming the panel and that the Output and every resource in the set are untouched.

## 3. Check-to-delete window (design D4)

- [x] 3.1 Output delete (design D4): inside deleteWithPanelsInternal's transaction, after lockForDeletion and lockPipelines, take `SELECT 1 FROM outputs WHERE id = O FOR UPDATE`, re-count bound panels (expected zero), and abort with a typed failure if any; the undo reports that edit failed and stops. Verify with a test where a SECOND connection has inserted a panel bound to the Output and not yet committed when the undo's delete runs (or a test seam between the re-count and the delete), then commits: assert the panel survives and the outcome is failed. Also confirm no deadlock against a concurrent draft save and a concurrent panel create (state how this was checked). If the lock cannot be taken safely, fall back to the documented residual and say so.
- [x] 3.2 pipelineStep/pipeline/dashboard: re-run the check immediately before each delete in Phase 2 and report failed if it is non-empty. The code comment cites V130's RESIDUAL paragraph for the remaining window (design D4). Verify by test.

## 4. Coverage of the other arms and the no-regression path

- [x] 4.1 Tests (helio_app_test): pipelineStep create undo, pipeline create undo and dashboard create undo each refuse when a panel the set did not create would be deleted, and nothing is restored. The pipelineStep tests include the descendant case: after the apply, a second child step is added under the set-created step, an Output is created on it and a panel is bound; undo is refused and the child step, Output and panel survive. For the dashboard arm, assert that the panel-naming blocker is present, not that it is the only one.
- [x] 4.2 Test: a patch set that creates an Output and a panel bound to it, with nothing else bound, still undoes successfully and removes both. Existing undo specs (PatchSetUndo*Spec, PatchSetOutputCreateSpec, PatchSetUndoLaneSpec, PatchSetRollbackLaneStepSpec) stay green.
- [x] 4.3 Unreadable-panel case through a real path if one exists (B creates an Output on A's pipeline and binds it on B's own dashboard, A undoes the pipeline create); otherwise drive the helper directly and say so in files-modified.md.
- [x] 4.4 Mutations, recorded in .concertino/runs/HEL-1720/evidence/: (a) drop the Phase-1 wiring → the red tests go red again; (b) drop the excusal of self-created panels → test 4.2 goes red; (c) drop the unreadable-count branch (name everything) → test 2.2 goes red; (d) narrow the pipelineStep doomed set to node_step_id = step only → the descendant test goes red; (e) drop the Output FOR UPDATE lock / in-transaction re-count → the 3.1 test goes red.
- [x] 4.5 Re-read helio-mcp undo_patch_set's description (helio-mcp/src/tools/refinement.ts) and the web undo toast error path; confirm in files-modified.md that both stay accurate with no code change, or name the plainly false wording.
- [x] 4.6 Gates: run every spec file touched plus the patch-set undo specs in full (sbt -J-Xmx3g, nice -n 19), and the pre-commit hook.
