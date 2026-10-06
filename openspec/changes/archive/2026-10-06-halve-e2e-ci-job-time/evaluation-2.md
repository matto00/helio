## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed head: `6c7d6bc33fed0203e42c3c2649cabb37b69182a7`. This is a local commit and has not been pushed. The diff base was resolved live as `94e996d3`.
CI is still paused, so nothing was pushed, re-run, dispatched or cancelled.
The following stay PENDING-CI and are not counted as defects: task 3.1's CI re-proof, 2.2, 4.3, and 5.1–5.3.

### Status of the cycle-1 change requests

1. **CR1 — readiness gates: resolved locally.** `e2e/state-surface-contrast-guard.spec.ts` ~L865–888 now gates each route cell on its own rendered content before it stamps or probes:
   - `/`: the seeded dashboard in `.app-sidebar`.
   - `/sources`, `/pipelines` and `pipeline-detail`: the seeded name in both `.app-sidebar` and `<main>`.
   - `/settings`: the "Appearance" heading.
   - `/chat` and `/connectors`: `<main>` is visible. Their rails measure 0–1 elements on main, so there is no seeded rail content to wait for.

   The 200 ms wait is kept and is now commented as a CSS settle only. task 3.1 was correctly set back to `[ ]`. profile.md now records the two CI deviations and states that the fix is proven locally only.
2. **CR2 — duplicate focus log line: resolved.** One population line per cell remains. My local runs show 10 `[HEL-520 …] view` lines, not 20.
3. **CR3 — profile.md traceability: mostly resolved.**
   - Both missing run ids were added: 37359043449 (6b64a003) and 37361053631 (bfc86fb2).
   - The bfc86fb2 row was restated as "e2e legs green; run concluded failure (ci-complete cancelled)".
   - Attempt numbers were added.
   - The wait inventory was corrected to 40 sites in 18 files, with the counting rule stated.
   - A Findings section was added, along with a D5 statement that the overlap did not cut pre-test time. task 4.2 was reworded to match.

   The new Findings section contains two factual errors; see Phase 1.

### Phase 1: Spec Review — FAIL

The checks from cycle 1 still hold:
- **C3:** hel1260 is unmodified.
- **C4:** ci.yml and playwright.config.ts are unchanged since d2023f72.
- **HEL-951:** `npx playwright test --list` gives 175 tests in 36 files.
- **D2 ledger:** unchanged, and nothing has been deleted.

Issues, both in the new `profile.md` "Findings" section (C1, accurate CI evidence):

1. **The hel1094 entry gives a false reason.** It says: "At that head (c4328881) no parallel-mode file existed, so parallel mode is not implicated."
   - That is false. `git grep 'mode: "parallel"' c4328881 -- e2e` returns both `focus-presence-guard.spec.ts` and `state-surface-contrast-guard.spec.ts`.
   - The conclusion still holds on different evidence. Shard 2 of 37356358733 ran only hel1065, hel1079, hel1080, hel1085, hel1087, hel1088, hel1090, hel1094 and hel1095 (from that leg's log), and none of these is a parallel-mode file. So parallel mode could not have interleaved with hel1094 in that leg.
   - As written, a reader who checks the claim finds it false.
2. **The hel1028 entry contradicts itself.** It reads: "37362375592 shard 2 attempt 1... recorded as attempt 2 above."
   - The attempts API shows attempt 1 `e2e (2)` = `cancelled` (19:17:42–19:35:11Z) and attempt 2 `e2e (2)` = `failure` (19:54:02–19:57:35Z).
   - The hel1028 red was therefore attempt 2, which matches the table and the "not acquired by a runner" note. The Findings line names attempt 1.

### Phase 2: Code Review — PASS

Gates I ran myself in WORKTREE_PATH on 6c7d6bc3:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0, zero warnings |
| `npm run format:check` | clean |
| `npx playwright test --list` | 175 tests in 36 files |

No `frontend/**` or `backend/**` file changed, so Jest, the frontend build and `sbt testFull` are not triggered.

Local guard verification, following C2:
- Both guard specs were run twice with `--workers=2` under `nice -n 19`.
- Servers came from `scripts/concertino/start-servers.sh` on ports 6720/9627, started fresh by this evaluator (PIDs 736672/736801 for sbt, 736981/736996 for npm/vite). Both runs used their own headless Playwright context.
- After the runs I stopped the servers by those PIDs and ran `sbt --client shutdown` as its own call ("no sbt server is running"). Both ports were then free.
- Results:
  - Run 1: 28 passed (2.2 m).
  - Run 2: 28 passed (1.9 m).
- Per-view comparison against main run 37337348981, using the same script as cycle 1:
  - Run 1: 46/46 equal, `/sources:sidebar-rail` 3/3.
  - Run 2: 46/46 equal.
- Every cell logged `unresolvedFraction=0.000`.
- There are exactly 10 focus view lines and 36 state-surface view lines.
- The worktree was clean afterwards, with Playwright output kept in the scratchpad.
- This proves the gates are satisfiable and that the population is stable locally. It does not prove the CI-timing race is closed; that re-proof is PENDING-CI under task 3.1, as profile.md now states.

Code review of the cycle-2 diff:
- The gates are web-first and scoped to seeded content that already exists (`SOURCE_NAME` was extracted and reused in the overlays replay).
- The gates add no new fixed waits.
- The softened `registerAndLogin` comment now states that the claim is not root-caused, which addresses the cycle-1 note.

No issues.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: FAIL

The code is in a passing state. The remaining defects are two inaccurate statements in the committed evidence artifact. Both are doc-only fixes.

### Change Requests

1. In `openspec/changes/halve-e2e-ci-job-time/profile.md` Findings, in the hel1094 bullet, replace "At that head (c4328881) no parallel-mode file existed" with the true evidence: shard 2 of 37356358733 contained only non-parallel-mode files (hel1065, hel1079, hel1080, hel1085, hel1087, hel1088, hel1090, hel1094, hel1095). The two guard files at c4328881 were parallel-mode, but they ran in other shards.
2. In the same section, rewrite the hel1028 bullet as: 37362375592, shard 2, **attempt 2** (attempt 1 of that leg was cancelled, never run), `boundingBox()` null, fixed in 4b0113a3. Remove the "attempt 1... recorded as attempt 2 above" text.

### Non-blocking Suggestions

- The hel1260 Findings entry states a cause (an auto-selected dashboard fires the repair POST before the listener attaches) as fact without citing a probe or log line. Either cite the evidence, such as the CI log or trace lines showing the early POST, or label it a hypothesis for HEL-1289. MISTAKES.md and the systematic-debugging law apply here.
- For the eventual task 3.1 CI re-proof, compare all 46 per-view lines on every leg of each of the three green runs, not one run. The original deviation appeared in 2 of 3 runs on the same code.
- The commit 6c7d6bc3 includes `evaluation-1.md` in the branch. That is fine as change-dir history. Just note that evaluation reports now ship in the PR diff.
