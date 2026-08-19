## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **True diff scope.** `git diff origin/main...HEAD --stat` (merge-base `9f76fda6`) isolates the
  change to exactly `infra/deploy-backend.sh`, `infra/README.md`, and the
  `openspec/changes/fix-stale-deploy-image-tag/` artifacts. Confirmed the local `main` ref
  staleness (unrelated HEL-756/HEL-749 commits) is a ref artifact, not scope creep, per the
  orchestrator's note.

- **AC traced to real code.** Ticket (`ticket.md`, cross-checked verbatim against the live Linear
  issue HEL-753 via `mcp__linear__get_issue`) offered options (a) compute a fresh tag or (b)
  guard + document. design.md D1/D2/D3 self-approves (b). Read the actual diff:
  `infra/deploy-backend.sh` no longer contains `--image=...:v3` (confirmed:
  `grep -E -- '--image=us-west1-docker' infra/deploy-backend.sh` → empty, exit 1); a guard block
  (lines ~66-87) scans `"$@"` via `grep -q -- '--image=' <<<"$*"` and exits 1 with actionable
  guidance before any `gcloud` call if absent.

- **Guard behavior independently reproduced, not trusted from the evaluator's narrative.** I
  copied `infra/.env.deploy.example` → `infra/.env.deploy` (untracked, gitignored — removed
  afterward, worktree left clean per `git status --short infra/` showing no output), stubbed
  `gcloud` on `PATH`, and ran the real script twice:
  - No `--image=` flag → exit 1, full guidance block printed to stderr (both the `gcloud run
    services describe` lookup and the `cd-backend.yml` CI-tag lookup), stub never invoked.
  - `--image=us-west1-docker.pkg.dev/.../helio-backend:release-v1.6-testsha --no-traffic` → guard
    passes, stub gcloud invoked with `run deploy helio-backend ... --image=...testsha
    --no-traffic` appended verbatim at the end of the real arg list (confirms `"$@"` passthrough
    from HEL-749 Decision 4c is untouched and still the single mechanism for supplying the flag,
    matching design.md D1).
  This exactly reproduces the evaluator's own claimed manual test, from fresh evidence.

- **Mechanical gates re-run myself (not re-trusted):**
  - `bash -n infra/deploy-backend.sh` → exit 0.
  - `grep -E -- '--image=us-west1-docker' infra/deploy-backend.sh` → empty.
  - `npm run lint` → clean, exit 0 (root `node_modules` is absent in this worktree —
    `CONCERTINO_LINK_MODULES` only populates `frontend/node_modules` per
    `concertino.config.json` — but npm's PATH construction walks ancestor directories and finds
    the main checkout's `node_modules/.bin/eslint`, which still lints the worktree's own files
    since `eslint .` resolves against cwd; verified this is real linting, not a silent no-op, by
    confirming `node_modules` truly doesn't exist at the worktree root yet the command still
    executed and printed the eslint banner).
  - `npm run format:check -- infra/deploy-backend.sh infra/README.md` → "All matched files use
    Prettier code style!".
  - `npm run check:schemas` → "schemas in sync ... panel-type enums in sync ...".
  - `npm run check:openspec` → fails with exactly `change "fix-stale-deploy-image-tag" is complete
    (7/7) but not archived` — confirms the executor's documented pre-commit bypass reason is real
    and matches the HEL-749/`fd930868` precedent cited in both the commit body and CLAUDE.md.
  - `openspec validate fix-stale-deploy-image-tag --strict` → "Change ... is valid".
  - `git show -s --format=%B 251e28f4` → commit body explicitly documents the `-n` bypass
    reasoning, matching CONTRIBUTING.md's pre-commit policy ("If a bypass is used, call it out
    explicitly and follow with a fix commit" — the fix here is the Phase-3 archive step still to
    come, not a defect).

- **Docs/code coherence.** Read `infra/README.md`'s full "Run the deploy" section
  (lines ~108-150): states the script's manual/bootstrap role vs. `cd-backend.yml`, the required
  `--image=` flag, and both tag-discovery methods — verbatim consistent with the guard's own
  stderr guidance text and with the actual numbered script-behavior list (now correctly
  renumbered 1-4 to include the new guard step). No stale references to the old `:v3` default
  remain anywhere in the diff.

- **files-modified.md / evaluation-1.md claims spot-checked against ground truth, not trusted.**
  Both accurately describe the diff; evaluation-1.md's Phase 1/2 findings all independently
  reproduced above. No discrepancy found between what was claimed and what the diff/tests
  actually show.

- **UI review: N/A**, as directed — no `frontend/**` files in `git diff origin/main...HEAD
  --name-only`; this is an infra-script + docs change only, dev servers not required for
  verification of a bash script's exit-code/stderr behavior.

### Verdict: CONFIRM

### Non-blocking notes

- design.md's own accepted risk (D2's substring-match false-positive if a *future* fixed
  `--set-env-vars`/`--set-secrets` value ever happened to contain the literal substring
  `--image=`) is real but explicitly scoped out and low-probability; not a blocker for this
  change as shipped today.
- Archiving this change (Phase 3) is the only remaining step before `check:openspec` goes green —
  correctly deferred per the orchestrator's workflow, not a defect in this review.
