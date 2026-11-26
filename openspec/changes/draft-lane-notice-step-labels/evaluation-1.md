## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `cfc6312aaa6cc0fcc691c13730cc1e610c958cba` (branch `bug/draft-lane-notice-labels/HEL-1542`).
Diff base: `014317f538d3ec10f0394407f2c36d7e8e4fb7d4`, resolved live with `resolve-review-base.sh`.
The scope is the restated scope in `ticket.md` (owner ruling HEL-1542-1795647439065-9d63cb). Standing Constraint [C1] is
in force. Every gate below is my own fresh run; none is taken from the executor's transcripts.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- **1b (labels in the refusal notice).** Done.
  - Server: `DraftPlan.draftKeys` and `draftKeyOf` are added (`DraftDiff.scala:52-58`, built at `:127`). `laneGate`
    maps both of its ids (`DraftSaveTransaction.scala:236-240`). `requireLaneTargetsExist` names its subject by draft
    key (`DraftDiff.scala:312-318`).
  - Client: the new `knownNames`, `idMatcher` and `labelIdsIn` resolve ids against draft steps first, then saved
    steps, then created Outputs. The subject is the earliest occurrence in the message, matched longest-first and
    delimited, and unknown ids are left verbatim (`draftSaveRequest.ts:48-109, 220-226`). This matches D1 and D2.
- **Item 2 (hel908-tail-attach).** All four tests are rewritten on the spine and hel1684 helpers. The quarantine entry
  and its HEL-951/HEL-962 comment are removed from `playwright.config.ts`. My run of the spec by explicit path
  executed all 4 tests, so `testIgnore` no longer filters it out.
- **Item 3 (wording).** Exactly the three HEL-1515 comments change "dependent" to "descendant"
  (`useStepCardState.characterization.fixtures.ts:517/526/535`). That is 3 changed lines; there is no sweep and no
  archive edits.
- **Dropped items and HEL-1145.** No 1a/1c code and no `hel908-full-flow.spec.ts` edit, which is correct.
- **Other ACs.**
  - There is no migration.
  - No HEL-1882 file is touched (OutputRepository, insight refresh), and no HEL-1013 file is touched (REST
    connector, REST source schema, helio-mcp).
  - `openspec validate` reports the change as valid.
  - Every item in tasks.md is ticked and matches the diff.
- **Test 2's rule.** "Follows its true owner" now asserts that the tail re-homes onto the appended step (Rename). I
  checked this against main's original test 2 (`git show 014317f53:e2e/hel908-tail-attach.spec.ts`, L118-196): its
  intent was the same reparent onto the new trunk step. The meaning is preserved, not reinterpreted.
- **[C1] honored.**
  - Each of the four tests asserts the full tree with `tree(page)` in the draft before Save & run (test 1: L95/L103;
    test 2: L121; test 3: L141; test 4: L160).
  - Each test asserts it again after Save & run plus `page.reload()` (L106, L124, L144, L164).
  - `reloaded()` also asserts that no draft banner is present, so the second assertion reads the server tree, not a
    replayed draft.

### Phase 2: Code Review — PASS
Gates, run fresh in `WORKTREE_PATH` (CLEAN_WORKTREE not set). `npm ci` ran first. Transcripts are in
`/home/matt/Development/helio/.concertino/scratch/HEL-1542/eval/`.

- **Frontend checks:**
  - `npm run lint`: exit 0, zero warnings.
  - `npm run format:check`: clean.
  - `npm run typecheck`: exit 0.
  - `npm --prefix frontend run build`: exit 0.
- **Jest, touched files** (`draftSaveRequest|PipelineDraftNotices|useStepCardState`, 3 workers): 5 suites, 174/174
  passed. I did not run the full frontend jest suite; the driver brief scoped this to the touched files.
- **Backend shard** (`sbt -J-Xmx3g testOnly` on DraftSaveLaneRefusalSpec, DraftDiffSpec, DraftSaveApiSpec,
  DraftSaveUndoSpec and LaneCycleViolationsSpec, with the lane DB exported): 86/86 passed, including all 3
  DraftSaveLaneRefusalSpec cases. `npm run check:scala-quality` is clean, with soft warnings only.
- **e2e:** `npm run e2e -- e2e/hel908-tail-attach.spec.ts --workers=2 --project=dev` ran against my own lane servers
  (6974/9881, lane DB `helio_hel1542`) and passed 4/4 in 33.4s. The 4 throwaway users were deleted by exact id.
  - The test line numbers in my run are 87/111/130/145. The executor's transcripts show 88/112/131/146.
  - This confirms that the committed, lint-edited file is the one that passed.
- **Red-first check.**
  - `81761ec9a` touches only tests and red evidence; `git diff 014317f53 81761ec9a -- frontend/src backend/src/main`
    shows no production code.
  - It is the parent of the fix commit `d82c27f06`.
  - In a throwaway detached worktree at `81761ec9a` (since removed), I ran jest against main's code: 7 failed and 18
    passed. Every new HEL-1542 case failed, including (a)(b), (d) and the render test.
  - Between the red and fix commits, the test changes are Prettier-only (2 hunks), so no assertion was weakened.
  - Backend red: I did not re-run it. The reasoning holds, though: on main, `requireLaneTargetsExist` and `laneGate`
    interpolate `w.id`/`v.stepId`, which are the `newId()`-minted ids for a created step. The recorded red
    (`backend-red.txt`) matches that, with 2 red tests and the existing-step guard green.
- **Mutations, reproduced by me in the same throwaway copy:**
  - Green baseline: 25/25.
  - M3, the saved-steps lookup dropped: only (d) goes red, which is exactly the branch claimed.
  - M1, the subject picked by array order: (a)(b), (c) and the render test go red, which is the subject-selection
    branch.
  - The backend M1 and M2 records each turn exactly the one case that exercises the mutated message red. Each
    mutation exercises the branch it claims.
- **Is the e2e vacuous? No.** `tree()` returns indented titles, and each test asserts exact array equality.
  - Test 1 would fail if the tail were promoted to the trunk (no indent). It would also fail if the second tail
    replaced the first, or if "Branch from here" were disabled after the first tail.
  - Test 2 would fail if the tail stayed under Compute.
  - Test 3 would fail if the tail stayed on the original Filter (`[FILTER, "  LIMIT", FILTER, ...]` is not equal to
    the expected tree).
  - Test 4 would fail if the tail were promoted, and it also asserts that no Limit row exists.
  - The `.spine-lane--sub` depth is proven live, because indented entries are expected and match.
- **Code quality.** There are no `any` types, no FQNs, no TODOs and no dead imports. Regex construction escapes ids.
  Labels are inserted as React text, so there is no XSS path. Error handling is unchanged.

### Phase 3: UI Review — PASS
I reached the dangling-target refusal through the real UI on port 6974:
1. Seeded a pipeline Filter -> Sort -> Union, with a Rename tail off Filter and the Union's lane pointing at the Rename
   tail.
2. In a draft, selected the Rename row and clicked Remove step.
3. Clicked Save & run.

The server returned `400` and the alert read:
`Couldn't save step "Union / append rows": Step "Union / append rows" has a lane reference to "Rename column", which is not a step of the draft Your draft is still here.`

- No UUID appears in the alert. The prefix names the subject, not the target. The removed target shows its saved
  label. The draft is kept.
- **Light theme:** the alert renders in the danger-tint tokens. Evidence:
  `/home/matt/Development/helio/.concertino/runs/HEL-1542/evidence/.concertino/scratch/HEL-1542/eval/eval-notice-light.png`.
- **Dark theme:** I set it through the app's real theme load (localStorage, then reload, so the inline accent vars
  are the dark set), and repeated the same refusal. Text is `rgb(242,239,233)` on the tinted dark surface and
  readable. Evidence:
  `/home/matt/Development/helio/.concertino/runs/HEL-1542/evidence/.concertino/scratch/HEL-1542/eval/eval-notice-dark.png`.
- **Breakpoints:** at 768 and 375 the alert is 744px and 351px wide, inside the viewport, with no horizontal overflow
  and no clipped content.
- **Console:** the only errors are browser network logs: the expected `400` on `/draft/save`, and a pre-existing
  `404` on `GET .../schedule` for a pipeline with no schedule (unrelated). There are no unhandled exceptions.
- **Accessibility:** the notice is `role="alert"`, with a "Dismiss" button that has an accessible name.

**Trailing-period observation (asked to judge): this is a follow-up, not a defect in this ticket's scope.**
- `PipelineDraftNotices.tsx:47` renders `{notice.message} Your draft is still here.` with no terminal-punctuation
  handling.
- Nearly every draft-save 400 in `DraftDiff.scala` has no trailing period: lines 145-432, about 30 messages, such as
  "...is not in the draft (a removed step cannot have children)" and "...a new root needs a sourceId". The `laneGate`
  message is the exception that ends in ".".
- So the run-on sentence is a property of every draft-save refusal notice since HEL-1631, not of this change.
- The restated scope (labels instead of ids, and the right subject in the prefix) does not cover copy punctuation.
  Fixing only this one server string would leave the other ~30 just as broken, and it would make the convention less
  uniform.
- The right fix is one client-side change in `PipelineDraftNotices.tsx`: end the message with a period when it lacks
  terminal punctuation, with a render test. That belongs in a follow-up ticket.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- **Follow-up ticket (recommended):** add terminal-punctuation handling for `notice.message` in
  `PipelineDraftNotices.tsx`, covering every draft-save refusal, as described above.
- `labelIdsIn` is exported from `draftSaveRequest.ts` (L91) but no other file imports it. Make it module-private, or
  test it directly.
- `DraftDiff.scala` was already over the ~400-line threshold (435 lines on main) and is now 443. Per CONTRIBUTING's
  file-size rule, propose a split in the PR description; the plan's "Spin-off candidate" note could cover it.
- In `labelIdsIn`, the `_all` parameter is used (returned for unknown ids), so the underscore prefix is misleading.
  Rename it to `match`.
- Environment note: the Playwright MCP writes `.playwright-mcp/` snapshot and console logs into the main checkout
  root. They are gitignored (`git status` is clean), but they are residue of the shared browser.
