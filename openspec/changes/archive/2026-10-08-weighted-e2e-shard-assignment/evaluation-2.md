## Evaluation Report — Cycle 2 re-check (evaluation-2.md)

Reviewed head: `da1d9a8b3601ae5c87db6560800c863b3da5a2a1`. Base was resolved live as `76816d406` (origin/main).
This report covers the delta since my evaluation-1 PASS at `37becb99b`:
- `05837606`: `plan` count validation, the selftest rename, the README/spec accept-partial notes, committed failed-run logs, and the profile summary marked historical.
- `ffed1ab3`: archive.
- `7ec80566`: gate-chain checklist and isolation evidence.
- Two `origin/main` merges.

Everything from evaluation-1 still stands, except where this report says otherwise. The owner's accept-partial ruling on AC2 is unchanged: not re-measured, not failed.

### Phase 1: Spec Review — FAIL
Issues:
- **Dangling path in a delivered doc.** `e2e/README.md:103` cites `openspec/changes/weighted-e2e-shard-assignment/profile.md` as the source for the acceptance bar and the before and control values. The archive commit `ffed1ab3` moved that directory to `openspec/changes/archive/2026-10-08-weighted-e2e-shard-assignment/`. The cited path no longer exists at this head; I confirmed this with `ls`. A grep for `changes/weighted-e2e-shard-assignment` outside `archive/` hits only this line. A reader who follows the README's own pointer to verify the bar finds nothing. CONTRIBUTING "Documentation" requires naming the file so the next reader can re-verify, and this name now resolves to nothing.
- Everything else in the delta is correct:
  - The spec-delta note matches the measured and ruled numbers (20.5 / 25.5 / 20.0, accept-partial, HEL-1368). It is also present in the synced `openspec/specs/e2e-ci-sharding/spec.md`.
  - The profile summary is marked HISTORICAL.
  - The 7 newly committed `*-FAILED.log` files match the run and attempt rows in the profile table, which honours C2. A secret-pattern grep over them is clean.
  - The design.md gate-chain checklist accurately describes the selftest: no git, no file writes, and one `node` child that exits at argument validation.
- Constraints C1–C4 are still honoured. `e2e/shard-weights.tsv` is unchanged since evaluation-1, and `hel1304-output-charttype-render.spec.ts` is still `defaulted`, not hand-added.

### Phase 2: Code Review — PASS
I re-ran these gates myself in WORKTREE_PATH at `da1d9a8b3`:
- `npm run check:e2e-shard:selftest`: 15/15, exit 0.
- `npm run check:precommit-ci-parity`: OK.
- `npx eslint --max-warnings 0` on both scripts: exit 0.
- `npm run format:check`: clean.
- `npm run check:openspec`: clean.
- `plan` count validation (new): `plan x`, `plan 0`, `plan -1` and `plan 2.5` each exit 1 with `usage: plan <count >= 1>`.
- `DEV_PORT=6793 node scripts/e2e-shard.mjs plan 4`: exit 0. Legs are 8/11/11/11 files, weighted 423/426/422/422 s. `hel1304-output-charttype-render.spec.ts` is the only defaulted file, and there are no stale rows.
- Independent partition check: discovered 41 files; the legs' union is 41, with 41 unique.
  - `verifyExactlyOnce` passes.
  - Each leg's anchored `fileArg` selection, re-listed through real Playwright, equals its assignment (8/11/11/11).
  - Dropping a file is rejected, and the error names it.

Code delta review:
- `scripts/e2e-shard.mjs:279-283`: the validation is correct and mirrors `run`'s integer and `>= 1` guard.
- The selftest rename makes the test name honest. It now describes the out-of-range-index case it actually exercises.
- No new issues.

### Phase 3: UI Review — N/A
No UI-affecting files changed by this ticket. The `openspec/specs/**` additions are the synced e2e-ci-sharding spec (CI tooling) and a main-merge pipeline-output-sheet spec; neither changes UI behaviour.

### Overall: FAIL

### Change Requests
1. In `e2e/README.md:103`, replace `openspec/changes/weighted-e2e-shard-assignment/profile.md` with `openspec/changes/archive/2026-10-08-weighted-e2e-shard-assignment/profile.md`, the path the archive actually produced. Then confirm that `grep -rn 'changes/weighted-e2e-shard-assignment' --exclude-dir=node_modules --exclude-dir=archive .` returns zero hits.

### Non-blocking Suggestions
- `openspec/specs/e2e-ci-sharding/spec.md`: the delivery note says "(see profile.md)" with no path. After archive this cannot be resolved from `openspec/specs/`. Consider naming the archived path, as in CR 1.
- The suggestions from evaluation-1 about the empty-leg guard still apply: it has no direct test. Extracting it into a pure function and testing it would close that gap.
