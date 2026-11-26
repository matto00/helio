## Lane constraints (driver brief; binding on every agent, see the orchestrator's spawn prompt for the full text)

- C1 never read/print any .env (scripts may read scripts/concertino/.concertino.env, never print it); no env dumps.
- C2 quoted heredocs only; C3 no pkill/pgrep/killall, exact PIDs, stop servers with stop-servers.sh.
- C4 jest 3 workers, Playwright 2 workers total, sbt -J-Xmx3g, nice -n 19; C5 Bash timeout 600000, small sbt shards.
- C12 red first, mutations, full spec files; commit red output as .txt before implementation.
- C13 scratch in the MAIN checkout's .concertino/scratch/HEL-1542/; C14 lane DB helio_hel1542 exported on every run.

## Standing Constraints

- [C1] Every rewritten hel908-tail-attach test asserts the tree twice: in the draft before Save & run, and after Save & run plus reload.

### Backend

## 1. Backend: draft keys in lane refusals

- [x] 1.1 Add a DB-backed draft-save route test with three cases: a lane cycle via a created step (clientId), a
  dangling lane target with a created subject (`requireLaneTargetsExist`), and a cycle between existing steps (a
  guard, green on main). Assert the 400 names only client-sent keys. Commit the red run (.txt) on main's code.
- [x] 1.2 `DraftPlan`: expose resolved-id → draft-key for created steps; `laneGate` and `requireLaneTargetsExist`
  name steps by draft key (design D1). 1.1 goes green; mutation (revert the mapping) turns it red.

### Frontend

## 2. Frontend: labels in the refusal notice

- [x] 2.1 Add jest tests (`draftSaveRequest.test.ts`, plus a `PipelineDraftNotices` render test): (a) the notice
  message contains no page step id, only labels; (b) the prefix names the subject when the target precedes it in
  array order; (c) a created step's client id becomes its label; (d) a dangling target removed in the draft gets its
  SAVED label; (e) an unknown id is left verbatim. Commit the red run (.txt): (a), (b), (d) red on main.
- [x] 2.2 Implement D2 (draft then saved then created-Output lookup; earliest-occurrence subject; every-occurrence
  substitution, longest-first, unknown ids verbatim). 2.1 goes green. Record mutations: array-order subject turns (b)
  red; dropping substitution turns (a) red; dropping the saved-steps lookup turns (d) red.
- [x] 2.3 Change "dependent" to "descendant" in the three HEL-1515 comments,
  `useStepCardState.characterization.fixtures.ts` L517/526/535 only. Verify with `git diff` (3 lines).

### Tests

## 3. Tests: hel908-tail-attach rewrite and evidence

- [x] 3.1 Confirm each D4 rule against the running app/server before writing it; report any rule that differs.
- [x] 3.2 Rewrite `e2e/hel908-tail-attach.spec.ts` (four tests, D4) on the pipelineSpine.ts and hel1684 helpers.
  Assert each tree twice, in the draft and after Save & run + reload [C1]. Exact-id user cleanup, with DATABASE_URL
  exported.
- [x] 3.3 Remove the quarantine entry and comment from `playwright.config.ts` (D5); confirm with `npx playwright test
  --list` (via the repo script) that the spec is collected.
- [x] 3.4 Run the full spec file 3 consecutive times at 2 workers against the lane servers; keep the transcripts.
- [x] 3.5 Visual check of the refusal notice in light and dark themes on the lane dev port. If the lane 400 is
  unreachable in the UI, record the paths tried instead.
- [x] 3.6 Run the full jest files touched, frontend lint/typecheck/format, and the backend spec shards touched; write
  `files-modified.md`.
