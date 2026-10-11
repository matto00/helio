- `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala` — item 4: whitespace-only alignment of the non-rolling `case` arrows (git diff -w empty)
- `frontend/src/features/pipelines/ui/stepConfigs/WindowConfig.tsx` — item 3: offset/frame-size/output-column ids via useId()
- `frontend/src/features/pipelines/ui/stepConfigs/WindowConfig.ids.test.tsx` — two-editor id uniqueness/label-resolution test (red first)
- `backend/src/test/scala/com/helio/testkit/WindowRollingRejectionCases.scala` — shared invalid rolling-frame matrix with exact messages
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetWindowRollingRejectionRoutesSpec.scala` — item 2: /patch-sets/apply (step create, step update, pipeline create)
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalWindowRollingSpec.scala` — item 2: /pipelines/apply-proposal
- `openspec/changes/window-rolling-followups/tasks.md` — tasks ticked

Evidence (`/home/matt/Development/helio/.concertino/runs/HEL-1489/evidence`): item3-red.txt, item3-green.txt, new-specs-green.txt, final-window-specs-green.txt, run-mutations-HEL-1489.sh, mut-<name>.diff and mut-<name>-red.txt for M1 (patch-set step update l.50), M2 (step create l.223), M3 (PipelineCreatePreflight l.155), M4 (PipelineProposalService l.298), R1 (rawFrameSizeProblem), R2 (frameUnit l.149), R3 (days/orderBy l.151). Note: frameSize 0/1001 are proven only by the call-site mutations; M3 turned only the 7 patch-set pipeline-create cases red (apply-proposal is still guarded by its first gate, as designed).
