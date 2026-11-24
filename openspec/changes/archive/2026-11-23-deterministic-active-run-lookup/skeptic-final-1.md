## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b80fdc13c982407f62015f36bb1cbc5db8530596` against the live-resolved base
`a6ac494b47f756d38520e17b4fb5aeab898ace6b` (via `resolve-review-base.sh`, exit 0). The diff has 2 commits:
red `5ef08e011`, then the implementation `b80fdc13c`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/deterministic-active-run-lookup/HEL-1833`.
- **Diff scope:** the only main-code change is `findActiveRunInternal` (PipelineRunRepository.scala:635-654).
  It adds `.sortBy(r => (r.startedAt.desc, r.id.desc)).take(1)` and corrects the doc comment. The other
  changes are tests, `docs/agent-native.md:105-106` and change artifacts. `hasActiveRunInternal`, the
  scheduler and auto-run guards, the HEL-505 cap and the frontend are untouched, so C15 is honoured.
- **Callers:** `grep findActiveRunInternal backend/src` finds one caller, `HookTriggerService.scala:59`
  (`collapseIntoActiveRun`). The response shape `HookTriggerResponse(id, pipelineId, status)` is
  unchanged, so no schema change is needed.
- **Green, re-run by me** (lane DB `helio_hel1833`, `nice -n 19 sbt -J-Xmx3g testOnly *PipelineRunActiveLookupSpec
  *HookRoutesSpec *PipelineRunOrderTiebreakSpec *PipelineRunGuardIntegrationSpec *ExistenceNotLeakedRoutesSpec`):
  exit 0, `Suites: completed 5`, `Tests: succeeded 124, failed 0`. All 9 `PipelineRunActiveLookupSpec`
  cases and all 4 new HookRoutesSpec HEL-1833 cases passed.
- **Red, reproduced by me rather than taken from red-run.txt:** I created a detached scratch worktree at
  `5ef08e011` and confirmed its `findActiveRunInternal` is the original `...result.headOption` with no
  ORDER BY. I ran the same two specs there: exit 1, `succeeded 18, failed 2`. The failures were the
  tied-`started_at` (newer inserted last) case in PipelineRunActiveLookupSpec.scala:77, and the hook case
  at HookRoutesSpec.scala:343, which fails on its own (returned `...0001`, expected `ffffffff-...`). This
  matches the committed red-run.txt. The scratch worktree was removed afterwards.
- **Mutations, two re-run by me** in that scratch worktree (the reviewed tree was not touched):
  - Drop `id.desc`: exit 1, 2 failures (the tied cases, repository and hook).
  - `startedAt.asc`: exit 1, 8 failures.

  Both match mutations.txt. I did not re-run the remaining two recorded mutations (no sort, no
  `completedAt` filter). The no-sort mutation is the same code as the red commit, which I did reproduce.
- **AC1** (fails first; the same run every time; a documented rule): met. Each case calls the lookup 5
  times, in both insertion orders. The rule `(started_at DESC, id DESC)` is documented in the doc
  comment, the spec delta and agent-native.md. Caveat (disclosed): the distinct-`started_at` cases pass
  on the old code because the V136 index happens to give that order. The red proof rests on the tied
  cases, which I reproduced.
- **AC2** (the overlap question answered with evidence): supportable from design.md Context and Risks,
  and I spot-checked each claim against the tree:
  - `PipelineRunService.submit` checks only owner/editor and has no open-run check.
  - `ownerInFlightRealRunsQuery` (PipelineRunRepository.scala:177-181) counts runs per owner across all
    pipelines, not per pipeline.
  - The hook's check-then-act sequence is `hasActiveRunInternal` then `collapseIntoActiveRun`
    (HookTriggerService.scala:52-60).
  - The frontend's `runBusy` comes only from this client's own run status (PipelineSpineHeader.tsx:70;
    the mobile equivalent is at PipelineMobileLayout.tsx:167).
  - The existing insight-render-triggers spec has an "overlapping" scenario (spec.md:54).
  - The owner ruling (C15, keep overlap, determinism only) and the consequence for a retrying hook
    caller are stated in design.md Risks.
- **Spec delta:** the MODIFIED requirement name matches the baseline `openspec/specs/external-run-hooks/spec.md:71`.
  The delta keeps the original text and adds two scenarios that match the implementation and tests.
- **EXPLAIN:** explain-active-run.txt shows a bitmap heap scan plus a top-N sort of 2 rows (about 0.03 ms).
  It was measured in a scratch schema that reproduces the V24/V136 indexes (disclosed). That supports
  adding no migration.
- **UI:** N/A. There are no `frontend/**` changes, so I did not start servers.

### Verdict: CONFIRM

### Non-blocking notes
- The PR body has to carry the AC2 answer. design.md Context (the bullets on overlap reachability) and
  Risks (the retrying hook caller may get a newer manual run's `runId`) are the source text. Cite the
  owner ruling.
- The open runs in the repository spec are all `running`. A `queued` open run would exercise the same
  predicate, so adding one is optional.
- green-run.txt holds only two summary lines. The suite list would make it self-describing.
