## Context

`scripts/check-no-credential-in-agent-surface.selftest.mjs` registers skipped cases through a single generic
helper (`skip(name, reason)` at :143, pushing to `skippedCases` at :141). Today the only caller-condition is
`isRoot` (:140), because a `chmod 000` fixture does not restrict root. The terminal branch at :1061-1069 prints
`OK WITH SKIPS (... running as euid 0)` and **exits 0**. HEL-846 wired the self-test into `.github/workflows/ci.yml:55`;
it has reported plain `OK` so far only because `ubuntu-latest` executes as a non-root user.

`check:openspec:selftest` exists as an npm script (`package.json:19`) and runs at `.husky/pre-commit:13` only.
`check:dependabot:selftest` (ci.yml:46) and both `check:node-root-encoding` self-tests (ci.yml:41,43) are already
CI-wired — they differ only in that HEL-913 and the dependabot ticket happened to wire their self-tests at the
same time as their gates, whereas HEL-956 wired this gate's self-test into the hook alone.

## Goals / Non-Goals

**Goals:**
- A skipped self-test case cannot be reported as success by a merge-blocking run.
- The new failure branch is itself provably failable, not asserted.
- `check:openspec:selftest` becomes merge-blocking.

**Non-Goals:**
- Re-wiring AC1 (already delivered by HEL-846, `627fc281`).
- Changing any detection rule, surface, or allowlist of the gate itself.
- Editing `.husky/pre-commit`, `package.json`, or `tsconfig.json`.
- Pinning the runner image or forcing CI to a named non-root user (see Decision 1).

## Decisions

**Decision 1 — hard-fail in CI rather than guarantee a non-root runner.** The ticket offers both options. A
non-root runner is a property of an image we do not control and that no gate re-checks; it is exactly the
"passed by luck" state this ticket exists to end. The hard failure is self-enforcing: it stays correct if the
image changes, and it converts an unobservable coverage loss into a red build. Adopted, matching the owner's
stated preference. No concrete reason against it was found: the repo's CI runs on `ubuntu-latest`, which is
non-root, so this branch is inert today and costs nothing until an image change would otherwise have silently
removed coverage.

**Decision 2 — key the failure on `skippedCases.length > 0`, not on `isRoot`.** `skip()` is a generic helper.
Keying on the accumulated list means any future skip reason inherits the guard for free, and it cannot drift
out of sync with the `isRoot` predicate. The message must therefore stop hardcoding "running as euid 0"; each
skip already carries its own reason string, which is printed at the point of skipping.

**Decision 3 — detect CI via `process.env.CI`.** GitHub Actions sets `CI=true` on every runner, and it is the
conventional signal already understood across the Node ecosystem. Treat any non-empty `CI` value as CI. The
failure direction is safe under a false positive: a developer who exports `CI` locally gets a stricter run, never
a laxer one. Outside CI the same condition remains exit 0 with the skip lines printed, so a developer running as
root is warned rather than blocked — the local hook stays usable.

**Decision 4 — prove the new branch with a forced-skip probe, spawned as a subprocess.** The branch cannot be
reached on a non-root developer machine or on `ubuntu-latest` by any natural means, so without a probe it would
ship as an unexecuted claim — the precise defect class of this ticket. Add a test-only environment hook that
registers one synthetic skipped case, then have the self-test spawn itself twice: once with the hook plus `CI=1`,
asserting non-zero exit and that the output names the skipped case; once with the hook and `CI` cleared,
asserting exit 0. The hook's presence also serves as the recursion guard, so the child does not re-spawn.

The hook is safe by construction because it can only **add** a skipped case, never clear or suppress one. Its
worst-case misuse — being set in CI — forces a hard failure, which is fail-closed. It cannot be used to make a
genuinely skipped case report success.

**Decision 5 — wire `check:openspec:selftest` into the `frontend` job next to `check:openspec`'s siblings.** It
is the same class of Node-only check as the self-tests already there and needs no new job or service. Carry an
explanatory comment in the established HEL-913/HEL-846 house style, naming why CI and not `.husky/pre-commit`.

## Risks / Trade-offs

- **A test-only env hook is a new input to a security gate.** Mitigated by Decision 4's monotonicity: it only
  adds skips. It is also read once, near the skip machinery, and named unmistakably as test-only.
- **`process.env.CI` is a convention, not a guarantee.** A CI system that does not set it would fall back to the
  local warning behaviour — the status quo, not a regression. GitHub Actions, the only CI this repo runs, sets it.
- **Spawning the self-test from itself adds runtime.** Two extra short subprocess runs; the file already spawns
  mutated copies of the gate repeatedly, so this is consistent with the existing shape and cost.
- **The forced-skip probe could rot into a tautology** if it asserted only the exit code. It also asserts the
  skipped case is named in the output, so a branch that failed for an unrelated reason would not satisfy it.

## Gate-Chain Implications Checklist

**What does it execute?** `check-no-credential-in-agent-surface.selftest.mjs` executes Node only: it plants and
removes fixture files under the repo, `chmod`s them, and spawns `node` on the shipped gate script and on mutated
copies of it. This change adds two further `node` spawns of the self-test file itself. No network, no database,
no backend, no package manager, no git mutation.

**What environment does it inherit, and from where?** It inherits the pre-commit hook's environment when run from
`.husky/pre-commit:18`, and the runner's environment in CI. It newly reads two variables: `CI` (read-only,
decision input) and the test-only forced-skip hook. The child spawns receive an explicitly constructed
environment derived from `process.env`, with the hook set and `CI` set or deleted as the case requires — the
parent's own `CI` value is never mutated in place.

**Does it write anything outside its own sandbox?** No. All fixture writes stay under the repository worktree in
the paths the file already uses, and every one is removed in the existing `finally` block. This change adds no
new write path; the forced-skip hook plants no files at all.

**Does it behave differently from a linked worktree than from a main checkout?** No. It resolves paths relative
to its own module location and touches no git metadata, so the HEL-657/HEL-805 poisoned-`GIT_DIR` and
HEL-768/HEL-880 vacuous-`npm test` mechanisms do not apply. The added subprocess spawns inherit the same
resolution and are equally worktree-agnostic.

**What happens on its first run?** Identical to every subsequent run: it is stateless, plants its own fixtures,
and cleans them up. The two new spawns run unconditionally in both environments. On a non-root machine with `CI`
unset — the developer case — observable behaviour is unchanged: still a plain `OK`.

## Planner Notes

- Self-approved: keying on `skippedCases.length` (Decision 2) is broader than the ticket's literal "root-detected
  skip" wording, but strictly stronger and in the same direction; no scope escalation was judged necessary.
- AC4 survey conclusion recorded in proposal.md: the three other self-tests were already CI-wired;
  `check:openspec:selftest` was the sole remaining gap.
- The mutation-in-CI proof (AC3) is a delivery-time action, not a code artifact; it is tracked in tasks.md and
  its evidence is the failing CI run URL in the PR description.
