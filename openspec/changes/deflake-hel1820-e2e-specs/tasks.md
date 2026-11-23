## Standing Constraints

- [C15] Time one full-file run of each spec first; if a full-file run (plain or stressed) cannot finish inside the 600 s Bash timeout, run every test of that file as separate invocations and say so explicitly; never quietly run only the target test. Escalate if neither fits.
- [C16] For every stressed run (CPU throttle or injected stall), record the mechanism and its exact diff/code as committed .txt evidence, plus proof in the run output that the stress was actually active.
- [C17] Any mutation of app code stays uncommitted and is reverted; show `git status --short` with no app files afterwards in the committed mutation evidence.
- [C18] Each stated root cause must be backed by probe output committed as .txt (not inferred from code reading alone); an unconfirmed cause is labelled unconfirmed.

## Driver Constraints

Binding for every role: `driver-constraints.md` in this change dir (C1-C14 plus the shared-browser, no-live-model,
sibling-lane and follow-up rules). Restate them to any sub-agent.

## 1. Environment and CI evidence

- [x] 1.1 Create lane DB `helio_hel1826`; start servers via start-servers.sh (ANTHROPIC_API_KEY empty, lane DATABASE_URL)
- [x] 1.2 T1: pull run 44998353027 job e2e (4) failed log + trace; save to main checkout .concertino/scratch/HEL-1826/
- [x] 1.3 T2: pull run 44998353027 job e2e (7) attempt with the failure, log + trace
- [x] 1.4 T3: locate and pull the PR #1222 and #1223 failing runs, logs + traces
- [x] 1.5 Record the failing assertion, message, line and runner CPU per test in the change dir (ci-evidence.txt)

## 2. T1 hel1791-compact-counter-stack-height:290

- [x] 2.1 Reproduce (repeat, CPU throttle, injected stall) with probes discriminating H1a-H1c; commit red/probe .txt
- [x] 2.2 Write root cause to root-cause.md (or escalate per Decision 3 / state unreproduced per Decision 4)
- [x] 2.3 Fix (test-only, Decision 2); mutation run red at the guarding assertion, committed .txt
- [x] 2.4 20x green full spec (2 workers, nice -n 19) + 20x under the reproducing stress, committed .txt

## 3. T2 hel1582-mobile-pipeline-motion-and-states:244

- [x] 3.1 Reproduce with probes discriminating H2a-H2d; commit red/probe .txt
- [x] 3.2 Root cause to root-cause.md (or Decision 3 / 4)
- [x] 3.3 Fix; mutation run red, committed .txt
- [x] 3.4 20x green full spec + 20x under stress, committed .txt

## 4. T3 hel1572-appearance-preferences:126

- [x] 4.1 Reproduce with probes discriminating H3a-H3c; commit red/probe .txt
- [x] 4.2 Root cause to root-cause.md (or Decision 3 / 4)
- [x] 4.3 Fix; mutation run red, committed .txt
- [x] 4.4 20x green full spec + 20x under stress, committed .txt

## 5. Close

- [x] 5.1 lint + typecheck + prettier on changed e2e files
- [x] 5.2 Stop every server started by exact PID / stop-servers.sh; report follow-up candidates and flake-list recommendations
