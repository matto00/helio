## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD b36e38858d4fc85d6930a7b638ee40ebe7771dc5. The base is 07a1180016b8032c9c16f2514aa8a8c0319cb776, resolved
live. Cycle 2 adds commit b36e38858 on top of the cycle-1 commits, which were reviewed in `evaluation-1.md`.

### Phase 1: Spec Review — PASS

- **CR1 (C12 disclosure) is addressed.** The new section in `root-cause.md` states that only T1's red was committed before
  its fix. It also says:
  - the T2 stand-in red and the T3 reds landed in 46c81740e, together with their fixes;
  - the proof that the T3 reds ran on the unfixed spec is the line arithmetic: :139 = unfixed 126 + 13-line hook, where
    the fixed spec would give :155;
  - T2 has no natural red, and `t2-stale-tap.txt` is its deterministic stand-in;
  - history was not rewritten.

  The deviation is recorded honestly, and the content proof stands. A commit order that never happened cannot be
  created after the fact, so disclosure is the correct remedy.
- **C15-C18 still hold.**
  - C16: the regenerated `t1-stress-diff.txt` now comes with a stressed full-file run of exactly that generated copy
    (`t1-stress-fresh-run-cycle2.txt`). Its 6 tests all pass, and the output carries `STRESS-ACTIVE` lines for every
    actor, including `owner-live-regions`.
  - C17: the re-run `t3-mutation.txt` ends with a `git status` showing no app file.
- **No probe spec is committed.** `git ls-files e2e` and the e2e directory listing contain no `probe-hel1826-*` file.
- Scope is unchanged (`e2e/` and the change dir only).

### Phase 2: Code Review — PASS

- **CR2 is addressed.**
  - In `e2e/hel1572-appearance-preferences.spec.ts:47-57`, `waitForResponse` now has `{ timeout: 10_000 }` and fails
    with "the <style> preference save was never answered within 10 s".
  - Mutation 1 (save never sent) is now red at exactly that message, at spec line 56 (`t3-mutation.txt`).
  - The predicate is unchanged, and the 200-status assertion is kept.
- **Cycle-1 non-blocking item 1 is now done.** `t1-alert-regex-failable.txt` routes a different message. It goes red at
  `alert message: text` and shows `Received "HEL1826 a different message"`, so the tightened regex discriminates.
- **Gates I ran myself:**
  - eslint `--max-warnings=0` on the changed spec: exit 0.
  - prettier `--check` on the spec and the change dir: clean.
  - `tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- **My own fresh runs of the hel1572 spec file at HEAD.**
  - 5 runs at 2 workers and `nice -n 19`, on lane DB `helio_hel1826` with `ANTHROPIC_API_KEY` empty.
  - Servers were started with `start-servers.sh` on 7258/10165.
  - All 5 runs were green, 15 passed each. The log is `.concertino/scratch/HEL-1826/eval-c2-t3-runs.txt`.
- **The executor ran only one full-file pass after this change, not a fresh 20x.** That is acceptable here, for three
  reasons:
  - the change only bounds an existing wait;
  - on the passing path the response arrives in well under 1 s, so the 10 s bound is never reached and timing is the
    same;
  - my 5 fresh full-file passes add evidence on top of that.
- The hel1791 and hel1582 specs are unchanged since cycle 1, when I re-ran them (6/6 and 1/1 green).

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: PASS

### Non-blocking Suggestions
- The new test in hel1791 repeats the counter source and panel config from `beforeAll`. A shared constant would keep
  them from drifting. This is carried over from cycle 1.
- A follow-up for the orchestrator: the app sends type-style preference saves (`PATCH /api/users/me/preferences`) with
  no ordering, so the last one to arrive wins. Once the app orders those writes, its fix should also add back an e2e
  guard that rapid toggling ends on the last choice.
