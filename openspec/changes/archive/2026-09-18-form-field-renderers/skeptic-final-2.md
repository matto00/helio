## Skeptic Report — final gate (round 1, skeptic-final-2.md)

Scope: Phase-4 fold-in only (tasks.md group 5.1–5.3, design.md D11, ticket.md
"Fold-in scope") — two MISTAKES.md trap entries, docs-only. The original
form-field-renderers delivery (PR #672, b1b954e3) already merged and is out
of scope here.

### What I verified (with evidence)

1. **Diff scope guard.** `resolve-review-base.sh main origin` → base
   `19d16159c41ff17463436a6d502705e5c409ca4`. `git diff <base>...HEAD --stat`
   touches only `MISTAKES.md` and `openspec/changes/form-field-renderers/**`
   (the archive→active restore rename plus `skeptic-design-2.md`), matching
   `files-modified.md`'s claim exactly. Single commit `bf8f5808` on HEAD.

2. **`.husky/pre-commit` chain accuracy.** Read the file directly: 23 npm
   scripts in sequence (repo-integrity, lint, typecheck ×3, format:check,
   schemas, spec-structure, openspec+selftest, dependabot+selftest,
   scala-quality, test-temp-dir-hygiene+selftest, no-credential-leak+selftest,
   tokens+selftest, then full `npm test`) — the new entry's description of
   "repo-integrity, lint, three typechecks... Prettier, and
   schema/spec-structure/openspec... then the full Jest suite" is accurate
   and not overclaimed.

3. **`await-sentinel.sh` mechanism.** Read the full script. Usage signature
   `<SENTINEL_PATH> <TIMEOUT_SEC> [POLL_INTERVAL_SEC]` matches the entry's
   citation exactly. `MAX_TIMEOUT_SEC` default 1800s, enforced by an explicit
   check that fails closed if exceeded — matches the entry's "hard cap 1800s"
   claim. The script polls sentinel-file existence only (`while [ ! -f
   "$SENTINEL" ]`), never a process/pattern match — its own header comment
   explicitly documents this as the CON-178 fix for exactly the self-match
   deadlock the second entry describes. Matches the entry's claims precisely.

4. **`git rev-parse --git-dir` / `COMMIT_EDITMSG` recovery path and hook
   ordering.** `man githooks`: pre-commit "is invoked before obtaining the
   proposed commit log message and making a commit"; prepare-commit-msg (the
   hook that writes `COMMIT_EDITMSG`) "is invoked ... right after preparing
   the default log message, and before the editor is started" — i.e.
   strictly after pre-commit exits 0. This confirms the entry's recovery
   mechanism is sound: `COMMIT_EDITMSG`'s appearance is a valid, correct
   signal that the pre-commit chain has finished (not a false-positive-prone
   proxy), so waiting on it via `await-sentinel.sh` rather than "re-running"
   is the right recovery.

5. **`cleanup.sh` refusal logic (CON-171).** Read `worktree_holders()` and
   the Phase-4 guard: cleanup.sh does a `/proc/<pid>/cwd` scan and refuses
   destructive teardown (after a bounded 250ms/3s settle window) when a live
   process holds the worktree as its cwd, corroborating the second entry's
   claim that "the leaked shell then holds the worktree open against
   `cleanup.sh`, which cannot reclaim a worktree with a live process inside
   it." True, not exaggerated (cleanup.sh's actual holder-detection is
   `/proc` cwd scanning, not `pgrep`, but the entry never claims cleanup.sh
   itself uses `pgrep` — it only cites the anchored-`pgrep` pattern as the
   general fix technique for a hand-rolled poll, consistent with C2 in the
   same tasks.md and with the existing "Never invoke npm/vite/sbt bare"
   entry's style of prescribing a safe alternative).

6. **Anchored pgrep pattern.** `pgrep -c -f '^bash .*<script>'` is not
   found verbatim anywhere in `scripts/concertino/`, but the entry does not
   claim it is — it's prescriptive guidance (also promoted to Standing
   Constraint C2 in this change's own tasks.md), not a citation of existing
   code. No false claim here.

7. **Live evidence for the first entry.** `git log` shows HEAD (`bf8f5808`)
   as a single, clean commit — consistent with the ticket's account that the
   executor's own first `git commit` this round was itself backgrounded
   mid-hook and recovered via the `await-sentinel.sh`/`COMMIT_EDITMSG` path
   the new entry prescribes, without a re-run (no evidence of a duplicate or
   partial commit in the log).

8. **Format/lint gate.** `npm run format:check` → "All matched files use
   Prettier code style!" (exit 0), confirming root Markdown is checked and
   clean, matching tasks 5.1/5.2's verification step and the claim that root
   markdown is Prettier-checked.

9. **Placement and voice.** Both entries sit under `## Tooling`, immediately
   after the "Linear: closing an epic cascades to its children" entry, per
   design.md D11 and tasks.md 5.1/5.2. Voice matches sibling entries: names
   the mechanism, the silent-failure shape, and a concrete recovery/anchor,
   closing with a ticket/CON citation — consistent with the file's
   established style (e.g. the `start-servers.sh` and epic-cascade entries
   immediately above).

10. **Traceability to artifacts.** tasks.md 5.1–5.3 all ticked; design.md
    D11 describes exactly this fold-in and correctly notes no spec delta
    (`--skip-specs` on re-archive, since the only spec delta already merged
    with the first delivery); ticket.md's "Fold-in scope" section states the
    added acceptance criteria verbatim-consistent with what's now in
    MISTAKES.md; files-modified.md accurately describes all three changed
    surfaces including the archive→active restore rename.

### Non-blocking notes

- The `pgrep -c -f '^bash .*<script>'` anchor form isn't itself exercised
  anywhere in this repo's tracked scripts (only `await-sentinel.sh`'s header
  comment discusses the failure mode it fixes). Not a defect — this is
  intentionally illustrative guidance, and is already codified separately as
  Standing Constraint C2 — but a future reader mining MISTAKES.md for a
  working example won't find one in-repo; only `await-sentinel.sh` is a
  real, runnable mitigation today.
- No gate-defect finding to record here: no report in this drilldown chain
  disclosed unsound evidence-directory mtimes that this gate then relied on;
  all evidence I used (diff stat, file contents, man-page hook ordering,
  format:check output) is self-authenticating, not mtime-derived.

### Verdict: CONFIRM
