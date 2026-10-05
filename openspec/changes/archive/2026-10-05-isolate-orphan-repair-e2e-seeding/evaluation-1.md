## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 98327f763c955d67d7a85090728461b9edf29599 against the live-resolved base fba0d78f88db1523b4afbe957fa363d4994047ae
(`resolve-review-base.sh`). Spawn guard: `READY ambient=/home/matt/Development/helio branch=bug/orphan-repair-e2e-flake/HEL-1289`.

Changed files: `e2e/hel1260-orphan-owner-repair.spec.ts` plus the change dir. There are no `frontend/**`, `backend/**`,
`playwright.config.ts`, `.github/workflows/ci.yml`, `schemas/**` or `openspec/specs/**` changes.

### Phase 1: Spec Review — PASS
Issues: none.

- AC "reproduce + failure rate": the probe reports 10/20 failures. I re-verified this against the probe's own traces
  (`scratchpad/probe1/results`): 10 `error-context.md` files. My independent classifier (`scratchpad/eval/classify_old.py`, ms units, page-frame only)
  gives `{pre-goto(/): 10, old-page-in-flight: 8, explicit-open: 2}`. The 10 failures are the 10 runs where `/` sent the
  repair before the goto, which matches the probe and the skeptic's correction.
- AC "root cause named": `probe-root-cause.md` gives the mechanism and includes the skeptic's correction (18/20 runs repaired from `/`).
- AC "test defect → fix test, explain why product is correct": design.md Context argues that the `/` auto-select repair is intended
  (HEL-1233 D4, the HEL-1260 ruling). The skeptic confirmed it. There is no product change.
- AC "N>=20 consecutive green": I re-ran it myself and got 20/20 (see Phase 2).
- Owner rulings: no quarantine. No assertion is loosened or timeout lengthened. Both `toHaveCount(1, 15_000)`, the `poll toBe(1)` at 15 s,
  the body keys equal to all four breakpoints, every breakpoint stored with the panel, no "Unsaved changes", the 2 px reload checks,
  final `repairPosts` length 1 and `layoutPatches` length 0 are all present (spec lines 83-112). Several are stronger:
  - repair counting covers the whole page lifetime (listener at line 49, before login);
  - a new `expect(repairPosts).toHaveLength(0)` before the goto (line 83);
  - the URL is pinned to the seeded id (line 88);
  - the PATCH filter is broadened to any `/api/dashboards/` (line 52).
  `playwright.config.ts` and `ci.yml` are untouched, and HEL-1294 is untouched.
- Tasks 1.1-2.6 are marked done and match the diff. Task 2.3 is marked done, but verification.md states honestly that it was not reproduced red.
  That is acceptable because 2.3 asked to "record that it flakes", and the record is truthful. See the evidence judgment below.
- CONSTRAINTS C1 (non-retired) is honored. The executor's `probe-check-isolation.py` compares `_monotonicTime` and `startTime`, both in ms. It
  attributes a repair to the explicit open only if the repair starts after the post-goto page-frame `GET dashboards/<id>/panels`.
  My own classifier applies the same rule.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (fresh, run by me in WORKTREE_PATH):
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- `npx eslint --max-warnings=0` on the spec: exit 0. `npx prettier --check` on the spec: clean. `npx tsc --noEmit -p e2e`: clean.
- The frontend/backend unit gates (`npm test`, the build, `sbt testFull`) were not triggered, because no `frontend/**` or `backend/**` files changed.
- Servers: `start-servers.sh` reused 6721/9628. I confirmed with `/proc/<pid>/cwd` that both belong to this worktree
  (`.../HEL-1289/frontend` and `.../HEL-1289/backend`). The product source is identical to base, so a stale server is not a concern.

Acceptance run (fresh, mine):
`DEV_PORT=6721 BACKEND_PORT=9628 nice -n 19 npx playwright test e2e/hel1260-orphan-owner-repair.spec.ts --repeat-each 20 --workers 2 --trace on`
→ **80 passed (3.9m), exit 0**: 4 tests x 20 repeats, so 20 consecutive green runs of the spec. Log: `scratchpad/eval/accept.log`.

Independent trace parse of all 80 traces (`scratchpad/eval/classify.py`, ms units, C1 rule) → `{'ok': 80, 'bad': 0}`:
- every trace has exactly one `about:blank` goto and one `/dashboards/<id>` goto;
- there are zero page-frame `/api/` requests between them;
- there are zero repair POSTs before the dashboard goto;
- in all 40 orphan traces there is exactly one page-frame repair POST, status 200, starting after the page's own post-goto
  `GET dashboards/<id>/panels`, at +642 to +791 ms after the goto. That is a genuine explicit open, never the old page in flight;
- all 40 UI-create traces have zero repair POSTs.

This is self-authenticating content evidence (request ordering inside each trace), not mtime ordering.

Red-before / green-after judgment (mutation c): **sufficient.**
- I attempted to reproduce the old ordering red myself. I used the base spec copied to a scratch file
  (`e2e/hel1289-evalscratch-old.spec.ts`, removed by exact literal path afterwards; `git status` clean), `-g "owner open"`,
  `--workers 2`, `nice -n 19`, plus 2 `nice -n 19` busy-loop load processes killed by their recorded PIDs
  (889533/889534 and 892623/892624, confirmed dead). Results: 20/20 and 40/40 passed. **It was not red here either.**
- But the traces show the old ordering's defect is live. In 10/20 and 27/40 runs (37/60 in total), the counted repair POST
  was sent by the old `/` page, in flight when navigation began (before the new page's own GET panels). It was counted only
  because the listener happened to be attached a few ms earlier. Red is the same event starting about 5-25 ms earlier,
  which is load and timing dependent. The probe's 10/20 red (traces independently re-classified by me and by the skeptic)
  and the three CI reds are that case.
- The fix removes the precondition structurally rather than statistically. Across 80 traces there are 0 page-frame `/api/` requests
  in the seeding window, and 0/40 orphan runs had any non-explicit-open repair, against 37/60 for the old ordering in my own runs.
  Mutations (a) and (b) (recorded RED by the executor) show that the "exactly one" poll is still failable in both directions.
  I did not re-run (a) and (b). They require product-source mutation, and their failability is evident from the
  assertions (lines 87 and 110) and the whole-lifetime counter.

Code quality: the diff is small, focused and readable, and the comments explain why. There is no dead code and no new escape hatches beyond the pre-existing
`!` on `boundingBox()`. CONTRIBUTING [mechanical] rules: no violations found in the diff. DESIGN.md: N/A, since no UI source changed.

### Phase 3: UI Review — N/A
No UI-trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The e2e evidence above exercised
the running app on the lane's own servers anyway.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `e2e/hel1260-orphan-owner-repair.spec.ts:88`: `expect(repairPosts[0].url).toMatch(new RegExp(`/api/dashboards/${dashboardId}/layout/repair$`))`
  (or `toContain`) would print the actual URL on failure, where `.endsWith(...)).toBe(true)` prints only true/false.
- `verification.md` 2.3 could add the evaluator's extra data point: under 2-process load the old ordering stayed green (60/60),
  but the `/` page sent the repair in 37/60 runs. The red baseline remains the probe's.
- `probe-check-isolation.py` classifies a test by `'survives' in name`, which depends on Playwright's truncated output-dir slug.
  It works today (slugs `...on-survives-a-reload-*`), but it is fragile.
