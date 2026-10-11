## 1. Baseline

- [x] 1.1 MemAvailable check; copy/repoint `mut.py`/`mutl.py` into `.concertino/runs/HEL-1488/evidence/`; record base per-suite counts for any existing spec you extend (targeted run, `[hel1468-guard]` shown).

## 2. Site 7 first (D2)

- [x] 2.1 PipelineRunService.submit viewer/editor/owner tests; unmutated green (else STOP + ESCALATION).
- [x] 2.2 V/E/owner mutations red, revert, green; record in `mutation-evidence.md`.

## 3. Sites 1, 2, 3, 8 (D2)

- [x] 3.1 PanelService.batchUpdate tests + V/E/owner red/green.
- [x] 3.2 DashboardContentsService.replaceContents tests + V/E/owner red/green (record equivalent owner mutant if any).
- [x] 3.3 DashboardService.exportSnapshot tests + V/E/owner red/green.
- [x] 3.4 OutputService.create tests + V/E/owner red/green.

## 4. Sites 4, 5, 6 (D2, D4)

- [x] 4.1 AccessCheckerImpl anonymous public-viewer arm exact test + mutation red/green.
- [x] 4.2 AclDirective anonymous token-authorized arm exact test + mutation red/green.
- [x] 4.3 ResourcePermissionRepository unknown-role fallback: dedicated-cluster test + comment (or documented fallback) per D4; mutation red/green.

## 5. Citations (D5)

- [x] 5.1 Fix both `resolveRootDataSources` citations; grep for others; record.

## 6. Verification (D6)

- [x] 6.1 `backend/src/main` diff comment-only (non-comment-line filter recorded in `verification.md`).
- [x] 6.2 `npm run check:scala-quality` passes; no inline FQNs.
- [x] 6.3 `testFull` green with `[hel1468-guard]`; per-suite counts in `test-count-evidence.md`.
- [x] 6.4 Write `files-modified.md` and commit.

## Standing Constraints

- [C1] No behaviour change in main code: comment edits only (never string literals, identifiers or code). An authorization defect found becomes an ESCALATION with exact repro (PR parked), any other defect a follow-up; never a fix here.
- [C2] Every new test is shown red under a one-line mutation of the exact branch it guards, then green; mutation scripts live in the run evidence dir, never committed.
- [C3] Exact assertions only (exact ServiceError value, or exact HTTP status + body); accept tests observe the effect.
- [C4] sbt runs use `nice -n 19 sbt -batch -J-Xmx3g`, show `[hel1468-guard]`, leave no server running; MemAvailable >= ~15 GB before testFull/full jest; at most two testFull machine-wide.
- [C5] New spec files use `VerifiedEmbeddedPostgres.start`; no inline FQNs.
- [C6] Never use pkill/pgrep/killall; no `--no-verify`/`HUSKY=0`/hooksPath override; use `git -C`; never print/cat/source `backend/.env`; no writes under `~` outside the worktree/run dir; no /tmp; scratch namespaced HEL-1488.
