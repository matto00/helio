## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `eebf3ddc6aa14a839c4bb46de1487381d59f2372`: the cycle-3 commit on top of 4b9d37b5c. Base:
`1f8e762b5b0055a2c1c76eddd47771eeca8823db` (resolve-review-base.sh). This is a delta review. The AC1/AC2/AC3 findings from
evaluation-2.md stand, and the cycle-3 source change does not touch any measured path. Render counts are unchanged at 29 per
later keystroke: the executor states this, and it is consistent with a comparator refactor plus a cache prune.

### Phase 1: Spec Review — PASS

- **Cycle 2 CR1 (guard every comparator against wrongly reporting "equal"): addressed.** There are three new test files:
  - `spine/SpineStepRow.memoComparators.test.tsx`
  - `spine/SpineOutputs.memoComparators.test.tsx`
  - `ui/PipelineDetailDialogs.memo.test.tsx`

  Seven `mutation-cmp-*.txt` files now begin with `EDIT:` lines. I re-ran the mutations myself (Phase 2) instead of relying on
  these files.
- profile-findings.md has a cycle-3 section that records the audit. It records the one real semantic gap that was closed:
  `opType.label` and `renderKey` were not compared before.
- AC1, AC2 and AC3 remain met, as established in evaluation-2.md.
- The owner ruling `proceed-without-claim-2` is still honoured: there is no load-time saved walk.
- Constraints C1-C5 are honoured. The existing synchronous scroll-edge tests are unedited across the whole branch.

### Phase 2: Code Review — PASS

Gates, run by me at eebf3ddc6 (with `nice -n 19` and 3 jest workers):
- `npm run lint`: clean.
- `npm run format:check`: clean.
- `npm run typecheck`: exit 0.
- `npm test`: root 71 suites / 621 tests passed; frontend 910 suites / 10,521 tests passed.
- `npm --prefix frontend run build`: exit 0.

**My own mutations, re-run** in a throwaway detached worktree at eebf3ddc6, since removed. The clean baseline over the
`features/pipelines` scope was 235 suites / 3,323 tests passing. Each mutation below makes the component report "equal" when it
should not:

| mutation | red test |
| --- | --- |
| `selected: () => true` | SpineStepRow comparator › selected |
| `sameDraft` ignores `status` | SpineStepRow comparator › draft status |
| `sameDraft` ignores `count` | SpineStepRow comparator › draft count |
| `sameMenu` always equal (`true \|\|`) | › menu: a changed disabled flag, reason and label reach the opened menu |
| `sameMenu` ignores only `disabled` | same test |
| `samePageForDialogs` drops the open-sheet `steps` check | PipelineDetailDialogs comparator › an open Output sheet receives the new steps |
| `samePageForDialogs` drops the `hasDraft` check | › hasDraft flipping switches the open sheet's mode |
| `SpineOutputs` ignores subtitles | › source line: relabelling the step an Output reads from updates its 'from ...' text |
| `editedOutputIds: () => true` | SpineOutputs comparator › edited ids |
| `outputs: () => true` | › name and kind and panel count |
| `sameStep` ignores `label` | SpineStepRow comparator › step label |
| `sameStep` ignores `enabled` | › step enabled |
| `rowCount: () => true` | › rowCount |
| `hasValidationError: () => true` | › hasValidationError |

All 14 are red: the 6 from cycle 2 plus 8 more I added. The tests assert the DOM, not render counts, so they check what the user
sees.

**Typed exhaustiveness, verified.** I added a probe prop `extraProbe?: string` to `SpineStepRowProps` and to
`SpineOutputsProps`. `tsc` failed with TS2741 at `SpineStepRow.tsx:312` (`ROW_COMPARERS`) and at `SpineOutputs.tsx:149`
(`OUTPUTS_COMPARERS`). A prop added later cannot be ignored silently.

**Code review of the cycle-3 delta:**
- `ROW_COMPARERS` and `OUTPUTS_COMPARERS` behave the same as the cycle-2 comparators, plus the two new `sameStep` fields.
- `steps: () => true` and `laneGraph: () => true` in `OUTPUTS_COMPARERS` are correct. Those two props are compared through
  `subtitlesOf` afterwards, and the comment says so.
- The `SpineLane` wrapper prune runs during render. It mutates a cache, not state. A render that is later discarded can only drop
  wrappers, and dropped wrappers are rebuilt lazily. A row that still holds a dropped wrapper keeps working: the wrapper looks up
  the latest row data through `latest()`, not through the map.

Live check, on a 3-step pipeline:
- Editing step 1 updated both downstream rows ("10 → 6").
- Three "Move up" moves in a row, each through a skipped row's menu, after the prune, all moved the correct step every time.
- No console errors from the app; the only one is the existing schedule 404.

### Phase 3: UI Review — PASS

- I started the servers with start-servers.sh on 7241/10148 (lane DB `helio_hel1809`, empty `ANTHROPIC_API_KEY`), and the
  assert-phase check passed.
- e2e at 1x, 2 workers: `hel1683-regex-main-thread`, `hel1631-draft-mode`, `hel1685-draft-polish`,
  `hel1733-draft-outputs-shapes-{desktop,drafts,phone}`, `hel1734-draft-roots`: **60 passed** (3.9 min).
- The live flows are listed under Phase 2. The draft preview results and the session-epoch suites are unchanged; the session-epoch
  suites pass in the jest run.
- My test user was deleted by exact id. The servers were stopped with stop-servers.sh and the ports are free.

### Overall: PASS

### Non-blocking Suggestions

- None blocking. The `{false}`-slot, wrapper-pruning and exhaustiveness suggestions from earlier cycles are all done.
