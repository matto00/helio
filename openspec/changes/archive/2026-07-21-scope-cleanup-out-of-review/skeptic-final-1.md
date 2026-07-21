## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ticket / ACs read** — `openspec/changes/scope-cleanup-out-of-review/ticket.md`. Two ACs:
(a) a review agent cannot destroy a live worktree via `cleanup.sh` (not invoked, or
guarded no-op mid-review); (b) fix lands in Concertino source + re-synced, not a
hand-edit of the generated script.

**Cross-repo diff, read directly:**
- `git -C /home/matt/Development/concertino diff main...task/scope-cleanup-out-of-review/hel-325`
  (commit `943d8e1c`) — touches exactly `core/scripts/cleanup.sh`, `core/roles/{orchestrator,evaluator,skeptic}.md`,
  `bin/concertino` (`cmdSync`: `copyAssets(out, dry, false)` → `copyAssets(out, dry, true)`),
  `package.json` (`0.1.3`→`0.1.4`). Confirmed `main` is an ancestor of the task branch
  (`git merge-base --is-ancestor main task/... && echo`), i.e. the branch is current, not stale.
- `git -C WORKTREE_PATH show HEAD` (`30eb907f`) — regenerated `.claude/agents/concertino-{evaluator,skeptic,executor,orchestrator}.md`,
  `scripts/concertino/{cleanup.sh,.concertino.env,start-servers.sh,README.md}`, plus the
  openspec change-dir artifacts. No `frontend/**` or `backend/**` product code touched.

**AC (a) — guard traced to code, not just prose:**
Read `core/scripts/cleanup.sh` in full myself. The guard is the *first* executable
block, before any destructive line (`fuser -k`, `git worktree remove --force`,
`git worktree prune`):
```
if [ "${1:-}" = "--phase4" ]; then
  shift
elif [ "${CONCERTINO_PHASE4:-}" != "1" ]; then
  echo "cleanup.sh: refusing to run ..." >&2
  exit 0
fi
```
`set -euo pipefail` is active; `"${1:-}"` / `"${CONCERTINO_PHASE4:-}"` are both
set-u-safe (no unbound-variable crash on missing arg/env) — read the whole file, not
just the diff hunk.

**AC (b) — genuinely synced, not hand-forged:**
`diff /home/matt/Development/concertino/core/scripts/cleanup.sh WORKTREE_PATH/scripts/concertino/cleanup.sh`
→ **byte-identical** (`diff` produced no output). `.concertino.env` header in the
worktree reads `# concertino:sync v0.1.4`, matching `package.json`'s bumped version.
Both `.claude/agents/concertino-evaluator.md` and `concertino-skeptic.md` carry the
verbatim guardrail bullet from `core/roles/{evaluator,skeptic}.md`; `concertino-orchestrator.md`'s
Phase-4 section (lines 229-236) passes `--phase4` as the first arg, matching
`core/roles/orchestrator.md`.

### Adversarial checks — tried to refute, could not

- **Flag not first** (`cleanup.sh <path> --phase4`): refused as no-op (`exit 0`,
  worktree intact) — only `$1 == "--phase4"` is honored, so a stray call that happens
  to include the flag anywhere but first position is still safely refused.
- **`CONCERTINO_PHASE4=0`** and **`CONCERTINO_PHASE4=` (empty)**: both refuse (no-op,
  `exit 0`, worktree intact) — the check is `!= "1"`, not truthiness, so `0`/empty/
  garbage values don't accidentally enable teardown.
- **`set -u` bite**: none found — both conditionals use `${VAR:-}` defaults.
- Confirmed the no-op path performs **zero** `fuser`, `worktree remove`, or `prune`
  calls before its `exit 0` — verified by reading execution order in the file, and by
  reproduction below (worktree/dir survived every negative-case call).
- `bin/concertino`'s `copyAssets(out, dry, true)` change: single line, matches
  `withScripts` parameter semantics in the function signature I read
  (`function copyAssets(out, dry, withScripts)`) — refreshes `scripts/concertino/*`
  identically for any repo that syncs, which is the intended fix for AC(b) (previously
  `sync` never refreshed shipped scripts, which is exactly how a hand-edit workaround
  could have silently taken root). The "incidental refreshes" in the helio commit
  (`start-servers.sh` env fix, `README.md` additions, executor version bump) are
  pre-existing content already on Concertino `main` (confirmed via `git log --oneline
  main` and inspecting `main:core/scripts/start-servers.sh`) that had never propagated
  to helio before this fix — expected fallout of fixing the sync bug, not scope creep,
  and it's honestly disclosed in both the commit message and `files-modified.md`.

### Independent reproduction (fresh evidence, not trusting the evaluator's report)

- `bash -n` on both `core/scripts/cleanup.sh` (source) and
  `WORKTREE_PATH/scripts/concertino/cleanup.sh` — both OK.
- Created my own throwaway worktree: `git -C /home/matt/Development/helio worktree add
  --detach <scratchpad>/skeptic-throwaway main`.
  - No-flag call, no ports: refusal printed, `exit 0`, worktree directory and
    `git worktree list` entry both still present.
  - `CONCERTINO_PHASE4=0` with real-looking ports: same refusal, worktree intact.
  - `CONCERTINO_PHASE4=` (empty) with real-looking ports: same refusal, worktree intact.
  - `cleanup.sh <path> --phase4` (flag second): same refusal, worktree intact.
  - **Positive control** — `cleanup.sh --phase4 <path> "" ""`: printed
    `READY cleaned worktree=...` and the worktree directory was actually gone
    afterward (confirms the guard isn't a stub that always refuses — the destructive
    path genuinely still works when properly opted in).
  - Second throwaway worktree + `CONCERTINO_PHASE4=1 cleanup.sh <path> "" ""` (env-form,
    no flag): also tore down correctly, directory gone.
  - After both throwaway teardowns, `git -C /home/matt/Development/helio worktree
    prune -v` left no orphaned entries; `git worktree list` shows only the live
    worktree and the origin checkout — no admin-metadata leak.
- **Live worktree confirmed untouched throughout**: `ls -d WORKTREE_PATH` succeeded at
  every step; `git -C WORKTREE_PATH status --short` after all throwaway runs showed
  only the expected in-progress evaluator artifacts (`workflow-state.md` modified,
  `evaluation-1.md` untracked) — no corruption, no missing `.git` admin dir. I never
  invoked `cleanup.sh` against `WORKTREE_PATH` itself, guarded or unguarded, per
  instruction.

### Verdict: CONFIRM

Both acceptance criteria are traced to concrete, independently-reproduced evidence.
The guard is textually in the Concertino source, byte-identically synced into helio
(not hand-edited), and I could not construct any invocation shape (flag position,
env-var falsy values, missing args) that causes destruction without an explicit,
deliberate opt-in. The positive-control runs prove the guard is a real gate, not a
script that merely always refuses. Belt-and-suspenders (agent-role prohibitions) is
present verbatim in both the source and both regenerated helio agent files. No
product/runtime code was touched; no UI surface exists for this change (correctly
skipped per the orchestrator's instruction — dev servers were not started).

### Non-blocking notes

- The evaluator's report says the helio commit used `git commit -n` (pre-commit
  bypass) because `check:openspec` fails on a complete-but-unarchived change; this is
  a workflow-sequencing artifact (archival is a later phase for this delivery), not a
  code defect, and is disclosed in the commit body per CONTRIBUTING.md's bypass-disclosure
  rule. I did not re-run `check:openspec` myself since it's orthogonal to the guard
  logic under review, but the evaluator's stated reason is plausible and specific
  enough that it doesn't warrant blocking.
- Two throwaway worktrees I created for reproduction were fully cleaned up
  (`git worktree remove --force` via the guarded script itself, plus `worktree prune
  -v` afterward) — no residue left in the repo's worktree list or on disk.
