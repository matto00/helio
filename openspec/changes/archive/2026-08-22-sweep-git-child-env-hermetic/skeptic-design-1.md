## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Re-derived scope is accurate.** `git ls-files -v scripts/concertino/` in the
  worktree returns `H` for all six entries (`.concertino.env`, `README.md`,
  `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`) —
  tracked despite the gitignored dir, as claimed. `grep -rn 'git ' scripts/concertino/*.sh`
  confirms git calls in exactly four scripts: assert-phase.sh (10 matches, all
  `-C "$WORKTREE_PATH"`), cleanup.sh (`-C "$REPO_ROOT"`, `-C "$base_worktree"`,
  plus a **bare cwd-based** `git rev-parse --show-toplevel` at line 50),
  setup-worktree.sh (line 209 bare `rev-parse`, plus bare `git worktree
  list/add`, `show-ref`, `fetch` at 251-275 — all cwd-based, not `-C`),
  start-servers.sh (line 43 bare `rev-parse`). Scope claim holds; two
  descriptive inaccuracies noted below (CR4).
- **`scripts/lib/git-child-env.mjs` read in full.** It exports `gitChildEnv`
  (allowlist of six NON-git vars) and `nonGitChildEnv` (**GIT_ prefix strip**).
  Its own doc-comment states: *"The first fix here was a denylist of six
  repo-locating names. Hours later GIT_AUTHOR_DATE / GIT_COMMITTER_DATE ...
  turned out to be missing from it, and GIT_CONFIG_PARAMETERS ... was missing
  from both. Denylists fail open."*
- **`unset ${!GIT_@}` works** — verified live:
  `export GIT_DIR=/x GIT_FOO=1; bash -c 'unset ${!GIT_@}; ...'` → both unset
  (and it also caught an ambient `GIT_EDITOR`). Bash *does* have a clean
  prefix-strip equivalent of `nonGitChildEnv`.
- **`.husky/pre-commit` read**: it invokes `npm run check:repo-integrity`,
  `check:schemas`, `check:spec-structure`, `check:openspec`,
  `check:openspec:selftest`, `check:scala-quality` — i.e. the hook's contents
  are precisely "every `npm run check:*`".
- Read ticket.md, proposal.md, design.md, tasks.md, specs/git-hook-hermeticity/spec.md.

### Verdict: REFUTE

The scope re-derivation is sound and the out-of-scope fencing is correct. The
design's *central technical decision* is not: it adopts, with an explicitly
false justification, the exact denylist shape that the sibling helper this
change claims to mirror documents as having already failed in this repo.

### Change Requests

1. **Replace the six-name denylist with a `GIT_` prefix strip.** design.md
   "Decisions" bullet 1 and tasks.md 1.1 both specify
   `env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE -u GIT_COMMON_DIR -u
   GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES git "$@"`.
   `scripts/lib/git-child-env.mjs` (ALLOWLIST, NOT DENYLIST section) records
   that this exact six-name list shipped, then missed `GIT_AUTHOR_DATE`,
   `GIT_COMMITTER_DATE` and `GIT_CONFIG_PARAMETERS` within hours. Ship the
   bash analogue of `nonGitChildEnv` instead — a prefix strip, which is
   *fewer* characters than the six `-u` flags and is verified working:
   `git_child() { ( unset ${!GIT_@}; exec git "$@" ) }` (or
   `env $(for v in ${!GIT_@}; do printf -- '-u %s ' "$v"; done) git "$@"`).
   Note `${!GIT_@}` also strips vars nobody has enumerated yet, which is the
   whole documented point.

2. **The design's stated rationale for the denylist is factually wrong; remove
   or rewrite it.** design.md Decisions bullet 1 and Planner Notes both assert
   *"bash has no clean equivalent of 'rebuild the whole env from a short list'
   without fighting set -e / arrays"*. Refuted above by direct execution — and
   the relevant comparison isn't the allowlist rebuild at all, it's
   `nonGitChildEnv`'s prefix strip, which bash does in one builtin. A design
   decision resting on an untested claim about the language is not
   self-approvable; re-derive it or defer.

3. **design.md contradicts tasks.md on the variable list.** design.md claims
   the six-name list carries *"plus the same GIT_AUTHOR_DATE / GIT_COMMITTER_DATE /
   GIT_CONFIG_PARAMETERS follow-ups already learned there"* — but neither the
   design's own `env -u` chain nor tasks.md 1.1 nor the spec delta's Requirement
   text includes those three names. Either list is wrong; CR1 makes the question
   moot, but the spec delta requirement (which enumerates exactly six names) and
   ticket AC #1 must be restated in terms of "all `GIT_*`-namespaced
   repo-locating variables" so the acceptance signal matches the implementation.

4. **The selftest must strip `GIT_*` from its own process before doing
   anything, and must not be named `check:*`.** tasks.md 2.1 has the selftest
   `git init` throwaway fixtures — bit-for-bit the HEL-657 detonation
   mechanism — and 2.3 wires it as `npm run check:concertino-git-env`.
   `.husky/pre-commit` is literally a list of `npm run check:*` lines; a
   `check:`-prefixed script is an invitation for a future author to append it
   to the hook, at which point the fixture `git init` runs under a poisoned
   `GIT_DIR` against the real repo. Add an explicit task: the selftest's first
   executable line strips `GIT_*` from its own environment (not just its
   children), and name the npm script outside the `check:` namespace (e.g.
   `selftest:concertino-git-env`) with a comment in tasks/design stating why it
   is deliberately excluded from the hook.

5. **Red-before-green as specified is not reproducible evidence.** tasks.md 2.2
   asks the implementer to *temporarily remove the strip by hand*, observe a
   failure, restore it, and *"record the before/after result in the PR
   description"*. That leaves nothing in the tree that can ever re-prove the
   test is non-vacuous, and it depends on a hand-edit being correctly reverted —
   in a change whose parent incident was caused by a test that looked green
   while doing the wrong thing. Make the mutation programmatic: have the
   selftest run its poisoned-env scenario twice, once through `git_child` and
   once through bare `git`, and assert the bare-git arm *is* misdirected
   (fixture untouched, poisoned repo touched) while the wrapped arm is not.
   That makes red-before-green a permanent in-test assertion rather than a
   one-off manual observation captured only in prose.

6. **Decide explicitly about non-git children that shell out to git.**
   `scripts/concertino/setup-worktree.sh` runs `npm ci` (line 335) and project
   hooks including `npx husky install` (line 343) — `husky install` writes into
   `.git`, so a poisoned `GIT_DIR` misdirects it exactly as it would a direct
   git call. This is the case `nonGitChildEnv` exists for on the Node side and
   the design does not mention it. Either extend the wiring to those child
   invocations or add it to Non-Goals with a stated reason; silence here is an
   uncovered instance of the same defect class the ticket is sweeping for.

### Non-blocking notes

- design.md Context says *"All four scripts call `git -C <target-dir>` (or, in
  `start-servers.sh`, a bare `git rev-parse`)"*. `cleanup.sh:50` and all of
  `setup-worktree.sh`'s git calls (209, 251-275) are also bare/cwd-based. The
  tasks say "every git invocation", so coverage is fine, but the design's
  description would mislead an implementer skimming for the cwd-based cases.
- Scope discipline checks out: HEL-806, CON-131, CON-132, HEL-799 and HEL-734
  are named as Non-Goals in design.md and Out of scope in ticket.md, and
  nothing in tasks.md touches selftest mutation coverage, cleanup.sh's exit-code
  behaviour, change classification, or worktree file provisioning. (Incidentally,
  HEL-799/734 is live in this worktree: `scripts/concertino/` here is missing
  `next-report-number.sh` et al.; I used the main checkout's copy.)
- The archive-with-`--skip-specs` framing in the spec delta, citing the
  `bump-brace-expansion-lockfile` precedent, is appropriate for an infra-only
  change.
