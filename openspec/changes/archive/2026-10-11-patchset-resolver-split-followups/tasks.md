## 1. Baseline

- [x] 1.1 `free -g` (>= ~15 GB available); record base per-suite counts for the patch-set specs and `ExistenceNotLeakedRoutesSpec` (targeted run, `[hel1468-guard]` shown).

## 2. Item 7 - priority (D2, D3)

- [x] 2.1 Write `PatchSetPipelineStepGrantSpec` (editor accept / viewer 403 for update, delete, create via apply; update via preview). If any test fails on unmutated code, STOP and escalate (D2).
- [x] 2.2 M7a/M7b/M7c red/green per D1; record in `mutation-evidence.md`.
- [x] 2.3 Editor-grant audit (D3): mutate each listed branch, run selected specs, confirm survivors with `testFull`; table in `mutation-evidence.md`; patch-set survivors get tests (D1), others listed for a follow-up ticket.

## 3. Items 5-6 (D4)

- [x] 3.1 `requireTargetId` message test(s); M5 red/green.
- [x] 3.2 `decodeCreatePatch` missing-patch and wrong-shape message tests; M6a/M6b red/green.

## 4. Item 4 (D5)

- [x] 4.1 Repoint the four output rows' `sites`; M4 red (all four rows, foreign-vs-absent) / green.

## 5. Items 1-3 (D6)

- [x] 5.1 Fix the ticket-listed citations and `PipelineProtocol.scala`'s nonexistent-member citation.
- [x] 5.2 Sweep per D6; every hit with verdict in `citation-sweep.md`.

## 6. Verification (D7)

- [x] 6.1 `git diff -- backend/src/main` is comment-only (filtered diff recorded).
- [x] 6.2 `npm run check:scala-quality` passes; no inline FQNs in the diff.
- [x] 6.3 `testFull` green with `[hel1468-guard]`; per-suite counts in `test-count-evidence.md`.
- [x] 6.4 Write `files-modified.md` and commit.

## Standing Constraints

- [C1] No behaviour change in main code: comment edits only (never string literals, identifiers or code). A defect found becomes an escalation (authorization) or a follow-up (anything else), never a fix here.
- [C2] Every new test is shown red under a one-line mutation of the exact branch it guards, then green; mutation scripts live in the run evidence dir, never committed.
- [C3] In `ExistenceNotLeakedRoutesSpec` change only the four output rows' `sites`; panel/step rows, `patchKindExemptions`, `expectedForbiddenProducers` and `patchSetDispatchPairs` untouched.
- [C4] No split of `PatchSetPipelineStepResolvers.scala`; no edits to HEL-1479's archived evidence.
- [C5] sbt runs use `nice -n 19 sbt -batch -J-Xmx3g`, show `[hel1468-guard]`, leave no server running; check `free -g` before heavy runs and commits.
- [C6] New spec files use `VerifiedEmbeddedPostgres.start`; no inline FQNs.
- [C7] Never use pkill/pgrep/killall; no `--no-verify`/`HUSKY=0`/hooksPath override; use `git -C`; never print `backend/.env`.

## Items 8-9 decisions (D6)

Item 8: keep `PatchSetPipelineStepResolvers.scala` unsplit. Item 9: leave HEL-1479's archived scripts unedited.
