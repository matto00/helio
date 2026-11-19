## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; no env-dumping commands; only scripts may read scripts/concertino/.concertino.env, never print it. Do not copy .env files.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs; stop servers with stop-servers.sh; test residue deleted by exact id via buildUserDeleteSql.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that fit; no background run past the tool timeout.
- [C12] Red first with mutations; full spec files; record and COMMIT the red run before implementation code.
- [C13] Scratch in .concertino/scratch/HEL-1775/.
- [C14] Lane-private DB helio_hel1775; DATABASE_URL for start-servers.sh AND Playwright; DB_USER when the URL has no credentials; ANTHROPIC_API_KEY exported empty.

### Backend

## 1. Pin builder fallback (item 3)

- [x] 1.1 Write the route-level spec (Decision 4) and run it red: the root-less body gets `400`; commit the red run
- [x] 1.2 Change `AskPinBuilder` to omit the node when neither step nor root id is set; the spec goes green
- [x] 1.3 Update `AskDataServiceSpec`'s fallback test (321-326) to assert no `rootId`/`nodeStepId`; keep its round trip; run it and `AskSeamSpec`

### Frontend

## 2. Preview chart fills its card (item 1)

- [x] 2.1 Write the Playwright spec (Decision 5, 1280/375, light/dark) and run it red; commit the red run
- [x] 2.2 Make `.output-preview-pane__chart` a flex column (Decision 1); the new spec and `hel1763-output-editor-preview-scroll` pass

## 3. Question resets on scope change (item 2)

- [x] 3.1 Write the jest test (Decision 6) and run it red; commit the red run
- [x] 3.2 Hold the question with its scope key in `AskPanel` (Decision 2) and update its doc comment; the test passes

### Tests

## 4. Verification

- [x] 4.1 Mutation-check each new test (revert each fix, confirm red) and record results in `mutations.md`
- [x] 4.2 Grep `e2e/` for `.output-preview-pane__chart`, `.panel-content`, the ask question field; run every matching spec file
- [x] 4.3 Run the ask and outputEditor jest suites, lint, typecheck, and the backend ask/output specs; all green
