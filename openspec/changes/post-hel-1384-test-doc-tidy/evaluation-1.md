## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 0dd29fcf297e1cf54a4f677fdbbfeab35bfd2d41. Diff base: 2fb8deb5a0cefb9855262991db39fba9d3ebd1ec, resolved live via resolve-review-base.sh.
Diff scope: backend main and test sources, one archived openspec note, and this change dir. No `frontend/**`, `schemas/**`, `openspec/specs/**` or ApiRoutes.scala changes.

### Phase 1: Spec Review — PASS
Issues: none.

- Item 1: the two undecodable-config tests move verbatim into a new "(red-first)" group (bodies are byte-identical in the diff). The red run on 1bf11f55 fails both on assertions at :397 and :419 (`true was not equal to false`), not on a compile error. The shim was confined to `newScheduler`'s constructor call in the throwaway copy, which is D2's allowed path. 2.4a passed on 1bf11f55 and stays GUARD. The log is gitignored (`*.log`, .gitignore:27), so I persisted it: ref=/home/matt/Development/helio/.concertino/runs/HEL-1429/evidence/openspec/changes/post-hel-1384-test-doc-tidy/evidence/item1-red-on-1bf11f55.log
- **Flagged point, 1.1a vs the header:** the header is still accurate. 1.1a sits in the "gap 2" group, and the header's "Red-first: the 'gap' tests below" already covers it. Its red half is the `startWith(SkipPrefix)` check at :272, which has its own "Red on main" comment. ScalaTest stops at the first failed assertion, and on 1bf11f55 the test failed at :272. So the prune/size assertions at :269-270 ran and passed there, and the header's narrower claim ("the run-history cap test's **prune assertion**" is a GUARD) holds. The test name says the same: "(1.1a; guard for the prune call)". No relabel needed.
- Item 2: the comment now points at `gatedSubmit`. See the non-blocking wording note below.
- Item 3: PipelineSchedulerService is down to 251 lines. The new PipelineAutoRunDebounceFirer is 98 lines.
- Items 5–9:
  - Item 5: renamed titles checked against `sbt` output (see Phase 2).
  - Item 6: `grep -rn findPrimaryDataSourceIdInternal backend frontend/src helio-mcp/src` finds only historical-phrasing comments (PipelineRepository:112, PipelineService:957/986). There are no call sites, and testFull compiles.
  - Item 7: the note is appended, and the original line 52 is kept. ExistenceNotLeakedRoutesSpec:529 confirms the `PipelineRunPreview.scala -> 1` pin, and PipelineRunPreview:244 confirms where `authorizedForAi` lives.
  - Item 8: the three corrected params have no default in the diff context. The three kept hits (OutputProtocol:27, model.scala:860, DataSource:56) remain.
  - Item 9: OutputService:77 passes `output.node.rootId`. OutputRepository:229-234 shows a step-bound Output's rootId is `None` and a root-bound one always gets `Some`, so the new wording is accurate.
- Item 4 reasoned skip is recorded, as D8 allows.
- CONSTRAINTS C1–C3 are honored. C1: no assertion or test body changes, and production logic changes only by the Option-fold replacing the null check (see Phase 2). C3: the throwaway worktrees are gone (`git worktree list` shows none).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself on 0dd29fcf (backend-only diff):
- `nice -n 19 sbt -J-Xmx3g testFull` (from `backend/`): `Total number of tests run: 6440 / Suites: completed 462, aborted 0 / Tests: succeeded 6440, failed 0, canceled 4` with exit 0. Tests actually executed (initdb and log timestamps are from this run), so this is not a cache replay. AutoRunGuardBurstProofSpec (HEL-1439) passed on the first attempt. The relabelled group "fire-time evaluation error: undecodable step config (red-first)" and all four renamed PipelineRunServiceSpec describe titles appear in the output.
- `check:scala-quality` clean (soft warnings only). `check:openspec`, `check:spec-structure`, `check:no-credential-leak`, `check:repo-integrity` and `format:check` are all clean.

**Flagged point, pure move:** confirmed independently. I extracted the auto-run block from base PipelineSchedulerService.scala and diffed it whitespace-insensitively against PipelineAutoRunDebounceFirer.scala. The only deltas are the three listed:
1. The `if (autoRunDebounceRepo == null) ... else` guard is replaced by `autoRunFirer.fold(...)` in `tick()`.
2. `private def processAutoRunDebounce` becomes a public member of a `private[pipelines]` class.
3. Comment back-references are qualified with `PipelineSchedulerService.`.

Log messages, levels and arguments are byte-identical. The logger is `classOf[PipelineSchedulerService]`, the same name `getClass` produced, so the FireTimeRunConfigGateSpec ListAppender still sees it. Constructor signature, defaults, `require`s and `tick()`'s `.recover` placement are unchanged. The moved code reads no scheduler state (it does not use the in-flight guard), so nothing is duplicated (D1c).

**Flagged point, base testFull 34 failures and per-suite equality:** the substantive claim holds, with documentation gaps (see suggestions):
- All 34 base failures are `NoKeyConfigured` in 10 env-dependent suites. Re-running those with env exported gave 0 failures. Head has 0 failures in the same suites in my own run, with `.env` present.
- The two suite-count JSONs are identical across 462 suites. Note that they record per-suite **test counts**, not pass/fail counts; the base JSON matches head even though that log had 34 failures. Per-suite pass/fail equality is therefore inferred: head is 0 failed everywhere, base failures are confined to env-only suites that pass with env. It is not shown directly.
- The 10 named suites sum to 480 tests in the JSON, but the env re-run reports 560 tests across 12 suites. Most likely the testOnly patterns matched two extra suites, but the evidence does not say. This does not weaken the conclusion: the 480 are a subset of a 560/0 run.
- Which 4 tests are canceled on base is not shown, only the total, which matches head (4).

Checklist: canonical code-quality PASS (no inline FQNs, imports trimmed, no dead code). DRY, modular, type safety, error handling and security are unchanged by the split. Tests: no new code paths beyond the Option fold, which is exercised by both wired and unwired fixtures in the passing suite. No over-engineering. Behaviour-preserving PASS.

### Phase 3: UI Review — N/A
No trigger paths changed (backend-only diff, no ApiRoutes.scala, schemas or specs).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- PipelineSchedulerService.scala:186-187: `gatedSubmit` now contains three `Failure` arms (the submit `transform`, the recordUnrunnable `transform`, and the outer `transformWith`). "the `Failure` case of `gatedSubmit`'s `transform`" would read more precisely as "the `Failure` arm of the submit branch's `transform` in `gatedSubmit`".
- evidence/testfull-comparison.md:
  - Say that the suite-count JSONs compare per-suite test counts, not pass/fail.
  - Explain the 560 tests / 12 suites env re-run against the 480 tests / 10 named suites.
  - Optionally name the 4 canceled tests on each side.
- evidence/item1-red-on-1bf11f55.log is gitignored (`*.log`), so verdicts.md cites a file that is not in the commit. It is now persisted at the ref above. Consider renaming it to `.txt` so it ships with the change.
- FireTimeRunConfigGateSpec (458 lines) uses section banners. CONTRIBUTING.md reserves dividers for files of about 1,000 lines or more. This is a pre-existing convention in the file and design D2 asked for it to be kept up to date, so it is not counted against this change.
- PipelineRunBackfill.scala:71 and PipelineRunService.scala:281: "every root is evaluated" is literally true, but the persisted rows are the lowest-positioned root's frame (R10, PipelineRunBackfill:~107). Production never reaches that combination (root-bound Outputs always carry a rootId), so this is minor.
