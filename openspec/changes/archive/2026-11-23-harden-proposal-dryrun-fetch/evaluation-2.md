## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 8c43285623c3e66bf68488545990b37fd459afbc. It is the cycle-1 commit 1f3b883bb plus the 8c4328562 fix-up. Base: e3d78e580.

### Phase 1: Spec Review — PASS
Issues: none. All four acceptance criteria are still met, as recorded in evaluation-1.md. The cycle-2 commit touches only the three items cycle 1 raised and adds evidence. There is no scope creep. CONSTRAINTS is `[]`.

### Phase 2: Code Review — PASS

Each cycle-1 change request, checked:

1. **The budget assertion can now fail.** `failingFetch` now invokes `beforeFetch` (argument 2) through `thenAnswer` and returns its `Left` if there is one, the same way the real `dryRunRestSchema` does.
   - My own probe: I restored main's fetch-then-preflight order and disabled `verify(never())` and the message assertion. The order test went red on the budget alone: `Left(TooManyRequests(60, "Source fetch rate limit exceeded: ..."))`. Result: 6 passed, 1 failed. Output: `.concertino/scratch/HEL-1727/eval2-mut-budget.txt`.
   - In cycle 1 the same probe passed 7/7.
   - Reverted; `git status` clean.
   - The executor's `evidence/mutation-5-order-reverted-verify-removed.txt` now opens with the mutation diff.
2. **Dead code removed.** `PipelineCreateDryRun.check` is deleted. The class doc comment now states the call order: `preflight`, then the root schemas (the charged fetches), then `checkOutputs`. The `SchemaField` import is still used by `checkOutputs`. Compilation succeeds.
3. **Comment rewritten.** `ProposalDryRunEgressGuardSpec.scala:121` now explains the case plainly.

Gates (my own fresh runs):
- One sbt run of 11 suites, every suite header present, `-J-Xmx3g`, `nice -n 19`, lane DB: **153 passed, 0 failed**, and the hel1468 guard reported `failed=0`. The suites:
  - `ProposalDryRunEgressGuardSpec`
  - `ProposalDryRunFetchHardeningSpec`
  - `AssistantToolExecutorSpec`
  - `ProposalDryRunRestSchemaSpec`
  - `PipelineProposalServiceValidateSpec`
  - `CombinedProposalServiceValidateSpec`
  - `PatchSetPreviewServiceSpec`
  - `PatchSetPipelineCreateDryRunSpec`
  - `ProposalDryRunParitySpec`
  - `RestConnectorEgressGuardSpec`
  - `PipelineApplyProposalSpec`
- `check-scala-quality.mjs`: clean. `prettier --check` on the change's markdown: clean.
- helio-mcp, `npm run lint` and the format check of the code files were unchanged in cycle 2. They were green in cycle 1 (623 jest tests, typecheck 0).
- I did not run the whole `sbt testFull`. Per C5 I ran the affected and adjacent proposal, dry-run, patch-set and egress suites in full.

### Phase 3: UI Review — N/A
No UI-triggering paths changed. No dev servers were started.

### Overall: PASS

### Non-blocking Suggestions
- The PR body must say helio-mcp needs a redeploy at release, as the driver constraint requires.
