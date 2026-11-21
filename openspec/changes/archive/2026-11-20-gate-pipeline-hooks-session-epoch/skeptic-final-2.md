## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `124350edb4dfcff9855f5d8039ac9b0016e4d3fb` against the live-resolved base `98b8c40e9ffd99491482a28b609cbe556f293a45`
(`resolve-review-base.sh main origin`, exit 0). Commits: red `b017acee6`, fix `cad8f1a6b`, red `e6171e930`, fix `124350edb`.

Evidence dir (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/skeptic-final-2/`

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` gave `READY ambient=/home/matt/Development/helio branch=task/pipeline-hooks-session-check/HEL-1798`.
- **Round-1 CR1 is fixed.** `git diff e6171e930 124350edb -- frontend` shows one code change. The `catch` of
  `handleAddOutputViaAggregateTail` (`usePipelineStepStructure.ts:152-153`) now calls `deletePipelineStep` only when
  `getSessionEpoch() === startEpoch`. The local `setSteps` filter and the `throw err` are unchanged. Every path is now
  covered: the throws before the `try` (:129, :131), a successful `createOutput` after sign-out (:139, returns with no
  dispatch), and a rejected `createOutput` after sign-out (the catch gate).
- **The red is genuine.** `e6171e930` adds only the fourth test case plus docs. The fix commit's only code change is that one gate.
  Removing that gate therefore gives back the red-commit code exactly.
- **I re-ran the mutation myself.** I put a scratch copy of the hook in place through `moduleNameMapper`, so the worktree
  was not touched. Replacing `if (getSessionEpoch() === startEpoch)` with `if (true)` fails exactly the new test
  (`does not send the rollback delete when createOutput rejects after sign-out`, 1 failed, 3 passed). A no-op control copy
  passes 4/4. Evidence: `.../skeptic-final-2/mutation-summary.txt`. This matches the executor's
  `mutation-runs/cycle2-rollback-catch-gate.txt` and `red-run/cycle2-rollback.txt`.
- **Design docs updated.** design.md D2 and the orphaned-tail risk bullet now cover the rejection path. D4's assertion
  wording now matches what the tests actually check. post-await-sites.md moves `usePipelinePreviewCache` to the
  "safe" table: both of its callbacks dispatch before their only await.
- **Whole change, re-judged cold.** I read the full diff of all eight hooks again. Every check compares against an epoch
  captured at the start of its action, and only `clearAuth` bumps the epoch, so no check changes behaviour within one
  session. I audited every `catch` in the eight hooks:
  - DraftSave's catch gates its one dispatch. Its notice and cascade updates are local state.
  - RemoveStep, Reorder, Toggle, DuplicateStep, AddRoot, RemoveRoot and run/dry-run catches only set local state or show a toast.
  - The aggregate-tail catch is now gated.
  - No remaining catch issues a request or a dispatch carrying the previous user's ids.

  Round 1 mutated the other 11 checks (each killed by its own test), and this round's mutation covers the twelfth, so every
  new check has now been mutated.
- **AC1 (eight hooks, red-first):** there are eight `*.sessionEpoch.test.tsx` files, one per hook in the ruling.
  `red-run/red-run.txt` records 17/17 failing on the tests-only commit `b017acee6`. The fourth StepStructure case is
  red on `e6171e930`, as described above.
- **AC2 (HEL-1634 guard and e2e):**
  - Jest over `features/pipelines/hooks|shared/session|sessionEpoch|recentVisits`: 41 suites, 369/369 passed.
  - Full frontend jest (3 workers, nice 19): 902 suites, 10480/10480 passed (`.../jest.txt`, `.../jest-full.txt`).
  - Servers: started on the lane DB (`helio_hel1798`, ANTHROPIC_API_KEY empty). `start-servers.sh` READY,
    `assert-phase.sh servers` PASS.
  - E2E: `e2e/hel1634-logout-user-switch.spec.ts` plus `e2e/hel1631-draft-mode.spec.ts`, `--project=dev`, 2 workers:
    11 passed (`.../e2e.txt`).
  - Residue: the spec deleted its 12 throwaway users itself. A query for `hel1634-%`/`hel1631-%` users on the lane DB returns 0.
  - Stopped with `stop-servers.sh` (`STOPPED ports=7230,10137`), and both ports were confirmed free.
- **AC3 (tidy):**
  - The duplicate guard test is removed. The removed block is the second "every cleared key names a registered hook" test.
  - The casts at `recentVisitsListeners.ts:75` are commented.
  - The allowlist is split into `sessionStorageAllowlist.ts` and `sessionModuleStateAllowlist.ts`. Round 1 checked that
    the entries are byte-identical. `grep sessionStateAllowlist` over `frontend/src`, `scripts`, `e2e` and `docs` finds
    no stale importer.
- **Gates:** `npm run typecheck` exit 0. `eslint --max-warnings=0` on the changed dirs exit 0. Prettier check clean.
- **Merge risk with origin/main (`763c69f6f`, HEL-1792):** `git merge-tree --write-tree HEAD origin/main` merges cleanly.
  The brief's premise is not accurate: `git diff --stat 98b8c40e9 origin/main` shows HEL-1792 touched only backend Scala
  files and openspec files, not `usePipelineDraftUndo.ts`. There is no overlap with this branch. A rebase is still
  needed before merge, but it is mechanical. I did not rebase.
- **UI:** no visual or styling change (hooks, tests and allowlist files only), so no design-standard judgment applies.

### Verdict: CONFIRM

### Non-blocking notes

- These round-1 notes still stand. Each is harmless because sign-out unmounts the page:
  - `handleRemoveRoot`'s success toast can still appear after sign-out. It carries counts, not ids.
  - `usePipelineDraftSave`'s early returns after an epoch change leave `sseActive` true.
- `evaluation-1.md` reviewed `cad8f1a6b`. No evaluator report covers cycle 2 (`e6171e930`/`124350edb`). This round
  re-ran the gates on the new HEAD, so the gap is in the paperwork only. The orchestrator may want an evaluation on record.
- The follow-up candidates in post-await-sites.md are outside the eight-hook ruling and deserve a ticket:
  `usePipelineDraftCreate.ts:70`, `usePipelineShapeInstantiation.ts:83-103`, `usePipelineRunStream.ts:75`, and
  `usePipelineDraftUndo.ts:57` (HEL-1792's merge did not touch it).
