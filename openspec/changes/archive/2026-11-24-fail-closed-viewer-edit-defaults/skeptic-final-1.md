## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `ad6e0c2a98e17661d3887ad1d2b069882c6a1af4` against the live-resolved base `b2da43a3d02ba1b84eb8296b9bd9ed742623a353`
(`resolve-review-base.sh`, exit 0). The spawn-cwd guard printed `READY`.

Every mutation probe ran in a throwaway detached worktree at the same SHA
(`.concertino/scratch/HEL-1839/skeptic-final/mut`), which I removed afterwards. The lane worktree was never edited; its
only untracked file is the evaluator's `evaluation-2.md`. The jest mutation transcript is in
`/home/matt/Development/helio/.concertino/scratch/HEL-1839/skeptic-final/mutations.txt`.

### What I verified (with evidence)

**AC1: omitting the prop yields no edit control, and a test fails if the default flips back.**
- I re-derived the defaults with my own grep over all non-test code in `frontend/src`, using a wider pattern than the
  executor's (`canEdit|canRun|editable|isOwner|canWrite|canManage|isEditor|editMode = true`,
  `readOnly|viewOnly|disabled|isViewer = false`).
  - Inside `features/pipelines`, no fail-open default remains.
  - Outside it, three remain:
    - generic `disabled = false` on shared primitives;
    - `app/dashboardMeta/DashboardMetaFacts.tsx:41 viewOnly = false` (dashboard, not the pipeline page);
    - `features/panels/ui/detailModal/usePanelDetailEditState.ts:20 canEdit = true`, a declared non-goal.
- I also grepped `features/pipelines` for other optional role-like props (`editable?`, `isViewer?`, `viewOnly?`,
  `role?` and similar). There are none. `isPipelineOwner?` already defaults to `false`.
- The diff shows 13 defaults flipped (PipelineSpine, PipelineSpineHeader, useSpineStepActions, SpineStatusStrip,
  RunHistoryList, StepCardFocused x2, SpineOutputs, SpineSourceCard, OutputEditorSheet, OutputEditorFooter,
  OutputSheetPreviewCard, OutputHistoryModal). `usePipelineDraftSave`'s `runRole` is now required.
- Production callers: I enumerated every `<Component` and hook call site outside tests. Each passes the role
  explicitly, derived from page state:
  - `page.canEdit`, `!page.canEdit`, `canRunFromUi(page.runRole)` or `page.isOwner`;
  - internal forwarding: `PipelineSpine` passes `readOnly={!canEdit}`, `OutputEditorSheet` passes `readOnly={readOnly}`,
    and `RunHistoryModal` passes `canRun`;
  - both `useSpineStepActions` callers pass `canEdit: page.canEdit`.

  So no owner or editor loses a control. The e2e editor half confirms this live (below).
- My own mutation probes. I flipped each of the 13 defaults back one at a time and ran
  `ui/failClosedRoleDefaults.test.tsx`. Every mutation turned it red: 1 failure each, and 2 for `RunHistoryList`'s
  `canRun`, which reaches both the List and Modal tests.
- I named the failing test for three mutations, picking the cases most at risk of being vacuous. Each failure was the
  component's own test:
  - `PipelineSpine` canEdit;
  - `OutputSheetPreviewCard` readOnly (copy only);
  - `StepCardFocused` isOwner. That test passes `readOnly={false}`, so only `isOwner` decides the result.
- Guard (`failClosedRoleGuard.test.ts`, labelled as a guard):
  - Making `runRole` optional again turned it red ("optional `runRole` has no fail-closed default").
  - A planted new `ui/ZProbe.tsx` with an undefaulted optional `canEdit` also turned it red.
- Green runs:
  - jest on `src/features/pipelines` and `src/test`: 252 suites and 3447 tests passed.
  - `npm --prefix frontend run typecheck`: exit 0.
  - eslint `--max-warnings=0` on the three new or changed test and spec files: exit 0.
  - I relied on the evaluator's pasted output for the full suite (frontend 937 suites, root 76 suites).

**AC2: the e2e scan covers links and `<summary>`, proven by mutation.**
- `scanInPage()` now skips only elements matching `:disabled`, where it previously skipped by `fieldset[disabled]`
  ancestry, and `summary` was added to `SELECTOR`. The self-test runs the same function source
  (`scanInPage.toString()`), with plant and scan inside a single `evaluate`.
  - It asserts that the viewer's step fieldset really is a disabled `HTMLFieldSetElement`.
  - It plants a link, a summary and an input. The link and the summary must be reported; the input, which the browser
    disables, must not be.
- Fresh runs against my own servers (started with `start-servers.sh`, lane DB, empty `ANTHROPIC_API_KEY`):
  - The full spec file, 2 workers: 4/4 passed (viewer desktop, viewer phone, self-test, editor keeps every control).
  - Mutation (a), the old `.disabled || closest("fieldset[disabled]")` skip restored: the self-test went red
    ("Expected planted-link", received the list without it).
  - Mutation (d), my own, `"Functions and operators"` removed from `ALLOWED`: the real viewer-desktop test went red
    with `summary "Functions and operators"` outside the allow-list. This proves the wider scan reaches real
    `<summary>` elements in the live viewer flow, not just planted ones.
  - Mutation (b), `summary` dropped from `SELECTOR`, is recorded in `evidence/3.4-e2e-scan-mutations.txt`. I did not
    re-run it; (a) plus (d) already exercise the same code path.
- Classification of the two new `ALLOWED` entries. Both are pure `<details>/<summary>` disclosures that write nothing:
  - "Functions and operators" (`stepConfigs/ComputeFunctionReference.tsx:28`, a reference list);
  - "Ask about this Output" (`OutputEditorSheet.tsx:445`, which wraps the existing AskPanel).

  Navigational links are still told apart by exact name ("Pipelines", "Request Beta access…"). No product call was
  needed.

**AC3: the comment matches the test.** The new header in `viewerCopy.test.ts` matches the code:
- the first test pins one entry's viewer and editor strings;
- the second loops over every entry, asserting `viewer !== edit` and `not.toMatch(/\b(add|edit|run the)\b/i)`;
- the stated regex limit ("add", "edit", "run the") is exactly the regex in the code.

**Iron laws.**
- Red-first: `b9b45f9e1` commits the red runs (`evidence/3.1-jest-red.txt`, `3.3-e2e-selftest-red.txt`) before the
  implementation commit `a4b1fcca5`.
- Not a bug fix, so no root-cause probe is required.
- The extra contrast-settle wait in `valueContrast` (`ad6e0c2a9`) only waits for finite animations to finish. The 4.5
  bar is unchanged.
- No evidence here rests on mtime ordering.

**UI and design judgment.** No rendered UI changed. Every production caller passes the role explicitly, so the flipped
defaults are unreachable on the real page, and the diff touches no stylesheet or JSX structure. I took no screenshots;
there is no visual delta to judge. The live e2e viewer and editor runs above are the behavioral check.

### Verdict: CONFIRM

### Non-blocking notes
- Follow-up candidates, both outside this ticket's pipeline-page scope:
  - `features/panels/ui/detailModal/usePanelDetailEditState.ts:20 canEdit = true` (already named as a non-goal);
  - `app/dashboardMeta/DashboardMetaFacts.tsx:41 viewOnly = false`, the same fail-open pattern on the dashboard
    surface.
- The scan does not expand the two allow-listed disclosures, so their contents (AskPanel, for example) are not scanned
  in the viewer flow. The ALLOWED comment says so honestly. Expanding them in a later pass would close that gap.
- The spec is now about 480 lines, past CONTRIBUTING's ~400-line mark; mention a split in the PR.
