## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `07918971736e8a896bbbecbb737de816cfd0e83c`. The base was resolved live by `resolve-review-base.sh` as `87cf01a5f745fdd7315d21530a78a176ec83211a`.

### What I verified (with evidence)

- **Scope and driver constraints.** I ran `git diff --stat BASE...HEAD`. The only server main-code change is `PipelineAnalyzeReads.scala`. There is no change to `PipelineService.scala`, `RunConfigGate`, `AutoRunTriggerService` or `PipelineCostInputGathering`, and no file under `db/migration`.
- **D1/D2/D3 implementation (read in full).**
  - The cost roots now come from `findByIdInternal`. Admission is still `findByIdShared`, which is unchanged.
  - For a non-owner, an owner-view `analyzeNodes` pass is used only to set `validationError`.
  - `nonOwnerValidationError` returns one of three texts: the config-only `stepConfigProblem` text, a text identical to the caller-view one, or `NeutralStepError`.
  - For a non-owner, every estimator reason gets a neutral detail, and `estimatedRows` becomes `lastRunRowCount`.
  - Owners take the old path, with no second pass.
- **Backend, fresh run.** I ran `sbt -J-Xmx3g testOnly Hel1661GranteeAnalyzeVerdictSpec Hel1516GranteeDriftPreviewSpec AutoRunTriggerServiceSpec PipelineAnalyze*` under `nice -n 19`. Result: `Tests: succeeded 66, failed 0`.
  - All 8 HEL-1661 cases passed, including `[PIN]` (the app pool is `helio_app_test` with `rolbypassrls=false` and `rolsuper=false`) and stranger `NotFound`.
  - The caller-view literals passed: source name `""`, no fields, no root column in the step schemas.
  - Case (d) passed: the grantee gets the neutral text, `float` does not appear, and the owner keeps the typed message.
  - The URL-root neutral detail case and the `estimatedRows` case (absent, then last run) passed.
  - Editor trigger/analyze agreement passed: `triggerAutoRun` codes equal analyze codes for (e) and (b).
- **Red first.** Commit `38395d5e0` contains only tests, design artifacts and red transcripts, with no implementation. `red-run/red-scala.txt` shows 4 `[DEFECT]` failures on main. `red-run/red-e2e.txt` shows 3 failures.
- **Live analyze probe** (lane servers on 7093/10000, DB `helio_hel1661`, `ANTHROPIC_API_KEY` empty). I seeded an owner, editor, viewer and stranger, a valid pipeline P and an invalid pipeline P2 (`$flag AND $amount`).
  - Pipeline P:
    - owner: autoRunnable and canRun both true, est 2;
    - editor: autoRunnable and canRun both true, est absent, no reasons;
    - viewer: autoRunnable true, canRun false;
    - stranger: HTTP 404.
  - Pipeline P2:
    - owner: `'and' requires boolean operands, got boolean and float`;
    - editor and viewer: "This step's configuration does not match its input." as both the step error and the reason detail;
    - stranger: HTTP 404.
  - The grantee responses carry `sourceSchemas` `[("", [])]` and empty step input schemas. The only hit for `flag` in a grantee body is the step's own config expression, which grantees already read from the steps route. Raw bodies are in `.concertino/scratch/HEL-1661/sk/an-*.json`.
- **Frontend gates, fresh run.** Jest over `features/pipelines` plus `rawElementGuardHel440`, 3 workers: 217 suites and 3232 tests passed. `tsc --noEmit` exited 0. `eslint --max-warnings 0` on the changed files exited 0.
- **e2e, fresh run** (Playwright 2 workers, `DEV_PORT=7093`): `hel1661-viewer-run-controls` and `hel1661-grantee-source-banner` gave `3 passed`. The global teardown deleted its 9 users. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/.concertino/scratch/HEL-1661/skeptic-final-e2e.txt`.
- **Run-entry coverage (audited by grep, not taken from the executor's audit).** Every caller of `handleRunPipeline`, `handleDryRun`, `saveAndRun`, `onRunNow`, `onRunPipeline` and `handleRunToUpdate` in `frontend/src` is gated:
  - the header and phone pills through `canRunFromUi`;
  - the Output sheet through a prop that is passed only for runners;
  - the toast's Run now is omitted for a viewer;
  - the handlers return early for `viewer`;
  - `saveAndRun` and `confirmCascade` return early for `viewer`.

  The ⋮ menu has no run item. The Output sheet is shared by desktop and phone (`PipelineDetailDialogs` is the only mount).
- **UI judgment.** I looked at each of these screenshots myself.
  - Viewer, desktop light and dark (from my e2e run):
    - `/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/e2e-evidence/HEL-1661/viewer-desktop-light.png`
    - `/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/e2e-evidence/HEL-1661/viewer-desktop-dark.png`

    There is no Dry run or Run pipeline. "View only" (Eye icon, mono xs, muted) sits beside the name as a meta fact, with no pill. The schedule chip and ⋮ are right-aligned and nothing is left orphaned. Light and dark match.
  - Viewer, phone light and dark:
    - `/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/e2e-evidence/HEL-1661/viewer-phone-light.png`
    - `/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/e2e-evidence/HEL-1661/viewer-phone-dark.png`

    There is no pill bar and no empty reserved strip above the glass nav, and "View only" appears under the title. This matches HEL-1782's recipe (`DashboardMetaRow.css` view-only uses the same tokens).
  - Viewer, phone dark, invalid pipeline P2: `/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/.concertino/scratch/HEL-1661/sk/viewer-phone-dark-invalid.png`. The genuine step-problem banner still shows, which is correct. The unknown-type banner does not show.
  - Viewer, phone dark, Output sheet: `/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/.concertino/scratch/HEL-1661/sk/viewer-phone-dark-sheet.png`. A DOM probe found no button matching /run/ except the "Runs" tab.
  - Viewer, phone dark, Runs tab: `/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/.concertino/scratch/HEL-1661/sk/viewer-phone-dark-runs.png`. It shows the viewer empty copy.
  - Console: the only error was a 404 on `/schedule` for a pipeline with no schedule. That is pre-existing and not caused by this change.
- **Q2 follow-up.** HEL-1794 exists: Backlog, label Follow-up, relatedTo HEL-1661.
- **Residue and teardown.** I deleted my 4 seeded users from `helio_hel1661` with `buildUserDeleteSql`, by exact id and email. A count of `hel1661-%` users now returns 0. I stopped the servers with `stop-servers.sh` (`STOPPED ports=7093,10000`).
- **Evidence integrity.** No verdict above depends on mtime ordering. My e2e screenshots are fresh from this session's run (12:35–12:36), and the log is persisted.

### Verdict: CONFIRM

Every AC traces to code plus a fresh passing test or probe:
- a viewer has no actionable Run, Dry run, Save & run, Run now or Output-sheet Run, on desktop and phone, in both themes;
- an editor or viewer sees no unknown-type banner and no spurious step banner on a valid shared pipeline;
- a red-first e2e covers each case.

Each driver constraint and owner ruling Q1–Q3 is met, and on `helio_app_test`, as shown above.

### Non-blocking notes

- The Runs empty state for a viewer reads title "No runs recorded yet" over description "No runs yet.", which says the same thing twice. HEL-1794 could drop the description or use something like "Runs appear here when an editor or the owner runs this pipeline."
- `.spine-header__run-slot` uses literal `min-width: 10.7rem` / `5.4rem`, measured from the button widths. These are not tokens. That is acceptable for a reserved slot, but it will drift if the button padding or type tokens change.
- The phone "View only" sits on its own line above the schedule chip when there is no run status. It reads fine, but it adds a line compared with the owner's header.
- `analyzeConcise` and the trigger's write-path `Denied.reasons` raw detail are named in the design as follow-up candidates. Make sure the PR body names them, along with the editor `autoRunnable`/`canRun` behaviour change.
