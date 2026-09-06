## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Scope: ONLY the delivery-time amendment (design.md Decision 5 correction + Decision 6,
specs/openspec-spec-hygiene/spec.md rewrite, tasks.md section 4). The already-CONFIRMed
AC2 work was not re-litigated. No backend server, spec, or DB connection was opened.

### What I verified (with evidence)

1. **`check-openspec-version.mjs` is NOT in the pre-commit gate chain — claim VERIFIED, not assumed.**
   `cat .husky/pre-commit` lists `check:openspec` and `check:openspec:selftest`; `package.json:17,19`
   resolve those to `check-openspec-hygiene.mjs` / `check-openspec-hygiene.selftest.mjs`.
   `check:openspec-version` (`package.json:18` → `check-openspec-version.mjs`) appears nowhere in the hook.
   `scripts/concertino/check-gate-chain-change.sh:16-19` defines the gate chain mechanically as
   `.husky/**` plus "a script FILE referenced from `.husky/pre-commit`'s own command list" — so
   design.md Decision 6's sentence is literally correct and no extra checklist obligation attaches.
2. **`openspec/specs/` is genuinely clean of the first archive's residue.**
   `git diff main -- openspec/specs/` → **empty output**. The old requirement name is absent from the
   worktree (`grep -rn "self-test is enforced in continuous integration" openspec/specs/` → no hits).
   The rename is therefore a legitimate `## ADDED Requirements` delta, and the delta is coherent.
   **But see CR2** — the reset is staged-only; `HEAD` still carries the archived state
   (`git grep HEAD -- openspec/specs/` still finds the OLD requirement name at
   `openspec/specs/openspec-spec-hygiene/spec.md:93`).
3. **Wiring `check:openspec` will not retro-red CI on pre-existing violations.** Ran it:
   `npm run check:openspec` → `openspec/ is clean`, exit 0. `npm run check:openspec-version` →
   `OK — openspec 1.10.0`, matching `EXPECTED = "1.10.0"` at `scripts/check-openspec-version.mjs:27`.
4. **Read** `.github/workflows/ci.yml` frontend job (openspec self-test step currently at the tail,
   no install step, and **no `check:openspec-version` step anywhere in the workflow**),
   `design.md`, `tasks.md`, `specs/openspec-spec-hygiene/spec.md`, `git log --oneline -4`.

### Verdict: REFUTE

Two defects. One is a real reintroduction of the exact silent-skew failure Decision 6 claims to have
eliminated; the other is a delivery artifact that would land an incoherent canonical spec.

Answers to the four questions asked, for the record:
- **Q1 — no, the single-sourcing is not skew-proof as designed** (CR1).
- **Q2 — wiring both is correct, not scope creep.** Decision 5's reasoning holds: a self-test certifies
  that a gate can fail; running the self-test in CI while the gate never runs there certifies an
  unenforced gate. The install cost is paid once either way, so "both or neither" is the coherent unit,
  and the spec delta encodes that as a normative sentence rather than leaving it as prose rationale.
  It is also directly responsive to AC4's "note why this one differed" — the true answer (the CLI is
  not a repo dependency) is what forces the install, and the install is what unblocks both.
- **Q3 — verified false-by-check: the script is not in `.husky/pre-commit`**, so the checklist
  obligations do not extend to it and the plan is correct to say so. (Non-blocking note 1 refines this.)
- **Q4 — the delta is coherent and `openspec/specs/` is clean in the worktree**, but only in the
  worktree (CR2).

### Change Requests

1. **`$(...)` in an argument position cannot fail the step — task 4.4 does not guard the named risk.**
   In `npm i -g @fission-ai/openspec@$(node scripts/check-openspec-version.mjs --print-expected)`
   (task 4.2), GitHub Actions' default shell is `bash -e {0}`. `set -e` does **not** fire for a failing
   command substitution used as part of an argument — only the outer `npm`'s exit status is consulted.
   So if the node invocation ever fails or prints nothing (file renamed, arg parsing changed, a Node
   upgrade, a syntax error introduced by an unrelated edit), the runner executes
   `npm i -g @fission-ai/openspec@` and **installs `latest`, green**. Because `check:openspec-version`
   is wired into neither `ci.yml` nor `.husky/pre-commit`, nothing downstream ever observes that the
   installed CLI is not `EXPECTED` — the gate then runs against an unpinned CLI silently. That is
   precisely the CON-130 failure mode `check-openspec-version.mjs` exists to convert into a loud one.
   Task 4.4 ("assert `--print-expected` prints exactly the version `check:openspec-version` enforces")
   is an authoring-time *content* assertion; it cannot fire in this failure mode, because nothing about
   the constant is wrong — the *invocation* failed on the runner. It is therefore not an adequate guard.
   Also drop design.md Decision 6's "no skew possible" — it is an overclaim as written.
   Required (both, they close different halves):
   a. Make the substitution failable in `ci.yml`, e.g.
      `V="$(node scripts/check-openspec-version.mjs --print-expected)"` (an assignment **does** trip
      `set -e`) followed by an explicit `[ -n "$V" ] || exit 1`, then
      `npm i -g "@fission-ai/openspec@$V"`.
   b. Add `- run: npm run check:openspec-version` immediately **after** the install step and before the
      openspec checks. This is the sharp guard: it is a runtime end-to-end assertion that what is
      actually on the runner's PATH equals `EXPECTED`, so it closes every variant at once — empty print,
      wrong print, npm resolving something else, a stale global cache, a registry redirect — none of
      which (a) alone catches. One line, no new machinery.
   Additionally, tighten task 4.1 to state that `--print-expected` writes the bare version to **stdout
   only, one line, no banner or prefix** (the script's existing output is all `console.error`/stderr,
   which `$()` correctly ignores; the hazard is a future `console.log` poisoning the string).

2. **The un-archive reset is staged but uncommitted; `HEAD` still contains the OLD requirement name,
   and no task covers committing it.** `git status -s` shows `M openspec/specs/agent-surface-credential-gate/spec.md`
   and `M openspec/specs/openspec-spec-hygiene/spec.md` (plus the `R` renames out of
   `openspec/changes/archive/2026-09-05-wire-selftests-into-ci/`) as **index-only** changes; the last
   four commits (`203a76f1`…`2b60fd72`) are all AC3 mutation/revert commits. So as the branch stands
   committed, `openspec/specs/openspec-spec-hygiene/spec.md:93` still declares the pre-rename
   requirement "The hygiene guard's self-test is enforced in continuous integration", while the change's
   delta will later `ADD` "The hygiene guard **and its self-test** are enforced in continuous
   integration". If the reset is not committed before the re-archive, canonical specs end up carrying
   **both** requirements — two overlapping normative statements about the same gate, which the hygiene
   guard's duplicate-name check will not catch because the names differ. Add an explicit task to
   section 4 to commit the un-archive reset (both `openspec/specs/**` files and the change-dir
   restoration) as its own commit before the re-archive, and to verify afterwards with
   `git diff main -- openspec/specs/` returning empty **and** `git grep -n "self-test is enforced in
   continuous integration" HEAD -- openspec/specs/` returning no hits.

### Non-blocking notes

- Decision 6's "`scripts/check-openspec-version.mjs` is NOT invoked by `.husky/pre-commit`, so this does
  not extend the gate-chain surface" is mechanically correct under
  `scripts/concertino/check-gate-chain-change.sh`'s definition, which is hook-scoped by design. Worth
  recording in the same sentence that the amendment nonetheless makes this script newly **load-bearing
  for a merge-blocking CI job** — the checklist obligation genuinely does not attach, but a future
  reader should not infer from that sentence that the script is low-stakes. CR1(b) is what actually
  makes it safe to be load-bearing.
- The install step is `npm i -g` on every `frontend` run; the design already names the network cost.
  Consider a short comment in `ci.yml` at the install step pointing at
  `scripts/check-openspec-version.mjs`'s own header comment (the "detection, not a true dependency pin
  — tracked separately" paragraph), so the next reader finds the deferred devDependency fix without
  re-deriving it.
- `check:openspec` was confirmed green on the current tree, so wiring the gate carries no latent
  retro-failure; task 4.6 remains a useful confirmation but is not load-bearing for that specific risk.
