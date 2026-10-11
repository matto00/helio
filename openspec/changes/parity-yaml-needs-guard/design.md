## Context

Two guards read `.github/workflows/ci.yml`'s merge-gate topology (verified on main e56d94b10):

- `scripts/check-ci-complete-needs.mjs` (HEL-1428): js-yaml 4.3.2, fail-closed; every job other than `ci-complete`
  must be in `ci-complete.needs`. Runs in `.husky/pre-commit` and, in CI, only in the `frontend` job (ci.yml 143-144).
- `scripts/check-precommit-ci-parity.mjs` (HEL-1123): every npm script the hook runs must be run (by name or by its
  underlying `node <path>`) by a job in `ci-complete.needs`. CI-only (`frontend` job, 140-141). Its
  `parseCiCompleteNeeds` regex-slices the `ci-complete` block and takes the first `needs:\s*\[...\]`; `extractJobBlocks`
  regex-slices each job by 2-space indentation and scans its raw text (comments included) for `npm run`/`node` tokens.

Premise reproduced on temp copies inside the worktree (`.hel1462-scratch/`, never committed; real ci.yml untouched):
- m1: `# needs: [frontend, backend, security, e2e, docker-image]` comment above a real `needs:` without `frontend` ->
  parity prints OK, exit 0 (all 28 hook scripts live only in `frontend`). Defect 1.
- m2: `frontend` dropped from `needs`, no decoy -> both scripts exit 1 locally, but in CI both run only in `frontend`,
  which `ci-complete` (`if: always()`) no longer awaits, so the required check is green. Defect 2.

## Goals / Non-Goals

**Goals:** parity reads ci.yml structurally and fails closed; the ci-complete.needs guard runs inside the required
`ci-complete` job; each defect has a red-first selftest fixture; both reds shown.

**Non-Goals:** changing which jobs exist or what they run; changing `.husky/pre-commit`; making the parity check
hook-invoked; reworking the hook-side token regexes (`npm run <x>`, bare `npm test`, `node <path>`), which parse shell
command strings, not YAML.

## Decisions

**D1 - one YAML reading, shared.** Refactor `check-ci-complete-needs.mjs` to export a structural reader (e.g.
`readCiTopology(ciYamlText)` -> `{doc, jobs, needs, errors}`) holding today's parse/structure checks verbatim (unparseable
incl. duplicate keys; no/empty `jobs`; no `ci-complete`; no `needs`; non-list `needs`; non-bare-id entry; entry naming no
job). `checkCiCompleteNeeds` = that reader + the existing "every job is in needs" errors + the D5 anchor. Existing error
messages are unchanged and every existing selftest assertion is kept; the only selftest edit is that the fixture
helper's green `ci-complete` now includes the guard step (required by D5), so the four "passes" cases still pass. The parity check imports the reader rather than growing a second
parser: two parsers of one file is how this ticket's defect 1 arose. Parity reports any reader error as its own error
(fail closed: never an empty set that silently covers nothing). Parity does NOT re-report "job missing from needs" --
that is the other guard's contract. Alternative rejected: keep a regex but anchor it (`^\s{4}needs:`) -- still blind to
quoted multi-line scalars, the class HEL-1428 needed three review cycles to close.

**D2 - commands from parsed steps.** For each scanned job, its commands are the `run` strings of `doc.jobs[j].steps`
(a list; a step without a string `run`, e.g. `uses:`, contributes nothing). A job whose `steps` is absent or null
(`steps:` with no value, which js-yaml parses as null) contributes nothing; a job whose `steps` is any other non-list
value is an error. Comments are therefore never commands. Token extraction from a `run` string keeps today's regexes.

**D3 - scanned set = `ci-complete.needs` + `ci-complete`.** `ci-complete` is the required status check itself, so a step
in it gates a merge exactly as a step in a needed job does. Required by D4 (the guard moves into it).

**D4 - guard runs in `ci-complete`.** `ci-complete` gains, after its existing verification step: `actions/checkout@v7`,
`actions/setup-node@v7` (node 22, `cache: npm`, `cache-dependency-path: package-lock.json`), `npm ci` (root only: js-yaml
is a root devDependency), `npm run check:ci-complete-needs`. The existing results step stays first and unchanged. The
`frontend` job keeps `check:ci-complete-needs:selftest` and drops its `check:ci-complete-needs` step (now covered by
`ci-complete`; parity sees it through D3). `timeout-minutes` 2 -> 6: a root `npm ci` from the npm cache is an estimate of
well under a minute; the real duration is measured on the PR's CI run and recorded in the PR body (not in ci.yml, to
avoid a post-CI head change). Alternative rejected: a tiny always-run job that `ci-complete` needs -- it can be dropped
from `needs` exactly like `frontend`, recreating the hole one level down. Only the required job itself cannot be.

**D5 - self-anchoring.** `checkCiCompleteNeeds` additionally errors if no `ci-complete` step's `run` invokes
`npm run check:ci-complete-needs` or `node scripts/check-ci-complete-needs.mjs`, matched as EXACT tokens with the same
extractors parity uses (`npm run <name>` with the full name, `node <path>`), never a substring: a step running only
`npm run check:ci-complete-needs:selftest` does not satisfy it. The token extractors move into `check-ci-complete-needs.mjs` and are exported from it;
parity imports them (and the reader) from there. No new module and no reverse import: the hook never reaches parity,
and the gate-chain surface stays exactly `check-ci-complete-needs.mjs`. Structural errors return early, before the
anchor runs, so a structural fixture yields only its structural error. Tasks 2.1 and 2.3 land in the same commit (the
anchor fails the real ci.yml until the `ci-complete` step exists). Removing the step is then caught by
the hook locally, and in CI by parity (the hook script `check:ci-complete-needs` becomes uncovered -> `frontend` red).

**D6 - red-first evidence.** New selftest cases are written and run against the PRE-change scripts first; the failing
transcript is kept under `.concertino/runs/HEL-1462/evidence/`. Parity fixtures: the m1 comment decoy; a block-scalar
`run: |` string containing `needs: [..]`; unparseable YAML; missing `ci-complete`; scalar `needs`; a `npm run x` that
appears only in a comment of a needed job (must not count as coverage); a hook script run only in `ci-complete` (counts).
Needs-guard fixtures: `ci-complete` without the guard step (D5); `ci-complete` running only the `:selftest` script
(must fail). Parity selftest: backend's empty `steps:` (null) stays valid; the hard-coded case-count total is updated. Mutation transcripts on temp copies of the real
repo files (clean tree passes; m1 -> parity exit 1; m2 -> `npm run check:ci-complete-needs` exit 1, the exact command the
new `ci-complete` step runs; guard-step-removed -> needs-guard exit 1 and parity exit 1).

## Gate-Chain Implications Checklist

Touched hook-invoked script: `scripts/check-ci-complete-needs.mjs` (`.husky/pre-commit` -> `npm run
check:ci-complete-needs`). `.husky/pre-commit` itself is unchanged; `check-precommit-ci-parity.mjs` is not hook-invoked.

- **What does it execute?** `node scripts/check-ci-complete-needs.mjs`: reads `.github/workflows/ci.yml`, parses it
  with js-yaml `load` (no code execution; default schema), prints and exits 0/1. No subprocess, no network.
- **What environment does it inherit, and from where?** The hook's environment (git's hook env incl. `GIT_DIR`/
  `GIT_INDEX_FILE` in a worktree). It reads none of it: the repo root comes from `import.meta.url` (or argv[2]), not
  cwd or git env.
- **Does it write anything outside its own sandbox?** No. Read-only, no temp files, no git commands.
- **Does it behave differently from a linked worktree than from a main checkout?** No: path resolution is relative to
  the script file, and it never calls git. It reads the worktree's own ci.yml.
- **What happens on its first run?** Same as every run: js-yaml is already a root devDependency installed by `npm ci`;
  if `node_modules` were missing the import fails and the hook stops (fail closed), same as today.

## Risks / Trade-offs

- `ci-complete` now does a checkout + `npm ci` (~tens of seconds) on every run, including when every need already
  failed. Acceptable: it is the one place the guard cannot be routed around.
- An npm registry/cache outage now also reds `ci-complete` directly (already true of every needed job). Fail closed.
- Still caught only by the hook (out of scope): an `if: false` or `continue-on-error: true` on the guard step, or
  removing the guard step and dropping `frontend` in the same edit. Commands are taken from `run` strings, so a shell
  comment or `echo npm run x` inside a `run:` still counts as coverage (unchanged from today).
- D5 couples the guard to the exact invocation string; a rename must update both, which the selftest makes loud.
