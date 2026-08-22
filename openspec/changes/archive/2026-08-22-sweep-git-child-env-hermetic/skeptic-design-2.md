## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read fresh, in full: `proposal.md`, `design.md`, `tasks.md`,
  `specs/git-hook-hermeticity/spec.md` (current on-disk contents, not the
  orchestrator's summary).
- **CR1 (prefix strip, not six-name denylist) — ADDRESSED.** `design.md:34-55`
  now specifies `git_child() ( unset -v $(compgen -v GIT_ 2>/dev/null)
  2>/dev/null || true; exec git "$@" )` in a `()` subshell; `tasks.md:3-10`
  matches. The old `env -u` six-name chain is gone.
- **Mechanism verified by direct execution** (not taken on faith):
  `export GIT_DIR=/x GIT_EDITOR=vi; f() ( unset -v $(compgen -v GIT_ ...); exec env ); f | grep -c '^GIT_'`
  → `0`, and the parent shell still reports `GIT_DIR=/x`. Both the strip and
  the subshell no-leak property hold.
- **CR2 (false denylist rationale) — ADDRESSED.** `design.md:34-43` now cites
  `scripts/lib/git-child-env.mjs`'s own "denylists fail open" doc-comment and
  `nonGitChildEnv` as the mirrored precedent.
- **CR4 (selftest self-strips; non-`check:` script name) — ADDRESSED.**
  `design.md:71-83`, `tasks.md:27-30` (self-strip as first executable
  statement, before fixture build/poison export) and `tasks.md:45-50`
  (`npm run selftest:concertino-git-env`, with the rationale comment required
  at the wiring site, not added to `.husky/pre-commit`).
- **CR5 (permanent dual-arm assertion) — ADDRESSED.** `design.md:84-90`,
  `tasks.md:36-41`, and `spec.md:21-31` all specify the same bare-`git` vs
  `git_child` two-arm assertion on every run, with no hand-edit.
- **CR6 — addressed in intent but MISTARGETED at the code.** I read the actual
  file: `setup-worktree.sh` contains **no literal `npx husky install` call**.
  The only site is a generic hooks loop at `setup-worktree.sh:344-352`:
  `( cd "$WORKTREE_PATH" && eval "$hook" >/dev/null 2>&1 ) || true`, driven by
  `CONCERTINO_WORKTREE_HOOKS` (`scripts/concertino/.concertino.env:9` =
  `'npx husky install'`, a `;`-separated configurable list). Confirmed via
  `grep -rn "husky install" scripts/concertino/`.
- **Scope of "four scripts" checked against the tree:** the worktree's
  `scripts/concertino/` contains exactly `assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh`, `start-servers.sh` (+ `README.md`); the other helpers
  (`emit-event.sh`, `next-report-number.sh`, …) are untracked/absent here, so
  the enumeration in the artifacts is correct.

### Verdict: REFUTE

Two of the six original CRs are still open in the current file contents. Both
are cheap textual/targeting fixes; the core design (CR1/CR2/CR4/CR5) is sound
and I would CONFIRM it once these are corrected.

### Change Requests

1. **CR3 is not fully applied — `design.md`'s own Goals contradicts its
   Decisions.** `design.md:20-21` still reads "strips the same **six**
   repo-locating variables the Node helper allowlists against". That is the
   exact enumerated-list framing CR1/CR2 rejected, and it sits *above* the
   revised Decisions block, so an implementer reading top-down gets the wrong
   instruction first. Restate the Goal as "strips **every** currently-set
   `GIT_*`-namespaced variable (prefix strip, not an enumerated list)".

2. **CR3 also unapplied in `proposal.md`.** `proposal.md:15-18` says the helper
   "strips the **six** repo-locating `GIT_*` variables", contradicting
   `spec.md:11` ("every currently-set `GIT_*`-namespaced environment
   variable") and the revised `design.md` Decisions. Update it to the prefix-
   strip wording so proposal/design/tasks/spec agree. (Keeping "six" is fine
   where it describes the *poison* injected by the test — `proposal.md:22`,
   `tasks.md:32-35` — since the poison set is deliberately a subset; only the
   *strip* description must be the prefix form. Please make that distinction
   explicit so it isn't re-flattened next round.)

3. **CR6 targets a call site that does not exist; retarget it at the hooks
   loop.** `design.md:59-66` and `tasks.md:16-21` instruct the implementer to
   "wrap the `npx husky install` call" in `setup-worktree.sh`. There is no such
   literal call. The real site is the generic loop at
   `setup-worktree.sh:344-352` (`eval "$hook"`), whose contents come from
   `CONCERTINO_WORKTREE_HOOKS` (`.concertino.env:9`). As written the task is
   either unimplementable or would be satisfied by wrapping the wrong thing,
   and it would leave *any other* configured hook value unprotected. Revise
   design + task 1.4 to: strip `GIT_*` inside the existing
   `( cd "$WORKTREE_PATH" && eval "$hook" ... )` subshell, so **every**
   configured worktree hook — not just today's `npx husky install` — runs
   hermetically. Note the subshell already exists, so this is a one-line
   insertion, and the strip is safely scoped.

### Non-blocking notes

- `proposal.md:21` names the test `scripts/concertino/git-child-env.selftest.sh`
  while `design.md:68`/`tasks.md:27` put it under `lib/`. Harmless drift; align
  when touching proposal.md for CR2 above.
- `scripts/concertino/*.sh` are rendered by `concertino sync` from
  `concertino.config.json` (per `CLAUDE.md`). Edits made only in this repo are
  historically clobbered by the next `sync`. Not a blocker for this ticket, but
  worth a line in the design (or a spinoff) so the hardening isn't silently
  reverted.
- Non-`GIT_`-prefixed variables that influence git (e.g. `HOME` →
  `~/.gitconfig`) are intentionally left alone by a prefix strip. That is the
  right call for repo *misdirection* (all discovery vars are `GIT_*`-prefixed)
  and matches the Node side; no action needed.
