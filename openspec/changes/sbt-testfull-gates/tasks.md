## 1. Red evidence

- [x] 1.1 On the base tree, run `cd backend && nice -n 19 sbt test` twice with no source change; record that the repeat run executes zero tests and exits 0 (paste transcript excerpt).

## 2. Config and render

- [x] 2.1 Confirm `concertino diff` reports 0 changed and the concertino checkout is not behind origin/main.
- [x] 2.2 Change `concertino.config.json` `backend-test` command to `cd backend && sbt testFull`; run `concertino sync`; verify `git diff --stat` shows only the config plus rendered files containing the gate string, and `grep -rn "sbt test$" .claude .cursor` finds none.

## 3. Prose

- [x] 3.1 Update CLAUDE.md and CONTRIBUTING.md full-suite instructions to `sbt testFull` with a one-line why; verify with a repo-wide grep (excluding node_modules, archive, target) that each remaining `sbt test` hit is intentionally left.
- [x] 3.2 Audit docs/cloud-dev-setup.md and record the finding.

## 4. Green evidence

- [x] 4.1 Run `cd backend && nice -n 19 sbt testFull` twice; record that the repeat run executes the full suite (test count) and exits 0.

## Standing Constraints

- [C1] Backend gates use `cd backend && nice -n 19 sbt testFull`, never bare `sbt test`; one full backend suite at a time; run `sbt --client shutdown` in the worktree before cleanup.
- [C2] Never hand-edit rendered files (.claude/, .cursor/, scripts/concertino/); change concertino.config.json then concertino sync; unrelated render churn means stop and escalate.
