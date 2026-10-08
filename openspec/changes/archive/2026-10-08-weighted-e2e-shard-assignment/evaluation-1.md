## Evaluation Report — Cycle 2 (evaluation-1.md)

Reviewed head: `37becb99b4df683403647c7191b3280737885063` (base resolved live: `e631948db`).
Scope: CI tooling + docs only (`scripts/e2e-shard.mjs`, `scripts/e2e-shard.selftest.mjs`, `e2e/shard-weights.tsv`,
`.github/workflows/ci.yml`, `.husky/pre-commit`, `package.json`, `e2e/README.md`, openspec change dir).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (heavy specs from CI evidence): premise evidence + profile identify `state-surface-contrast-guard.spec.ts` (~273 s, 18 parallel tests) landing wholly on count-based shard 4, from CI JSON artifacts. PASS.
- AC2 (balance): per owner ruling accept-partial (ticket.md, profile.md), measured (a) 20.5 vs <=15 FAIL, (b) 20.5 < 25.5 PASS, (c) 20.5 vs control 20.0 FAIL are recorded plainly as pass/fail lines. Not re-measured and not failed here, per ruling. I independently re-fetched the numbers from the GitHub jobs API:
  - After run 37748264806 attempts 1-5, `Run e2e` step seconds per leg match profile.md exactly (leg1 248/218/231/163/192, leg2 226/171/200/223/237, leg3 212/212/217/171/145, leg4 249/173/245/254/184; all head 4b8f9f71b, all success). Medians 218/223/212/245, mean 224.5, imbalance 20.5 s, as stated.
  - Control runs 37749098184, 37750186857, 37750313498, 37748221338, 37744958037 attempt 1: heads, `run_started_at`, and per-leg step seconds all match profile.md; medians 208/225/201/238, imbalance 20.0 s, as stated.
- AC3 (>= 5 sequential runs, per-shard medians/maxima before and after, leg + step): present in profile.md with run ids/attempts.
- AC4 (HEL-951 contract): discovery is `playwright test --list` over config glob + `testIgnore`; exact-once verified per leg; selection re-listed and verified. Confirmed live (below).
- Tasks 1.1-3.4 all `[x]` and match the implementation.
- Constraints C1-C4 honored:
  - C1: `e2e/shard-weights.tsv` header names runDirs 37742970410-a1..a5 and the generator. I downloaded the still-available attempt-5 artifacts of run 37742970410: `stats.startTime` of the 4 reports (08:02:32.053Z / 08:02:33.918Z / 08:01:50.995Z / 08:02:35.109Z, unexpected=0, flaky=0) match profile.md's attempt-5 authentication rows exactly; recomputing `weights` over that single run yields the same 40-file set with values consistent with a 5-run median (13 rows identical, others within run-to-run variance; total 1629 vs 1665 s). No row for `hel1304-output-charttype-render.spec.ts`, i.e. no hand-added row; it runs `defaulted`, as documented.
  - C2/C4: counting rule, full reruns, fixed after set, failing-run logs in `ci-logs/` (redacted; secret-pattern grep clean).
  - C3: absolute leg time deferred to HEL-1368.
- No scope creep; no API contract/schema impact.

### Phase 2: Code Review — PASS
Gates run fresh by the evaluator in WORKTREE_PATH (no `frontend/**` or `backend/**` files changed, so the frontend/backend gate set is not triggered; ran the gates relevant to the changed files instead):

- `npm run check:e2e-shard:selftest`: 15/15 cases pass, exit 0.
- `npm run check:precommit-ci-parity`: OK; `check:e2e-shard:selftest` is in both the hook and the ci-complete-covered set.
- `npx eslint --max-warnings 0 scripts/e2e-shard.mjs scripts/e2e-shard.selftest.mjs`: exit 0.
- `npm run format:check`: clean.
- `ci.yml` parses as YAML; `npm run check:openspec` clean; `check:repo-integrity` clean.
- `DEV_PORT=6793 node scripts/e2e-shard.mjs plan 4`: exit 0. 41 discovered files across legs of 8/11/11/11 files, weighted 423/426/422/422 s, with `hel1304-output-charttype-render.spec.ts` the only `defaulted` file and no stale rows.
- Independent partition check (a scratch script importing the module's exports, separate from the selftest): the union of the 4 legs equals Playwright's discovered set exactly. For every leg, re-listing with the anchored `fileArg` regexes returns exactly that leg's assignment (8/11/11/11), so `verifySelection` passes against real Playwright. A mutation that drops a file from leg 3 is rejected naming `hel908-trunk-reorder-drag.spec.ts`.

Code-quality review: the LPT mirrors `TestShards.scala`. Errors are loud and name files. A signal-killed child maps to a non-zero exit. An empty leg refuses to run. `--list` uses a stdout JSON reporter, so it never clobbers the CI `results.json` artifact. `weights` refuses an incomplete or unclean runDir. No dead code, no TODOs, no type escapes. No blocking issues.

### Phase 3: UI Review — N/A
No UI-affecting files changed (no `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**`; the spec delta is under `openspec/changes/`).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `scripts/e2e-shard.selftest.mjs:122-126`: the test named "empty shard: CLI refuses and never reaches Playwright" actually exercises the `run 5 4` usage guard (`index > count`), not the `mine.length === 0` refusal in `run` (`scripts/e2e-shard.mjs:~238`). Rename it to "out-of-range index is refused", or extract the empty-leg guard into a pure function and test it, so the D7 "empty-shard refusal" claim is literally covered.
- `openspec/changes/weighted-e2e-shard-assignment/specs/e2e-ci-sharding/spec.md`: the "e2e shard balance is measured in CI" requirement (SHALL <= 15 s and below the control) will be archived into `openspec/specs/`, but the change that introduces it measurably does not meet (a) or (c) (owner-accepted). Consider a one-line note in the spec or the archive commit pointing to the accept-partial ruling and HEL-1368, so a future reader does not take the requirement as satisfied by its originating change. This is the orchestrator's or owner's call at archive time.
- `profile.md` "Summary" (top section) still describes the pre-merge run 37676655366 and an old "whole-leg median <= ~390 s" bar. Add a one-line "historical; superseded by Final measurement (task 3.4) below" marker.
- `scripts/e2e-shard.mjs` is 289 lines, slightly over CONTRIBUTING's ~250-line soft budget (informational only).
- `scripts/e2e-shard.mjs` `plan` mode does not validate `<count>` (e.g. `plan x` yields NaN legs and fails via verifyExactlyOnce with a confusing message). The CI path (`run`) does validate it.
