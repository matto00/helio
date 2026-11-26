## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `cfc6312aaa6cc0fcc691c13730cc1e610c958cba`. Diff base resolved live: `014317f538d3ec10f0394407f2c36d7e8e4fb7d4`.
All runs were mine, using the lane DB `helio_hel1542` (exported in the same command) and my own lane servers on 6974/9881.
Transcripts are in `/home/matt/Development/helio/.concertino/scratch/HEL-1542/skeptic-final/`.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/draft-lane-notice-labels/HEL-1542`.
- **Scope against the restated ticket.** I read the full code diff.
  - Backend: `DraftPlan.draftKeys`/`draftKeyOf` are added. `laneGate` maps both ids. `requireLaneTargetsExist` names its subject by draft key.
  - Client: `knownNames` resolves draft, then saved, then created-Output ids. The subject is the earliest id in the message. Every occurrence is substituted, delimited and longest-first.
  - Wording: the three HEL-1515 comments, and nothing else.
  - e2e: the spec is rewritten and its quarantine entry removed.
- **Forbidden paths.** I grepped the diff's file list for migrations, OutputRepository, insight, RestApiConnector, helio-mcp, `hel908-full-flow`, `openspec/changes/archive` and `openspec/specs`. Result: "no forbidden paths". There is no migration, no HEL-1882/HEL-1013 file is touched, and no archive is edited.
- **Jest on HEAD** (touched files, 3 workers, after `npm ci`): 5 suites, 174/174 passed, exit 0 (`jest-head.txt`).
- **Jest red-first, reproduced.** I swapped in main's `draftSaveRequest.ts` and kept HEAD's tests: 7 failed, 18 passed, exit 1 (`jest-red-main.txt`).
  - Failing cases: (a)(b), (c), (d), (e), whole-id, prefix-id, and the `PipelineDraftNotices` render test.
  - The file was restored afterwards; `git status` is clean apart from the untracked evaluation-1.md.
- **Jest mutation (my own).** I kept label substitution but reverted the subject to first-in-array-order. 3 failed: (a)(b), (c) and the render test (`jest-mut-subject.txt`). This shows the wrong-step prefix defect is independently pinned, not only covered as a side effect of the UUID assertion.
- **Backend on HEAD.** DraftSaveLaneRefusalSpec plus DraftDiffSpec ran 31/31, exit 0 (`be-head.txt`).
- **Backend red-first, reproduced.** I swapped in main's `DraftDiff.scala` and `DraftSaveTransaction.scala`: 2 failed, 1 passed, exit 1 (`be-red-main.txt`). The failures read `"Step 'ba168f93-…' has a lane reference to '07cb86e5-t2'…" did not include "Step 'draft-new' …"` and the equivalent for the dangling case. The existing-step guard stayed green. Sources were restored.
- **e2e: the spec runs in CI.**
  - `npx playwright test --list --project=dev` collects 4 hel908-tail-attach tests.
  - `scripts/e2e-shard.mjs plan` assigns `hel908-tail-attach.spec.ts` to a leg (defaulted weight), so it is not in `testIgnore`.
- **e2e: three consecutive full-file runs at `--workers=2`** against my lane servers, each exit 0 (`e2e-1.txt`, `e2e-2.txt`, `e2e-3.txt`):
  - 4 passed (30.1s), 4 passed (29.9s), 4 passed (29.2s).
  - Throwaway users were deleted by the HEL-1301 teardown.
- **[C1] honored.** I read the spec. Each test compares `tree(page)` to an exact indented array in the draft, then again after `save()` plus `reloaded()`. `reloaded()` asserts that no draft banner remains.
- **Test intent.** Test 2's "tail re-homes onto the appended step" matches main's original HEL-908 CR9 test (`git show 014317f53:e2e/hel908-tail-attach.spec.ts` L117-124), so the intent was preserved, not reinterpreted.
- **Visual check, live, both themes.**
  - Setup: a throwaway user, and the pipeline Filter → (Rename tail) → Sort → Union, with the Union's lane set to Rename.
  - **Light:** in a draft I removed Rename, then pressed Save & run. The alert read: `Couldn't save step "Union / append rows": Step "Union / append rows" has a lane reference to "Rename column", which is not a step of the draft Your draft is still here.` It shows no UUID, the subject is in the prefix and the removed target has its saved label. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1542/evidence/.concertino/scratch/HEL-1542/skeptic-final/01-notice-light.png`.
  - **Dark:** I removed Filter, which cascades the Rename tail, then pressed Save & run. It produced the same labelled notice, danger-tinted on the dark surface with readable text, matching the light rendering. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1542/evidence/.concertino/scratch/HEL-1542/skeptic-final/04-notice-dark.png`.
  - `PipelineDraftNotices.tsx` is unchanged, so its token and styling compliance is the existing component's.
  - My throwaway user was deleted by exact id via `deleteUsersAndFolders`; a follow-up count shows 0 rows.
- **Created-subject path in the UI.** For a draft-created union, the lane picker disables every lane node (HEL-1521, "would create a cycle"), so I could not reach the clientId-subject 400 through the UI. It is covered by the backend spec (red on main) and jest case (c).
- **Servers.** I stopped them with `stop-servers.sh`, which printed `STOPPED ports=6974,9881`.

### Verdict: CONFIRM

### Non-blocking notes
- **Run-on notice copy.** The notice reads "…not a step of the draft Your draft is still here." with no period. This happens for every draft-save 400 that has no trailing period (about 30 messages in DraftDiff), so it is not introduced here. I agree with the evaluator: it belongs in a client-side follow-up in `PipelineDraftNotices.tsx`.
- **Untested `laneGate` branch.** `laneGate`'s mapping of a created *target* (`plan.draftKeyOf(v.targetId)` where the target is also created) has no test. Only the created-subject case is pinned. It is low risk because it uses the same map.
- **Test 3 cannot tell the two Filter rows apart.** It identifies the clone by position (`[FILTER, FILTER, "  LIMIT", …]`). The two rows have identical labels, so a defect that ordered the clone *before* the original while keeping the tail on the original would pass. Asserting on row ids would make it airtight.
- **Workers.** Playwright reported "Running 4 tests using 1 worker" despite `--workers=2`. This is file-level parallelism: a single spec file uses one worker. The constraint was respected, and the evaluator's and executor's runs were the same.
- **Picker behaviour seen while probing** (out of scope; the owner ruled `keep-draft` and HEL-1521 owns this). For a newly created draft union at the trunk leaf, the Rename *tail off an ancestor* was listed as "would create a cycle". Whether that is correct is HEL-1521's rule, not this ticket's.
