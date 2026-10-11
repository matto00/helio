## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD e56d94b107acfc72ac100803c9b26fa471ac3ad9 (change dir untracked; artifacts read from the worktree).

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/ci-parity-yaml-needs/HEL-1462`.
- Premise defect 1 reproduced myself: `node scripts/check-precommit-ci-parity.mjs .hel1462-scratch/m1` prints
  `OK — every hook script is covered by ci-complete.`; `diff` of m1 ci.yml vs real shows only the added comment
  `# needs: [frontend, ...]` and `frontend` removed from the real `needs`. Root cause confirmed by reading
  `parseCiCompleteNeeds` (first `needs:\s*\[` match in the regex-sliced block) and `extractJobBlocks` (raw block text,
  comments included).
- Premise defect 2: real ci.yml lines 140-144 put both parity and `check:ci-complete-needs` only in `frontend`;
  `ci-complete` (line 692) is `if: always()` with a single results step. `node scripts/check-ci-complete-needs.mjs
  .hel1462-scratch/m2` names `frontend` as missing (local only).
- D4 soundness (point 1): the results step runs first; a later step without `if:` runs only when it passed, so a
  failed need already reds the job and the guard is only needed (and runs) on the all-green path -- exactly the m2
  hole. The rejected alternative (a tiny job ci-complete needs) is correctly rejected: it can be dropped from `needs`
  the same way. `actions/checkout@v7`/`setup-node@v7` match ci.yml's existing pins; js-yaml 4.3.2 is a root
  devDependency (package.json:87); root `prepare: husky` runs on `npm ci` after checkout, same as `frontend` today.
- D3/D5 circularity (point 2): no circularity. D5 is vacuous in CI by itself (a removed step cannot fail), but the
  design correctly routes CI detection of a removed guard step to parity in `frontend` (hook script
  `check:ci-complete-needs` becomes uncovered once `frontend` no longer runs it and ci-complete does not). Residual:
  removing the guard step AND dropping `frontend` from `needs` in one edit is caught only by the hook; acceptable for
  a Low ticket, noted below.
- Parity token regex `npm run ([\w:.-]+)` is greedy, so `npm run check:ci-complete-needs:selftest` does NOT cover
  `check:ci-complete-needs` on the parity side (good) -- but D5 does not say it uses this extractor (CR 3).
- Gate-chain checklist (point 4): accurate against the script -- root from `import.meta.url`/argv[2], no subprocess,
  no git, no writes, js-yaml import fails closed. Importing the module from parity does not run `main()` (argv[1]
  guard). Correct that `.husky/pre-commit` is unchanged and parity is not hook-invoked.
- `openspec validate parity-yaml-needs-guard --strict` -> valid; `check:spec-structure` passed; `check:openspec` clean.
  MODIFIED requirement header matches `openspec/specs/ci-required-jobs-guard/spec.md` exactly.
- Ticket ACs 1-4 each map to tasks (AC1: 2.1/2.2; AC2: 1.1/1.3; AC3: 2.3/3.2; AC4: 3.1/3.3). No scope drift.

### Verdict: REFUTE

### Change Requests
1. **D1 contradicts D5 and task 1.2 (point 3).** D1 says `checkCiCompleteNeeds`'s "existing selftest must pass
   unmodified", but D5 puts the anchor inside `checkCiCompleteNeeds`, and every green baseline in
   `scripts/check-ci-complete-needs.selftest.mjs` (the `yaml()` helper, line ~33: ci-complete steps are only
   `- run: true`) asserts `errors.length === 0` -- "valid file passes", "trailing comment allowed", "block-list
   needs", "comments between jobs" will all fail. Task 1.2 already says to update those fixtures. Pick one and make
   the artifacts agree: either (a) D1 says the existing cases' assertions and reason strings are unchanged but the
   `yaml()` helper gains the guard step, or (b) the anchor is a separate exported check that `main()` also runs, so
   `checkCiCompleteNeeds` and its selftest really are unchanged.
2. **D2's "steps present but not a list is an error" is unresolved against the existing parity selftest.** Its
   `ciYaml()` fixture emits `backend:\n    steps:\n` with an empty `backendRun` in cases A-D; js-yaml parses that as
   `steps: null` (verified: `{"backend":{"runs-on":"x","steps":null}}`). State explicitly whether null/absent `steps`
   contributes nothing or is an error, and if an error, that the existing fixtures change. Also note in task 1.1 that
   the selftest's hard-coded `total !== 5` case count must be updated.
3. **D5's match rule is unspecified.** "invokes `npm run check:ci-complete-needs`" read as a substring is satisfied by
   `npm run check:ci-complete-needs:selftest`. Specify that the anchor extracts tokens with the same
   `npm run <name>` / `node <path>` extractor parity uses (exact script name / exact path), and add a needs-guard
   fixture where ci-complete runs only `npm run check:ci-complete-needs:selftest` (must fail).

### Non-blocking notes
- Proposal says the guard is "an always-run step"; design adds no step-level `if:`. Reword to "runs in the always-run
  `ci-complete` job" so nobody adds `if: always()` to the guard step alone (which would run it with checkout skipped).
- The parity spec's "Comments and string content SHALL never count as ... a command" overclaims: commands come from
  `run` strings, so a shell `# npm run x` or `echo npm run x` inside a `run:` still counts. Narrow it to "YAML comments
  and non-`run` string content", or add the residual to Risks.
- Residual hole: a step with `if: false` / `continue-on-error: true`, or removing the guard step and dropping
  `frontend` in one edit, is caught only by the hook. Worth one Risks line; not required for this Low ticket.
