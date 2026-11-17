## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Reviewed HEAD e0443c24d0c02b41cdda105a410cea0b6bdf2b33 (branch feature/draft-outputs-and-shapes/HEL-1733). The planning
artifacts are untracked in the worktree. Owner rulings Q1 (`inline-confirm-then-save-dialog`) and Q2 (`one-pr`) are fixed.
I do not judge one PR infeasible. The work is large, but nothing I found makes one PR impossible.

### What I verified (with evidence)

**Round-5 CR-1 (the kept `outputsBase` is lost or overwritten): answered.** I traced D15 (design.md:311-322) against
`frontend/src/features/pipelines/hooks/usePipelineDraft.ts` on this HEAD:
- The restore effect (`:59-74`) runs before the writer (`:75-83`) in the same commit, and sets `restoredFor` first. The
  writer already prefers `keptBaseRef.current ?? baseSignature(...)` (`:80`). D15 now gives Outputs the same shape: the
  restore sets `keptOutputsBaseRef` synchronously, and the writer writes `ref ?? (loaded ? signature : omit)`. Every commit
  between the restore and the judgement therefore rewrites the ORIGINAL kept value. The three failures from round 5 are
  closed:
  - (a) List failed: the judgement never runs, and the ref keeps the kept value on disk.
  - (b) Back while loading: same as (a).
  - (c) Outputs before steps: the writer in the post-restore commit writes the ref, not the current signature.
- Clearing the ref on a not-stale judgement is safe. At that point the current signature equals the kept one, so later
  writes store the same value. Keeping the ref on a stale judgement matches `keptBaseRef`. `rebase` and `discard` clear
  it, matching `:186` and `:197`.
- Tests (3) and (7) now assert that the ORIGINAL sessionStorage entry survives and that a second restore is stale. Those
  assertions would catch the round-5 failure.
- `PipelineDetailPage` mounts its content with `key={id}` (`ui/PipelineDetailPage.tsx:33`). So per-mount refs, the
  page-local `outputsStatus` and the one-shot `outputsBaseJudgedRef` cannot leak from one pipeline to another.

**Round-5 notes folded in:**
- D5a (design.md:196-199) and the spec ("for every step ... for the pipeline source, the saved pipeline's") now state the
  every-step rule.
- The temp-parent re-pointing is in D5 (design.md:158-160). It is also correct. The draft save sends only persisted steps
  (`usePipelineDraftSave.ts`, `persistedSteps` filters `^step-\d+$`), so the server would save the real step under its
  nearest non-temp ancestor. The projection therefore matches what Save & run produces.
- `restoredTick` increments only on a kept restore (design.md:302).

**Save-time Output base check already exists.** `buildDraftSaveRequest` calls
`definitionMatchesBase({steps, outputs}, persistedSteps, baseOutputs)` (`hooks/draftSaveRequest.ts:72-80`;
`state/pipelineDraft.ts:275-287`, Outputs compared via `normalizeOutputForCompare`, which leaves out `panelCount`). The
server also checks `baseFingerprint`. So an in-memory draft is not saved over a concurrent Output change either. The D11
kept signature uses the same normaliser, so the two checks agree.

**D12 premise:** `DraftDiff.scala:295-296` validates both the update branch and the create branch with
`validateConfig(kind, config, JsObject.empty)`. The signature takes `stored` and `policy`
(`OutputService.scala:341-347`), so the planned change is a small change to arguments. Under `allowExplicitIds`, a
journaled id is treated as `created=true`, which reaches the `case _` create branch. That is the branch D12 sets to
`RestorePriorStored`.

**End to end:** proposal, design (D1-D15), tasks and both spec deltas are consistent with each other. Every AC is covered:
- Each action is drafted, saved atomically and dropped on Discard: D1-D4, D6, D8, D9, D13.
- Kept-draft restore and the stale-base path: D11, D15, tests (1)-(8).
- Desktop and phone, light and dark, e2e that fails first: D13 A1-A8, with smoke tests for the other theme on each layout.

Roots stay blocked (HEL-1734). The D3 table lists each consumer. I found no placeholder or deferred decision that blocks
implementation.

### Verdict: CONFIRM

### Non-blocking notes
- `usePipelineDetailSaveWiring.ts:66` derives `outputsLoaded` from Redux `listStatus === "succeeded"`. After a Back, that
  value can still describe the previous visit. D15's page-local `outputsStatus` gates Save only when the draft holds
  Output ops. The executor could pass the page-local flag to the `baseOutputs` argument of `buildDraftSaveRequest` too,
  for one source of truth. This is not required, because the server's `baseFingerprint` still guards the save.
- A step-only kept draft now restores stale after a concurrent Output rename (on main it restored not stale). This
  matches the spec ("steps or Outputs"), and Reload keeps every op. Mention the extra click in the PR body.
