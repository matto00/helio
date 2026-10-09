## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD e688340ffa4649191e8b744c4667772db1db77ab. The base was resolved live with `resolve-review-base.sh` (exit 0) as 0a52831600a33690b3f45dbee4fa78a4a8d92838. The spawn-cwd guard returned READY.
I re-ran every check below myself. I used scratch exports (`git archive`) under the session scratchpad and never modified the worktree. jest ran with `--maxWorkers=3` under `nice -n 19`.

### What I verified (with evidence)

- **AC4 / C2: the guard comment is now true, reproduced on the whole pre-fix tree.**
  - Setup: I exported the full `6f2351e8^` (99d6fedd) frontend tree. I added only the HEL-1389 test file from 6f2351e8, because the test file did not exist before the fix. Every source file was pre-fix.
  - Result: running `-t "keeps an aggregated"` twice gave **1 failed** both times. The diff was `- "value": "a"`, meaning `fieldMapping.value` was dropped.
  - On a HEAD export, deleting the D4a metric pairing block in `buildConfigPatch` (configPatch.ts) made exactly 2 of the 22 tests fail, and this guard was one of them. The second clause of the comment holds.
  - The comment at `OutputEditorSheet.configPatch.test.tsx:242-244` states both facts and the measurement method. The executor's `cycle2-guard-on-whole-prefix-tree.txt` (20 failed / 2 passed) agrees.
- **Residue of the retracted "premise false" claim.** I grepped `frontend/src` and the change dir for `premise.*false`, `passes on the pre-fix`, `7 of`, and `7/22`. The code, test comments, tasks.md, proposal.md, design.md, the spec delta and files-modified.md are all clean. tasks.md 1.3 carries an explicit CORRECTION. The only remaining occurrence is the historical gate record `evaluation-1.md:128` (see notes).
- **AC1.**
  - `OutputEditorSheet.tsx` is 374 lines. The new units are useOutputKindState 185, OutputKindConfigCard 177, OutputSheetPreviewCard 91, OutputEditorFooter 70, useOutputSavedStatus 59 and OutputPlacementsList 24.
  - `useOutputKindState` seeds every per-kind `useState` from `openingParams`. The sheet no longer contains any `read*Config` per-kind seeding: the grep shows only top-level `useState`s.
  - `staticBound` uses the same `defaultBoundOrLiteralMode` that the base used.
  - Table columns still come from `useOutputTableColumns(capabilityKeys, readTableConfig(config).columnOrder)`, the same inputs as on base.
  - configPatch.ts now carries a note that `openingParams` must not branch on `kind`.
- **Byte-move.** `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change` reports 325 of 655 added lines as moved. I read every non-moved changed line outside the new hook. They are only:
  - the new prop interfaces and component signatures
  - the `buildConfig()` call inlined as `buildOutputConfig(kindState.params(kind))`
  - `canAddAsTailWithAggregate` / `buildAggregateTailConfigs` now receiving the full `params(kind)` (a superset of their `Pick<>`)
  - handler props
  - Prettier rewraps of two JSX text runs

  The multiset of `className` expressions in the base sheet is identical to that of the sheet plus the extracted components (`diff` was empty). The diff contains no CSS/SCSS changes and no inline `style=` additions.
- **AC2.** Only one existing test file changed: the configPatch test, a comment-only edit (5 lines). `kindLock.test.tsx` is untouched.
  - Fresh run of `jest --ci src/features/pipelines`: 98/98 suites, 1338/1338 tests and 18/18 snapshots passed.
  - `tsc --noEmit` exit 0, `eslint --max-warnings=0 src/features/pipelines/ui` exit 0, `prettier --check` exit 0.
- **AC3 / C1: characterization.**
  - Commit 3c655b0bd adds only the test and its `.snap`. Neither file is touched again in `base..HEAD`.
  - On a 3c655b0bd export the test passes 19/19 tests and 18/18 snapshots, so it is green on the base.
  - Mutations inside `openingParams` on a HEAD export each turn it red:
    - `metricFormat` default changed to `"integer"`: 2 tests failed
    - `chartFieldMapping: {}`: 1 failed, which is the touched-chart-fieldMapping wire case
    - `yField: ""`: 1 failed
  - All exports were restored afterwards (`diff -r` of the export against worktree `src` was identical).
- **AC3, running editor.** I compared the evaluator's base and branch dumps myself with `json.tool` and `diff`, which is content-based and does not depend on mtimes.
  - `eval-c1-edit-{base,branch}-{light,dark}.json` and `create-*-light` differ only in `origin`.
  - The normalized dumps contain populated preview tables on both sides.
  - The raw `eval-c1-dom-edit-*` and `eval-c1-html-*` hashes do differ. Content inspection shows the reason: base shows "No preview rows yet." where branch shows rows. That matches the base preview CORS failure the evaluator disclosed and fixed before capturing the normalized dumps. It is not a product difference.
  - I viewed the edit-markdown-light pair (base and branch) and create-markdown-dark: they are visually identical, with tokens and layout unchanged.
- **AC5.** `PipelineDetailPage.tsx:337` reads `key={outputSheet.output?.id ?? \`create:${outputSheet.createTargetStepId ?? ""}\`}`.
  - I swapped in the base (unkeyed) `PipelineDetailPage.tsx` on a HEAD export and ran `PipelineDetailPage.outputSwap.test.tsx`: **red** (`Expected "Pie" / Received "Bar"`). It is green at HEAD.
  - The spec delta covers both the reseed scenario and the untouched-Save-after-swap scenario.
- **UI design judgment.** Nothing visual is intended to change, and the DOM, computed styles and class names are identical. Nothing new needs judging against DESIGN.md.
  - I did not drive the shared Playwright browser. The evaluator documented the cross-lane cookie hazard, and with zero markup or CSS delta the self-authenticating DOM and className diffs above carry this check.
  - The A->B swap replaying the 280ms modal entrance animation is acceptable: it is a rare deep-link path, and a fresh entrance for a different Output is reasonable.

### Verdict: CONFIRM

### Non-blocking notes

- `evaluation-1.md:128` still recommends "PR body: record that the ticket item-2 premise was false". That is a historical gate record, so leave it unedited. The orchestrator must **not** carry that suggestion into the PR body: the verified truth is that the guard is red on 6f2351e8^.
- `design.md` Decision 6 still describes the superseded single-file method ("run the guard test against the pre-fix sheet ... temporarily in the worktree"). Standing Constraint C2 and tasks.md 1.3 supersede it. A one-line pointer there would stop the archived design from teaching the wrong method.
- `useOutputSavedStatus.ts` carries two `react-hooks/set-state-in-effect` disables. Both are justified: the effect bodies are verbatim moves, and there is repo precedent for the disable.
