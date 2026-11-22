## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file nor run env-dumping commands; scripts/concertino/.concertino.env may be read by scripts, never printed; never copy .env files or trees containing them.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete test residue by exact id (buildUserDeleteSql).
- [C4] jest 3 workers, Playwright 2 workers total (never two Playwright batches at once), sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; never a background run past the tool timeout.
- [C8] No prod, no release, no concertino sync, no MCP deploy.
- [C9] No claude.ai session link in PR bodies or commits.
- [C12] Red first with mutations; run full spec files; commit the red run as .txt before implementation code.
- [C13] All scratch/tool output in /home/matt/Development/helio/.concertino/scratch/HEL-1804/ (never /tmp, never inside the worktree); evidence for follow-ups in .concertino/runs/HEL-1804/evidence/.
- [C14] Lane DB only: DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1804 DB_USER=matt DB_PASSWORD='' for start-servers.sh, Playwright, e2e cleanup and any DB-touching jest/hook run; backend started with ANTHROPIC_API_KEY exported empty.
- [C15] Shared Playwright MCP browser: check for an open dialog and that the page is on dev port 7236 before any UI result; never navigate another lane's port.

## 1. Tests (red first)

- [x] 1.1 Record per-kind stack heights on the unmodified code (`HEL1791_LABEL=before`) and keep the JSON as evidence
- [x] 1.2 Extend `e2e/hel1791-compact-counter-stack-height.spec.ts` with the blank-space and regions-attached assertions (design D3); run the full spec file on unmodified code, confirm red, commit the red output as `.txt`
- [x] 1.3 Add the status + alert message test LAST in the file on the existing counter panel (design D3: same element handles, role, visible, in flow: `position: static` and below the last content); confirm it passes on unmodified code

## 2. Frontend

- [x] 2.1 Add the scoped `:empty` → `position: absolute` rule and `position: relative` on `.form-panel-view__compact-counter` in `CounterControl.css`; verify the full e2e spec file goes green at 390/768/1100, light and dark
- [x] 2.2 Optional jest CSS guard for the rule (no `display: none`/`visibility`), labelled as a guard; verify `npm --prefix frontend test -- --testPathPatterns=<file>` passes

## 3. Verification

- [x] 3.1 Record per-kind heights after (`HEL1791_LABEL=after`), diff against 1.1; every non-counter card within 0.5 px; commit the diff transcript
- [x] 3.2 Mutations: M1 remove the rule (expect the blank-space assertion red), M2 drop `:empty` (expect the message test's in-flow assertion red); commit the transcripts; restore
- [x] 3.3 Desktop grid before/after screenshot of the compact counter card (design D2) in evidence
- [x] 3.4 Run in full (<=2 Playwright workers, no parallel batch) hel1088-compact-counter-chrome, hel1087-form-submit-path, hel1095-optimistic-pending-writing-panel-a11y, hel1169-network-vs-rejection-reconcile-a11y, hel1090-form-panel-assembled-a11y; record results (base-failing = pre-existing)
- [x] 3.5 Frontend lint, typecheck, format check and the form-panel jest suites pass
