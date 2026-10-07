## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `30f2cecce939c69b27ea0fec158697c92c07a024`. Base resolved live with `resolve-review-base.sh` (exit 0): `9415a44eca125f5bee25bdd4878911d39b6ecc37`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/e2e-contention-robustness/HEL-1298`.

### What I verified (with evidence)

**Owner rulings.** I read `.concertino/runs/HEL-1298/events.jsonl`. All three escalations have an `escalation.answered` event with `answer_source: "human"`:
- 451d3f answered `remeasure-on-quiet-host`.
- 2c65fc answered `accept-and-waive-27s`. The question it answered stated the quiet-host numbers (8x: 18/20 red to 20/20 green, max 28.0 s).
- 0ed921 answered `rule-header-edit-does-not-invalidate-greens-then-respawn-for-artifacts-only`.

I treat all three as binding.

**The diff (code).** Only two specs change. Nothing under `frontend/`, `backend/`, `playwright.config.ts` or `ci.yml` changes (C3, C6).
- `hel519`: the three tests that left `/sources/:id` on a bare `waitForURL` now first wait for `getByRole("heading", { name: source.name, exact: true })` to be visible. No assertion was removed or loosened.
- `hel910`: `registerAndLogin` now registers through `page.request`, which shares the page's cookie jar, instead of logging in through the UI. Seeding now happens before the first page load.
  - The `io.click`/`io.enter` count is 18 before and after (`git show d0cbe62a5~1:...` compared with HEAD).
  - `toBeLessThanOrEqual(30)` is unchanged.
  - There is no `setTimeout`, `test.slow` or timeout change. A grep of the diff for `expect|setTimeout|slow|toBeLessThan` returns only the 3 added heading waits and the import line (C4).
  - The only lines removed are the UI-login steps, which are not part of the scenario under test.

**Freshness of the greens (C8).**
- `git diff d0cbe62a5 HEAD -- e2e/hel519-recent-navigation.spec.ts` contains only the 6-line HEL-1288 parallel-mode header. The ruling covers this.
- `git diff 84ad6eb37 HEAD -- e2e/hel910-...` is empty, so the quiet-host f8 greens ran on the spec that ships.

**The executor's raw logs match the claims.** Logs are in the scratchpad at `executor/q/*` and `executor/*.txt`:
- `q/u8.log`: 18 failed / 2 passed, every failure a 30 s timeout. Load before 0.44.
- `q/f8.log`: 20 passed, 26.8 to 28.0 s. Load before 0.51.
- `q/u7.log`: 20 passed, 26.5 to 27.2 s.
- `u519-r6.txt`: 10 failed / 20 passed, all "Recent" `toBeVisible` failures.
- `g519-r6.txt`: 25/25 passed.
- The throttle diffs `q/diff-fixed.txt`, `q/diff-unfixed.txt` and `diff-greens-hel519-final.txt` show only the 4-line hook.
- `root-cause-evidence.md` and `tasks.md` 4.1 state these numbers accurately. That includes max 28.0 s and p50 27.2 s against the waived 27 s bar, and the loaded-host batch A result of 21/25 with 4 reds, labelled as history. **The numbers are stated honestly.**

**HEL-1354** exists in Linear. Its title is "Pipeline-detail page boot cost: 7 parallel API calls incl. duplicate run-history GET...", it is in Backlog, and it is relatedTo HEL-1298.

**Root cause, hel519.** `frontend/src/features/commandPalette/RecentVisitsRouteObserver.tsx` records a visit in a `useEffect` keyed on `location.pathname`, so recording happens only after the route commits. The heading wait is a web-first wait on that commit. This matches the recorded probe (9/9 reds: pushState with no setItem and no heading, branch A, a test defect). Because it is a test defect, no product change or Jest test is required.

**My own independent runs.**
- Setup: own headless Playwright, `nice -n 19`, `--workers 2`, `DEV_PORT=6730`.
- Servers: the existing ones, `assert-phase.sh servers` returned `PASS servers`, and the cwd of vite 56624 and java 56363 is this worktree.
- Throttled copies: built **outside `e2e/`** in the scratchpad harness `skeptic/pw/`, using a minimal config with `testDir: "."` and a 30 s timeout. Each copy is `git show <rev>:<spec>` plus the identical 4-line CDP hook; `*.diff` files are kept, and the diffs are identical to the executor's.
- Burners: 3 `nice -n 19 timeout 900` loops per batch, killed by recorded PID. `ps` confirmed all of them were gone afterwards.

1. Both full files, uncontended (load 7.82 before / 10.61 after, from unrelated work): **10/10 passed (30.8 s)**, exit 0.
2. `u519`, unfixed hel519 (`d0cbe62a5~1`), 8x + 3 burners. Burners 73451-73453, load 5.37 before / 6.33 after: **20/20 red**, all at the `recentGroupLabel` `toBeVisible` (the CI failure mode).
3. `f519`, fixed hel519 (HEAD), 8x + 3 burners. Burners 78429-78431, load 5.82 / 5.91. My file filter `fixed519.spec.ts` also matched `unfixed519.spec.ts`, so this batch ran both copies interleaved: **fixed 20/20 green (7.6 to 10.5 s); unfixed 19/20 red in the same run.** That makes it a concurrent A/B under identical load. **I independently reproduce the hel519 flip: unfixed 39/40 red, fixed 20/20 green.**
4. `f910`, fixed hel910 (HEAD), 8x + 3 burners. Burners 89882-89884, load 5.52 before, 9-16 during, 8.53 after: **16/20 green.** All 4 reds are 30 s test timeouts. The passes took 24.3 to 27.0 s.
5. `f910b`, a rerun to check whether batch 4 was a one-off. Burners 106292-106294, load 6.46 before, 7.7-15.9 during, 14.06 after: **13/20 green.** All 7 reds are 30 s timeouts, and they cluster at the load spikes (runs 1-3 and 17-20). The passes took 22.8 to 29.2 s.

Batches 4 and 5 are a stable result: under 8x plus ambient host load of 8-16 from other lanes, fixed hel910 still times out about 25% of the time. This is **not** the reproducing configuration the owner ordered. That configuration is a quiet host with starting load below 2, where f8 went 20/20. It is the same class as the loaded-host batch A (21/25), which the owner had in front of them in escalation 451d3f when they chose to remeasure on a quiet host and then waived the bar. This result does not refute the AC as ruled; I record it as a non-blocking finding below.

**Gates.** I ran these fresh at HEAD:
- `eslint --max-warnings=0` on both specs: exit 0.
- `prettier --check` on both specs and the change dir: clean.
- `tsc --noEmit -p e2e/tsconfig.json`: exit 0.

**UI.** N/A. No `frontend/**` file changed.

**Gate defect check (mtime).** No report I drilled into discloses unsound evidence mtimes, and no conclusion here rests on mtime ordering. Every claim above rests on log contents and git diffs.

### Acceptance criteria trace
- **AC1 (probe-confirmed root cause + contended failure rate per spec):**
  - hel519: branch A, a test defect, with the probe classifying 9/9 reds. Unfixed rates were 10/30 at 6x and 12/20 at 8x, and I reproduced 39/40 at 8x.
  - hel910: cumulative boot and render cost against the 30 s budget, with no stalled step. The per-step timing table is in the evidence. Quiet-host unfixed at 8x was 18/20 red.
  - Met.
- **AC2 (fix the real cause; web-first or real-state wait, not a longer timeout):**
  - hel519: the heading wait is a web-first wait.
  - hel910: removes an unmeasured app boot. Neither change touches a timeout.
  - The residual product boot cost was escalated and filed as HEL-1354.
  - Met.
- **AC3 (no quarantine, no loosened assertions):** `testIgnore` is untouched and the assertions are unchanged (grep above). Met.
- **AC4 (20 or more consecutive greens under the contended config):**
  - hel519: 25/25 at 6x (C8 is covered by ruling 0ed921). I also saw 20/20 at 8x.
  - hel910: 20/20 at the quiet-host 8x reproducing config. The 27 s bar is waived by ruling 2c65fc.
  - Met as ruled.
- **AC5 (coordinate with HEL-1288; no worker change):** `playwright.config.ts` and `ci.yml` are untouched. Met.

### Verdict: CONFIRM

### Non-blocking notes
- **The PR body must state that hel910's residual sensitivity is reduced, not eliminated.**
  - At 8x on a quiet host the fix moves the spec from 30.4 s typical (red) to about 27.2 s (green), so roughly 2-3 s of margin.
  - Under 8x plus ambient load of 8-16, my two batches went 16/20 and 13/20 green; every red was a 30 s timeout.
  - The design's own projection said a 4-worker CI leg would still be red after the overhead cut.
  - HEL-1354 is the vehicle for this residual. Do not let the PR claim that hel910 is now robust to arbitrary contention.
  - Logs are in the scratchpad at `skeptic/f910.log`, `skeptic/f910b.log` and `*.samples`. The scratchpad sits outside the git tree, so `persist-evidence.sh` cannot take them, and the key numbers are inlined here.
- As evaluation-2 noted, hel519's 6x config no longer reproduces on a quiet host. The flip is independently re-established above at 8x under moderate load (39/40 red to 20/20 green).
- `root-cause-evidence.md` line 10 ("load average 10-17 throughout") should carry a qualifier saying it applies only to the loaded-host sections.
- The design's confirmatory CI run (C2: at most one at a time) is still outstanding.

### Dev-DB users created by this review (exact; nothing deleted; matt@helio.dev untouched)

Full-file uncontended run (10), from `created_at` in my run window:
- fb3888ba-6751-4282-9bce-3fe0b44668e6 hel519-source-list-1791348021344-81484@example.test
- dfe544c5-09af-47b8-8ccd-c86f569f9793 hel519-pipeline-url-1791348021584-82066@example.test
- f02e2a6f-3c3d-4b49-b07c-2343c257f9f0 hel519-pipeline-bf-1791348027517-2031@example.test
- b6e595e9-bbc3-459f-9d28-c248ec44e9b2 hel519-dashboard-reload-1791348028997-85243@example.test
- da689cbd-d2f0-4a44-8029-e18bb68ea6b5 hel519-persist-1791348035840-30164@example.test
- 10f287a3-65c8-4ec3-9e0a-739ef951be81 hel519-fresh-1791348036363-76762@example.test
- d1be5f33-40a9-4b8e-a43a-8c902fdd0588 hel519-typing-1791348037827-94545@example.test
- fc216ad3-c314-49aa-a926-dba81b485b6d hel519-root-landing-1791348039990-76034@example.test
- 58c5f154-fb89-44df-9aca-6ad73c5959ee hel910-full-flow-1791348040351-22700@example.com
- 0dece04e-12e3-4042-b538-84d333d0284d hel910-existing-output-1791348047716-76102@example.com

Throttled batches (100), from an exact-id set difference of the hel519-/hel910- users before (772) and after. The split is 60 hel519-source-list (u519 20 + f519 40) and 40 hel910-full-flow (f910 20 + f910b 20), which matches the batches exactly:
- 0b2bc201-235d-4df9-b6a0-febf162003c0 hel519-source-list-1791348094659-65048@example.test
- cbbd6f35-fe26-4281-b52a-fb07f47788ad hel519-source-list-1791348094659-91742@example.test
- b0c51a1c-f128-4a74-ba5a-948fa320474e hel519-source-list-1791348108689-73512@example.test
- 249dfde8-b1d6-4d13-a8bc-cd14278b6eaf hel519-source-list-1791348110146-87629@example.test
- 6c7e31da-f94b-436d-bdf3-69c702272941 hel519-source-list-1791348122619-24971@example.test
- c18c5e5c-2276-4b19-8217-eaecd65a9b77 hel519-source-list-1791348123116-91944@example.test
- e290809b-9a60-4a76-bf8d-55501fe917ff hel519-source-list-1791348135517-80175@example.test
- 1770d8f8-2f67-49ca-824f-350228cb9749 hel519-source-list-1791348137197-20325@example.test
- bc51b132-2a94-4bf8-82a5-2f0b9067b078 hel519-source-list-1791348148203-95378@example.test
- 7b972f7f-4576-40db-b561-7646e92da218 hel519-source-list-1791348151453-52920@example.test
- f7bb77cf-f5d1-45ba-8d29-be7ce1037986 hel519-source-list-1791348161662-28966@example.test
- 2b58fd1e-00b4-42ae-b102-5c8d0f05ab67 hel519-source-list-1791348164760-93495@example.test
- 33b136ef-e10e-40ed-8de7-63954c85d6a3 hel519-source-list-1791348174277-28542@example.test
- e32d652e-d293-49fb-891a-86d39cc3ad1c hel519-source-list-1791348178876-87827@example.test
- 70f38f11-81cb-472f-bcd1-3cf58440bb6f hel519-source-list-1791348187879-66363@example.test
- 83e70015-bcf1-4356-92f2-e66489a220f9 hel519-source-list-1791348194192-49095@example.test
- 946931c5-d0fa-4668-a9e6-4ebf27c37f29 hel519-source-list-1791348203121-38323@example.test
- d3c598f4-1e46-4c63-99d6-7754038369c0 hel519-source-list-1791348208131-62006@example.test
- cdf0f065-9881-4c0e-ad16-eb5dfd39e0de hel519-source-list-1791348217421-64050@example.test
- 862acb98-dc76-43a3-a852-958822bf5e10 hel519-source-list-1791348225369-89973@example.test
- 164875a0-515b-40e5-83d7-ad8fa827dea9 hel519-source-list-1791348248640-13191@example.test
- cf7552a0-ce83-44bc-aecc-3a523a7b52d9 hel519-source-list-1791348248640-22742@example.test
- 6cb41bbb-c83c-4df1-9a02-af4626ca1d3f hel519-source-list-1791348258842-5497@example.test
- 159c0d04-e090-4f6e-b7eb-f2f10427a811 hel519-source-list-1791348263350-22457@example.test
- 06b2e491-665e-49df-82a3-291c84cdc8fd hel519-source-list-1791348268580-59778@example.test
- 4f5c357f-66af-4be7-96a2-3996566125da hel519-source-list-1791348272977-42237@example.test
- 3be24c15-688a-4741-828e-49fef2e1cab2 hel519-source-list-1791348278815-36304@example.test
- c7c3df91-9e6f-4df3-ab57-6994b549de5f hel519-source-list-1791348287782-62249@example.test
- 7d2a1890-35b7-41ba-81a5-ebeb42481429 hel519-source-list-1791348289608-51391@example.test
- ab123da2-28e0-4644-a62d-cd0395b3b689 hel519-source-list-1791348296886-84824@example.test
- 29a5b461-9daa-4c0a-8058-1f4a5f06322e hel519-source-list-1791348300788-12163@example.test
- 3942715d-e599-43ec-97e6-4a040f294b40 hel519-source-list-1791348308727-56290@example.test
- efd2bc33-e470-447b-ad6f-4df26fc9a2e1 hel519-source-list-1791348309884-94148@example.test
- 2ca7233a-6ab6-4b22-9022-8772efb5f2bd hel519-source-list-1791348317387-31357@example.test
- 867ccd53-bb95-415c-9912-03c47bed5897 hel519-source-list-1791348323454-92358@example.test
- fe1b83ee-3ead-4f87-a9c9-25c5adf6d4e4 hel519-source-list-1791348330053-17143@example.test
- 3c7b4465-2444-44e1-8acb-15e352b30f62 hel519-source-list-1791348331933-64014@example.test
- abaaf0b7-a68f-4b90-bdfe-238b9e263c89 hel519-source-list-1791348339374-52095@example.test
- 6755b241-114f-4214-8a96-1d2ee73ed9ca hel519-source-list-1791348346948-41480@example.test
- 348d977f-e3d9-4199-9f98-40c62ba9a819 hel519-source-list-1791348353231-39606@example.test
- 7d3f54ae-41c7-43b9-be9c-f2396c88f559 hel519-source-list-1791348356492-16789@example.test
- 214db3e3-94ae-44fe-be25-f7c384daf600 hel519-source-list-1791348365225-9193@example.test
- ab76b54b-e61d-490e-bbc8-65006f9be4d2 hel519-source-list-1791348367284-10006@example.test
- 47fa4ae6-4466-406a-a83d-3f43c0838f86 hel519-source-list-1791348374754-62735@example.test
- 1535d6d6-634a-4d62-8e15-ff40ae5334f1 hel519-source-list-1791348378701-26491@example.test
- dec5ef90-3019-49ad-a9fc-0d1f03cc7611 hel519-source-list-1791348387660-78212@example.test
- 44ad9c39-51f9-447d-8476-39eab9f6d464 hel519-source-list-1791348387954-58342@example.test
- eb48e514-9f89-480f-80a6-6c5f59d91842 hel519-source-list-1791348395656-57959@example.test
- b2137ed9-9cae-402c-9eff-a9b018cdfb44 hel519-source-list-1791348400494-75913@example.test
- 21f4d3aa-cd83-4697-9c0d-973ef7853863 hel519-source-list-1791348408546-73024@example.test
- 979bf212-311e-4584-b6f8-5fcd4bf292ab hel519-source-list-1791348408989-51874@example.test
- c92c260f-2bd7-41c2-8cd3-03e607e6be1f hel519-source-list-1791348416710-52734@example.test
- 0411e02e-2db6-4213-a0c9-1e0694ea17b9 hel519-source-list-1791348422815-23957@example.test
- ba333f0b-7959-40a7-83eb-9e077a406072 hel519-source-list-1791348430448-54@example.test
- 15d0a810-0368-4650-9a68-2c7668bf6094 hel519-source-list-1791348431033-7473@example.test
- f35c3f82-54c0-4d96-9d17-d3a5822ef019 hel519-source-list-1791348438466-57484@example.test
- 284a5857-461e-4092-b581-69a80ef4eba3 hel519-source-list-1791348443310-17819@example.test
- 35683cce-c39f-488b-84fb-4384d141b67e hel519-source-list-1791348451361-61467@example.test
- 9c18d561-94dc-4f0a-9d7a-3e14375dcdae hel519-source-list-1791348452833-77226@example.test
- b4a26f62-131d-46fd-a9d6-83a671c5d818 hel519-source-list-1791348462265-20159@example.test
- 809aaffd-5a55-4682-9d96-dffdb9cbab74 hel910-full-flow-1791348486110-36483@example.com
- 2926364e-76a4-4fdb-aac3-6eec787a010c hel910-full-flow-1791348486169-64613@example.com
- 6e0bd134-78c0-4a79-8988-e19bbac12b87 hel910-full-flow-1791348515960-48285@example.com
- 8d289437-020a-41d4-9dfe-40c9edcb9f68 hel910-full-flow-1791348516242-55418@example.com
- 59ab3137-9e28-4839-a3bc-f4471c71a55d hel910-full-flow-1791348542341-40102@example.com
- 69e0f2e8-5d81-48db-8e7e-5ecac0647b32 hel910-full-flow-1791348542459-61606@example.com
- 3742de99-0c15-435f-be16-46528c20c5e4 hel910-full-flow-1791348569227-65045@example.com
- 11fe75ec-02e5-4770-86d2-af839dfdd7e3 hel910-full-flow-1791348569617-50879@example.com
- 1dafa0fa-f325-439e-ad06-28296bdf79e7 hel910-full-flow-1791348603909-68050@example.com
- 7f5d5e27-0998-4136-9004-dedfd83c9f4b hel910-full-flow-1791348604002-68936@example.com
- f9abe8f4-92af-4ce6-80e4-840a18080ef9 hel910-full-flow-1791348628683-21985@example.com
- 3ddbecba-e5e6-402d-8278-2aa91f880389 hel910-full-flow-1791348628962-91789@example.com
- 055d50fa-dc8c-46eb-b187-cdfc88848efa hel910-full-flow-1791348656204-92927@example.com
- c0384460-cce2-44ba-a524-0bfa88dbe91b hel910-full-flow-1791348656213-38245@example.com
- f44c311c-c241-4f7d-b8fb-84ac23462050 hel910-full-flow-1791348682328-24794@example.com
- 842693fa-7905-4214-b209-f853c22ada0d hel910-full-flow-1791348682422-28008@example.com
- b7f2fd32-175e-4d8f-be3e-6a56a2c99156 hel910-full-flow-1791348707087-25369@example.com
- 0add6a9e-66cd-4871-b079-2bc0ccabdfde hel910-full-flow-1791348707202-11788@example.com
- 1da85461-3f7e-4bf7-ac07-a6cc97a35dd8 hel910-full-flow-1791348731840-16841@example.com
- 9d85ded9-3240-4841-8bbe-e069ed561900 hel910-full-flow-1791348732025-53770@example.com
- ee79a37b-7f48-4d41-8285-d27c3d9e5d3b hel910-full-flow-1791348777447-65890@example.com
- 0b2dd26e-e257-45c2-a9fc-fa69c8682687 hel910-full-flow-1791348777450-74923@example.com
- 114dafab-526b-4a4c-85c1-7639ae710f7d hel910-full-flow-1791348813722-15431@example.com
- 7e9b9937-424e-4e15-9f06-aed8d412142f hel910-full-flow-1791348816241-11307@example.com
- 771a8932-d6a3-4209-b7bc-5c6e3dc371ea hel910-full-flow-1791348842851-10930@example.com
- 257d45d2-b908-470b-b6d5-9f280c1f2c1c hel910-full-flow-1791348843263-31837@example.com
- 69f3a252-e46f-4797-91cd-39662cbb072d hel910-full-flow-1791348866531-53317@example.com
- cd6135a9-9d6c-4366-8d62-18f83a1c9433 hel910-full-flow-1791348866658-88940@example.com
- 31f97b0d-a517-4292-bdad-bc6fe45392f1 hel910-full-flow-1791348890041-60527@example.com
- da7f1336-72df-4297-80b8-9d37f5d4576b hel910-full-flow-1791348890241-53588@example.com
- 764edc82-497b-446b-9019-94bd73a93041 hel910-full-flow-1791348914264-41081@example.com
- 5f5ebd36-55ea-4cbb-ab24-5d1d0d57b264 hel910-full-flow-1791348914441-11372@example.com
- 799227ac-e638-40fa-b73e-f915a619f389 hel910-full-flow-1791348938623-27069@example.com
- 83146d03-1812-466d-97d1-03d23b5b9328 hel910-full-flow-1791348938874-81761@example.com
- fc8d4c44-8430-4807-8bb0-93a07bcc98f9 hel910-full-flow-1791348964644-8533@example.com
- 5004c698-8cd0-4a9a-bb22-d5c0d97eb321 hel910-full-flow-1791348964786-94241@example.com
- 5c656744-2b86-46dc-8a6e-cbe3cc68fdef hel910-full-flow-1791348991591-88298@example.com
- ae421e3d-6591-45cb-8b95-0b3ee3186d48 hel910-full-flow-1791348991945-9154@example.com
- 22e79ff3-ca56-4e4b-b654-f0e97c79f129 hel910-full-flow-1791349023935-39485@example.com
- 2a116a6f-cda9-4319-994f-cdb8bd19f7a4 hel910-full-flow-1791349024381-78381@example.com
