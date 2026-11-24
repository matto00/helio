## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `abde4c814428c48a6f68a9cb042f02c954a239c7` against base `cd23c664a` (resolved live). Lane servers 7262/10169, lane DB `helio_hel1830`.

### Phase 1: Spec Review — FAIL

The code meets every AC. The FAIL is about the written record: two planning artifacts describe a different fix shape from the one the code implements.

- AC item 1 (counts logged, highest well under the limit): met. Each owner test now runs as its own principal on its own seeded board, one per (theme, width). Every principal logs a `REQUEST-COUNT` line and pushes it as an annotation. My fresh run measured owner max-60s at 29/29/30/29/29/30 and owner-live-regions at 13. Committed evidence: highest owner value 30 at 1x (20 runs) and 31 at CPU 4x (5 runs, 51 STRESS-ACTIVE lines).
- AC item 2 (a deterministic stale-tap probe shows the wait matters): met. See the Phase 2 analysis.
- AC 20x: committed evidence shows 20/20 for each file. I re-ran each full file fresh (below).
- No assertion was loosened. In `checkCounterCard`, every `expect` and message is the original HEL-1791/HEL-1804 one, moved unchanged. The hel1582 hunk adds one wait and nothing else. There are no retries, timeout increases, skips or fixmes.
- **Issue (planning artifacts do not match the implementation, and the design's recording requirement is not met).** design.md Decision 1 requires that "the projection and the chosen shape are recorded in `root-cause.md`".
  - `root-cause.md:5-6` says: "Fix shape: one principal and board per (owner theme test) as designed (Decision 1); the fallback was NOT needed".
  - The code implements the fallback, one principal and board per (theme, width) (`e2e/hel1791-compact-counter-stack-height.spec.ts:292-296`). Its own comment explains why: "one owner test per theme still projected over 60 (seeding 17 + run wait + three page loads, about 60)". That projection matches `t1-count-unfixed-shared-owner.txt`: seeding 17 plus 43 for the first theme test is already 60, which is over Decision 1's threshold of 50.
  - So root-cause.md states the opposite of what was done and does not record the projection. It also conflates C19 (the post-fix threshold of 60) with Decision 1's pre-fix projection threshold of 50.
  - `proposal.md:12-13` ("each owner theme test (light, dark) runs as its own owner") also describes the superseded per-theme shape.
  - These statements will flow into the PR body and the auditor's reading.
- All tasks are marked done and match the work. Item 2 outcome (i) was reached, so 3.3 is correctly a no-op.
- Scope: e2e files and the change dir only. No app, schema, backend or CI files, and none of HEL-1828/1829's files.
- CONSTRAINTS C15-C19:
  - C15: full-file timing was recorded. hel1582 was batched at 3 runs or fewer per call.
  - C16: every stress mechanism is committed as a generator `.txt` with STRESS-ACTIVE proof.
  - C17: both mutation `.txt` files show `git status --short` with no app file.
  - C18: conclusions are backed by committed probes.
  - C19: post-fix maxima are 30 (1x) and 31 (4x), both at most 60.

### Phase 2: Code Review — PASS

Gates I ran myself, fresh, in WORKTREE_PATH. No `frontend/**` or `backend/**` file changed, so the jest, build and sbt gates do not apply.
- `npm run lint`: exit 0. `npm run format:check`: exit 0.
- `eslint --max-warnings=0` and `prettier --check` on the 3 changed e2e files and the change-dir md: both clean.
- `npm run check:e2e-types`, `check:e2e-user-cleanup` and `check:e2e-evidence-paths`: all clean.
- `e2e/hel1791-compact-counter-stack-height.spec.ts`, full file, `--workers=2`, `nice -n 19`: 10 passed (50.0 s). Output: `.concertino/scratch/HEL-1830/eval1-1791-run1.txt` (main checkout).
  - REQUEST-COUNT owner max-60s: 29/29/30/29/29/30. editor: 40, then 73 cumulative. measurer: 36. owner-live-regions: 13.
  - count429 was 0 on every line. The 10 throwaway users were deleted.
- `e2e/hel1582-mobile-pipeline-motion-and-states.spec.ts`, full file, `--workers=2`, `nice -n 19`: 8 passed (2.6 m). Output: `.concertino/scratch/HEL-1830/eval1-1582-run1.txt`.

Checks the orchestrator asked for:
- **Does the counter count what the limiter charges?**
  - `RateLimitDirective` keys on the `helio_session` cookie, or on a PAT. A request with no credential is not limited.
  - The counter counts page traffic via `context.on("request")` and setup calls by wrapping `context.request.fetch`. Playwright's `get`/`post`/`delete` delegate to `fetch`, and the wrapper is attached before `registerUser`.
  - `t1-probe-context-request-events.txt` shows that `APIRequestContext` calls do not fire the context `request` event, so nothing is counted twice.
  - `POST /api/auth/register` (no cookie yet) and requests fulfilled by `page.route` (`markFulfilled`, live-regions test) are recorded as uncharged. That is correct.
- **One-window cross-check: is there really no rollover?**
  - `t1-window-crosscheck.txt`, 3 runs: Retry-After 54 s gives a window age of 6 s, against 6.3-6.4 s elapsed since the first charged request (difference 0.3-0.4 s, well inside 2 s).
  - charged 29 + remaining 89 = 118, within 3 of 120. That is genuinely one window.
  - The generator `.txt` is committed and computes these values from live data.
- **Is the item-2 coordinate stand-in a real stale-tap demonstration?** Yes.
  - `StepPreviewTable.tsx:301-303` renders `.step-preview__count` conditionally, before the disclosure trigger in the header. Its arrival therefore shifts the trigger.
  - The probe holds `steps/:id/preview`. It records the trigger centre (188,439) after the sheet animations finish with the count absent, releases the response, and taps that point. `elementFromPoint` there returns `span.step-preview__count`, and the panel does not open.
  - The settled centre (249,439) opens the panel. This holds at both 375 and 390 width.
  - The unheld 1x per-frame log independently shows the count arriving at about 135 ms and moving the trigger from x=188 to x=249.
  - The off-screen mutation still reds at `dark step sheet: right inside the viewport`, so the cell still asserts.
- **Do the run-terminal wait and the explicit openStack targets exist?** Yes.
  - The run-terminal wait is at `seedBoard`, spec lines ~138-148: `expect.poll` on `lastRunStatus`, intervals of at least 500 ms, message `${at}: seeded run finished`. It applies to both the per-test boards and the beforeAll board.
  - The `openStack` `target` parameter no longer has a default (line ~203). Every call site passes `{ id, items: 7 }`, and the module-level `dashboardId` is gone.
- **Does cleanup delete what each per-test board created?**
  - `deleteBoard` deletes the dashboard (panels and grants go with it), then the pipeline, then all 3 sources. The Output, runs and binary_refs cascade on pipeline delete (`V94` and `V24` `ON DELETE CASCADE`).
  - My run logged no `HEL-1830 cleanup:` warnings, so every DELETE returned 2xx. The lane DB has 0 `HEL1791%` dashboards, pipelines, sources or outputs and 0 `hel1791-%` users.
  - The live-regions test creates no pipeline, so Decision 9(d) needs nothing there.
- **Was the hel1582 run-11 handling sound?** Yes.
  - The failing test (:527, contrast) is outside the diff. It failed on a 240 s test timeout while the 1-worker run took 6.7 m and host load was 11-13. Three solo reruns took about 15 s.
  - The failure was disclosed in full, and the streak was restarted rather than discounted. Runs 12-31 are 20 consecutive passes, and my fresh run also passed.
  - No root cause is claimed, and the root-cause.md wording correctly says so.

Code quality:
- `seedBoard` and `deleteBoard` are a clean DRY extraction.
- `attachContextApiCounter` reuses the existing `ApiRequestCounter` and `maxSlidingWindow` rather than duplicating them.
- No `any`. The `fetch` override cast mirrors the existing `attachApiRequestCounter`. No dead code.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The e2e runs above are the behavioral verification.

### Overall: FAIL

### Change Requests
1. Correct `openspec/changes/harden-hel1791-hel1582-e2e/root-cause.md:3-6` so it records what Decision 1 requires:
   - The pre-fix projection with its numbers. From `t1-count-unfixed-shared-owner.txt`: seeding 17, plus 43 for the first theme test, is 60 before the run wait. That is above Decision 1's threshold of 50.
   - That the per-(theme, width) fallback was therefore chosen and implemented: 6 owner tests, each its own principal and board.
   - Keep the C19 post-fix maxima (30 at 1x, 31 at 4x) as a separate statement. Remove "as designed" and "the fallback was NOT needed".
2. Update `proposal.md:12-13` (What Changes) to describe the implemented shape: one owner principal and board per (theme, width) test, 6 tests.

This is a documentation-only fix. The code, evidence and gates need no change, so a re-evaluation only has to confirm these two files.

### Non-blocking Suggestions
- Editor follow-up candidate: the shared editor principal, used by both editor theme tests, measures max-60s of 73-74 at 1x (80 at 4x), above the design's threshold of 60. root-cause.md already reports this correctly per Decision 2. The same-shape fix (one editor principal per theme test on the beforeAll board) is for the orchestrator to decide.
- The cross-check's 2-request gap (118, not 120) is left unexplained. It is within the design's tolerance of 3 and immaterial against 30 out of 60. A possible cause is a request the browser starts on page close that the context events miss.
- Follow-up candidate: the hel1582 :527 contrast test hit a 240 s timeout under host load 11-13. If it recurs, add it to C11 as a flake candidate.
