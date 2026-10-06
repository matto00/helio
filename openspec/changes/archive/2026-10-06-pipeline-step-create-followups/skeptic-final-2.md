## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `0e34b1d80362bd2b493b3cdc38566c8643af0ed0`. I resolved the base live with `resolve-review-base.sh` (main/origin), exit 0: `b16bfa1b3a74905eefc0208a01793efa047909c5`.
The branch has five commits on that base: 4f543009b (item 1), b92f6d54e (item 2 refactor), d3f8e6183 (item 3), 318e117ce and 0e34b1d80 (item 3 follow-ups).

Durable evidence is under `/home/matt/Development/helio/.concertino/runs/HEL-1340/evidence/.concertino/sk2-evidence/`, written `SK2/` below.
- Every mutation ran in a throwaway detached worktree (`.claude/worktrees/skeptic-scratch-HEL-1340-r2`). I removed it by exact path afterwards.
- WORKTREE_PATH was never modified. `git status` at the end shows only the two pre-existing untracked entries: `.npm-cache-hel1340/` and `files-modified.md`.

### What I verified (with evidence)

**Round-1 CR1 (pin the chip suppression on the LaneColumn render path): MET as specified.**
- At HEAD, `PipelineDetailPage.draftCreate.test.tsx` passes 12/12 (`SK2/hel1340-sk2-green.log`).
- I replaced both `hasOwnAnalyze={hasOwnAnalyzeEntry?.(step.id) ?? true}` sites in LaneColumn.tsx (:222 and :274) with `hasOwnAnalyze={true}`.
  - Result: 1 failed, 11 passed. The failing test is exactly `a lane draft in flight resolves its field from its exact anchor, not a trunk neighbour`, with `Received: <span class="...diff-chip--removed">− other</span>` (`SK2/hel1340-sk2-m-lane.log`).
  - This reproduces probe-evidence.md's cycle-3 claim.
- The rewritten test now uses `rootId: "root-1"` and a real `p-0 -> anchor-1` chain. It asserts that the card is inside `[aria-label="Lanes"]` both before and after the swap, so the round-1 vacuity (the draft never reaching LaneColumn) is gone.
- Per-site follow-up, my own extension (not part of the CR's stated proof):
  - :222 alone (the compact / tail-chain branch) → red, 1 failed (`SK2/hel1340-sk2-m-lane-222.log`).
  - :274 alone (the non-compact multi-step-lane branch) → **green, 12/12** (`SK2/hel1340-sk2-m-lane-274.log`). See Non-blocking note 1.

**AC1 (reorder renderKey carry): MET.**
- At 4f543009b alone, against unmodified production code (`git diff --stat b16bfa1b3 4f543009b -- frontend ':!*.test.tsx'` is empty), the suite passes 9/9 (`SK2/hel1340-sk2-c1.log`).
- Mutation at HEAD, line-targeted to `handleReorderSteps` only (usePipelineDetailPage.ts:1089: `{ ...pipelineStepToStep(persisted), renderKey: s.renderKey }` → `pipelineStepToStep(persisted)`):
  - Result: 1 failed, 11 passed. The failure is exactly `a non-head reorder keeps a created draft's card open` (`SK2/hel1340-sk2-m-reorder.log`).
  - My first attempt was a global sed that also hit the enable-toggle carry at :1173. It produced 2 failures, so I re-ran it scoped to :1089. That re-run is the cited result.

**AC2 (b92f6d54e is a reviewable, behaviour-preserving refactor on its own): MET.**
- What the commit touches:
  - `git diff --name-only 4f543009b b92f6d54e -- '*.test.*' '**/__tests__/**' 'e2e/**'` → 0 files.
  - The commit touches only usePipelineDetailPage.ts, the new usePipelineStepCreation.ts and tasks.md.
- I checked out b92f6d54e detached and ran:
  - `tsc --noEmit`: 0
  - `eslint src/features/pipelines/hooks --max-warnings=0`: 0
  - full frontend Jest (`--maxWorkers=2`, nice 19): **439 suites / 4582 tests passed, exit 0** (`SK2/hel1340-sk2-b92-{tsc,eslint,full}.log`)
- Mechanical move check: I stripped indentation from every line the commit removes from the page hook and grepped each against the new hook's lines. Only these are absent:
  - the three old `useCallback` deps arrays and `handleStepConfigChange`'s `[id]`
  - one re-wrapped 4-line comment
  - Every statement body moved verbatim.
- Deps arrays: the new arrays add only `stepsRef` (`useRef`, :160), `setSteps`/`setStepsInitialized` (`useState` setters, :151/:182) and `pendingDraftMetaRef` (`useRef`). All four are identity-stable, so callback identity is unchanged.
- `handleStepConfigChange` keeps its order: `setSteps`, then `clearDraftCreateError`, then `createDraftIfComplete`. Its new deps are two callbacks that are stable while `id` is stable. The new hook declares no `useEffect`.
- Size: the page hook went from 1598 lines (base) to 1397 (HEAD). The new hook is 347 lines.

**AC3 (in-flight select shows the chosen field): MET.**
- Red: I restored every item-3 production file (hooks/, LaneColumn, PipelineDetailPage, PipelineRiverView, RootColumn, StepCard) to b92f6d54e and kept the HEAD tests.
  - Result: 3 failed, 9 passed. All three item-3 tests fail (`SK2/hel1340-sk2-ac3-red.log`). At HEAD: 12/12.
- Root cause:
  - The code confirms it. At b92f6d54e, `createDraftIfComplete` does `pendingDraftMetaRef.current.delete(stepId)` at send, and `getAnalyzeSchema` falls to `EMPTY_ANALYZE_SCHEMA` when there is no entry and no meta.
  - probe-evidence.md records the `pendingMeta= false` probe.
- The fix matches D4:
  - a separate `draftFallbackMetaRef`
  - written at send
  - re-keyed from the temp id to the persisted id before `setSteps`
  - deleted on failure, with the meta restored to `pendingDraftMetaRef`
  - consulted by `getDraftFallbackSchema`, `getAnalyzeColumns` and `getAnalyzeSchema` only
- The guard and `stepsFingerprint` are untouched.

**Live UI, both themes.** Setup:
- Servers: `start-servers.sh` on 6772/9679, then `assert-phase servers` → PASS.
- Run: headless Playwright, 1 worker, nice 19, my own spec. It registers via the API, then `isolateLivePage`, then seeds.
- Users: dedicated `@example.test` users.
- Scenario: a static source with `notes`/`n`, one rename step, Branch → Generate text. The create POST is held, then released while every later `/analyze` is held.

Results (`SK2/hel1340-sk2-e2e.log`), identical in light and dark:
- in flight: select `notes`, `inLanes=true`, removed chips `[]`
- post-swap with its own analyze held (`held=1`): select `notes`, `inLanes=true`, removed chips `[]`, `expanded=true`
- settled (analyze released, reload): select `notes`, chips `["+ summary"]`

Screenshots, which I looked at:
- `SK2/hel1340-sk2-light-2-postswap-page.png`
- `SK2/hel1340-sk2-dark-2-postswap-card.png`
- `SK2/hel1340-sk2-{light,dark}-{1-inflight,3-settled-card}.png`

Design judgement:
- The card sits in the compact lane under the rename step's Branch affordance, with the same chrome, spacing and tokens as sibling cards in both themes.
- The only visible change is the corrected select and the absence of false `−` chips during the window. The `+ summary` chip row appears once the step's own analyze lands.
- The diff adds no CSS and no new component. It reuses the existing `StepSchemaDiffChips` behind a boolean.

Console:
- The only errors are two `404`s per run, one per page load (goto and reload).
- These match the pipeline-schedule GET for a pipeline with no schedule. The header reads "No schedule set", and pipelineService.ts:339 documents that 404 as caller-handled.
- They are pre-existing and not from this diff.

**Gates at HEAD 0e34b1d80, re-run by me in WORKTREE_PATH:**

| Gate | Result |
|---|---|
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| root Jest (`--maxWorkers=2`) | 38 suites / 371 tests, 0 |
| frontend Jest (`--maxWorkers=2`) | 439 suites / 4585 tests, 0 |
| `npm --prefix frontend run build` | 0 |

No backend file changed (`git diff --name-only` shows no `backend/` path), so backend-test does not apply.

**Constraints:**
- C1: no change to HEL-1294's disable-expand behaviour. `markCreating`/`isCreating` moved verbatim.
- C2: verified above.
- C3: red then green reproduced by me for items 1 and 3. The root-cause probe is recorded.
- C4: the three D1 commits are in order. The two follow-ups are review-driven item-3 commits on top, which leaves the refactor commit isolated.
- C5: no ci.yml, playwright.config.ts or .gitignore change.
- C6: no backend file, and no post-create resync. The only `syncStepsFromServer` calls in the diff are moved create-immediately paths. The draft-create `.then` has none.
- The `H2-move-ac4-to-hel1345` ruling is present in events.jsonl (2 hits).

**Gate defect check:** no report I read discloses unsound evidence mtimes. My evidence is content-based: test names, assertion text, counts and line-targeted diffs.

### Verdict: CONFIRM

### Non-blocking notes

1. **LaneColumn.tsx:274 (the non-compact lane branch) is still unpinned on its own.** Forcing only that site to `true` stays green.
   - Why it matters little in practice: a new lane draft is always the sole step of its own lane, so it renders through the compact branch at :222. In the live run it did.
   - A created draft reaches :274 only in a narrow state: the lane gains a second step while the draft is still on the fallback. For example, branching a create-immediately (position-less) step off the in-flight or post-swap draft, which renders inside the draft's lane.
   - The code at :274 is identical to :222 and correct by reading.
   - Cheap hardening: a direct `LaneColumn` render test with a 2-step lane and `hasOwnAnalyzeEntry` returning false. Alternatively, make `hasOwnAnalyzeEntry` required and update the two `PipelineRiverView*.test.tsx` prop fixtures.
   - The optional prop with a fail-open `?? true` remains, and the executor recorded why: requiring it breaks tsc in two existing test files.
2. The cleanup effect race noted in round 1 (usePipelineDetailPage.ts:560-566 deleting the persisted-id fallback under a stale `steps` flush) still exists in theory. It fails safe: the field falls back to the placeholder, and chips stay suppressed via `hasOwnAnalyze`. I did not observe it live.
3. usePipelineStepCreation.ts is 347 lines, over the ~250 soft budget. Note it in the PR body.
4. Two orchestrator-side housekeeping items:
   - `openspec/changes/pipeline-step-create-followups/files-modified.md` is untracked in WORKTREE_PATH.
   - `.npm-cache-hel1340/` is untracked at the worktree root. Make sure it is not committed.

### Housekeeping

Shared dev DB, everything I created:
- users `36fcb482-29a6-4169-a7b7-7ad18ed8d37a` and `dbe1247c-0f2b-4dc5-9415-7ea8685845f8`: deleted by exact id, re-count 0
- pipelines `e96b516d-e244-48de-a2b7-d4c8a73d786b` and `8f90916e-8cc6-4b2e-9134-db39405a5d47`, sources `ac963b54-621a-4601-bcb6-58f2e8f2db21` and `6120a50e-14a0-4236-a597-6ba436a102a6`: deleted through the API (204)
- steps `e910be5f-830a-48be-ba02-3e5ffe40a072`, `09c4fb53-4134-4943-9faa-2386e557819a`, `1ec956f1-4fcc-4be7-b457-d9d77b2735e4` and `b54a5626-8790-4438-8201-d9aa5c7a37cf`: re-counted by exact id at 0

Everything else:
- Servers stopped by exact PIDs 447258, 447243 (vite / npm) and 447063, 446927, 446885 (java / sbt). Ports 6772 and 9679 are free.
- The scratch worktree was removed by exact path.
