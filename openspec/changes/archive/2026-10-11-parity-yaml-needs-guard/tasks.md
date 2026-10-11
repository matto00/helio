## Standing Constraints

- [C1] Never edit the real `.github/workflows/ci.yml` to test a mutation: mutations live in temp copies under the worktree's `.hel1462-scratch/` (never committed).
- [C2] Red first: every new selftest case is run against the pre-change script and its failure recorded in `.concertino/runs/HEL-1462/evidence/` before the fix lands.

## 1. Red-first selftests

- [x] 1.1 Add parity selftest fixtures (design D6): comment decoy, block-scalar `run: |` containing `needs: [...]`, unparseable YAML, missing `ci-complete`, scalar `needs`, command only in a comment, hook script run only in `ci-complete`; null `steps:` stays valid. Update the selftest's hard-coded case total. Assert on reason text.
- [x] 1.2 Add needs-guard selftest fixtures: `ci-complete` without the guard step, and running only the `:selftest` script (D5, both must fail); update only the fixture helper so a green tree includes the guard step (keep every existing assertion).
- [x] 1.3 Run both selftests against the unmodified scripts; save the failing transcript to evidence.

## 2. Implementation

- [x] 2.1 Export the structural reader from `check-ci-complete-needs.mjs` (D1); `checkCiCompleteNeeds` behaviour/messages unchanged plus D5 anchor.
- [x] 2.2 Rebuild `check-precommit-ci-parity.mjs` on the reader + parsed `steps[].run` (D1-D3); delete `parseCiCompleteNeeds`/`extractJobBlocks` regex scanning; update header comment.
- [x] 2.3 `ci.yml`: `ci-complete` gains checkout/setup-node/`npm ci`/`npm run check:ci-complete-needs`, `timeout-minutes: 6`; `frontend` drops its `check:ci-complete-needs` step (keeps the selftest) (D4).
- [x] 2.3a Commit 2.1-2.3 together (the anchor fails the real ci.yml without the new step).
- [x] 2.4 Both selftests green; both checks green on the real tree.

## 3. Gate-chain and mutation evidence

- [x] 3.1 `scripts/concertino/test-gate-in-isolation.sh HEL-1462 scripts/check-ci-complete-needs.mjs` before committing.
- [x] 3.2 Mutation transcripts on temp copies (D6): clean passes; m1 -> parity exit 1; m2 -> `npm run check:ci-complete-needs` exit 1; guard step removed -> needs-guard exit 1 and parity exit 1. Save under evidence.
- [x] 3.3 Full `.husky/pre-commit` passes on the clean tree (the commit itself).
