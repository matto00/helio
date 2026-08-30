## 1. Make sync deliberate (must complete before task group 2)

- [x] 1.1 Add `"cleanup": { "skipSync": true }` to `concertino.config.json`.
- [x] 1.2 Run `concertino validate` and confirm it prints `✓ cleanup.skipSync   true`.
- [x] 1.3 Run `concertino sync` from the repo root and confirm `scripts/concertino/.concertino.env` now contains `CONCERTINO_CLEANUP_SKIP_SYNC=1`.
- [x] 1.4 Run `concertino sync` a SECOND time and confirm the key is still present (AC3 render-idempotence; this is the check a unit test cannot perform). Capture both outputs as evidence.

## 2. Track the delivery scripts

- [x] 2.1 Rewrite the `# Concertino` block in `.gitignore`: drop `scripts/concertino/` and `concertino.config.json`; keep `.concertino/`; add negative exclusions for `scripts/concertino/pricing-table.json` and `scripts/concertino/report-cost.sh` with a comment naming why (Decision 5).
- [x] 2.2 Re-run the secret/machine-path enumeration over `scripts/concertino/` and record the result before adding anything (Risks, design.md).
- [x] 2.3 `git add` the 15 delivery scripts. Confirm by enumeration that the added set is exactly the 17 previously-absent files minus the 2 strays — do not eyeball it.
- [x] 2.4 Confirm `git check-ignore` still reports `.concertino/` as ignored, and reports the two strays as ignored (AC2, AC6).

## 3. Document the render-vs-edit contract

- [x] 3.1 Add a short, explicit section to `CLAUDE.md` stating that `scripts/concertino/` is rendered from Concertino's `core/`, that local edits are erased by the next `concertino sync`, that script changes go to the Concertino repo, and that sync is now manual in this repo (AC5).
- [x] 3.2 Add a pointer in `scripts/concertino/README.md` ONLY if it can be done without hand-editing a rendered artifact; otherwise state in the commit body why it was omitted and rely on `CLAUDE.md`.

## 4. Verify by measurement (no attestation anywhere in this group)

Every step below observes an effect. No step is satisfied by reading `.gitignore`, reading `cleanup.sh`, or paraphrasing branch logic. If a step cannot be executed, it is not marked done — it is escalated.

- [x] 4.1 Commit the change on the ticket branch.
- [x] 4.2 (AC1) Create a SECOND, throwaway git worktree from the ticket branch and list `scripts/concertino/` in it. Expect 23 files (8 previously tracked + 15 newly tracked), and specifically confirm `emit-event.sh`, `persist-evidence.sh`, `tui-attached.sh` and `squash-branch.sh` are present. Diff against the recorded 8-file baseline to show the red→green transition. Additionally, EXECUTE one of the newly-present scripts from inside that worktree (e.g. `scripts/concertino/tui-attached.sh`; any exit code is fine, "not found"/127 is the failure) — presence on a listing plus a successful invocation, not a listing alone.
- [x] 4.3 (AC6) Confirm `pricing-table.json` and `report-cost.sh` are ABSENT from that second worktree.
- [x] 4.4 (AC3 property (b), AC4) Demonstrate the skip by REAL EXECUTION, capturing literal output. Build a disposable sandbox: `git clone` this repo to a temp dir, reset its local `main` one commit behind its origin so a fast-forward is actually available (this is what makes `FF_STATUS=updated` reachable — it is NOT reachable from the AC1 measurement worktree), create a worktree in it via `setup-worktree.sh`, then run `scripts/concertino/cleanup.sh --phase4 ...` in it and capture stderr verbatim. Required evidence: the literal line `note: main fast-forwarded — \`concertino sync\` re-render skipped (CONCERTINO_CLEANUP_SKIP_SYNC set); run it manually if needed`, together with proof that `FF_STATUS` really was `updated` (the fast-forward note) — a skip observed while no fast-forward occurred proves nothing, because that branch is never entered. Also demand the red: run the SAME sandbox scenario once with `CONCERTINO_CLEANUP_SKIP_SYNC` forced empty and show the sync DOES fire (different literal output), so the passing run is distinguishable from a vacuous one.
- [x] 4.5 (AC4 postcondition) In that same sandbox run, after `cleanup.sh --phase4` completes, run `git status --porcelain scripts/concertino/` at the sandbox repo root and show it is EMPTY. This is AC4's literal assertion — no uncommitted changes under `scripts/concertino/` after a Phase-4 run — and it must be observed, not inferred from 4.4.
- [x] 4.6 If, and only if, the 4.4/4.5 sandbox genuinely cannot be constructed, do NOT downgrade to code reading. Record the specific blocker in the evaluation report and escalate; this ticket's own terminal Phase-4 run is a second real opportunity (`FF_STATUS` will be `updated` there), and AC4's evidence may be deferred to it, but it may never be satisfied by static inspection.
- [x] 4.7 Remove the throwaway worktree and the disposable sandbox clone.

## 5. Acceptance-criteria mapping (state explicitly; each AC needs a named executed step)

- [x] 5.1 AC1 → task 4.2. AC2 → task 2.4. AC3 splits into two properties: (a) "the setting survives a re-render" → task 1.4 (double `concertino sync`); (b) "`cleanup.sh` does not auto-run sync in this repo" → task 4.4 (real execution, literal output). AC4 → tasks 4.4 + 4.5. AC5 → task 3.1. AC6 → tasks 2.1 + 2.4 + 4.3.
- [x] 5.2 Confirm no AC is discharged by an unexecuted step, and record this mapping in the final commit body or the change's evidence.
