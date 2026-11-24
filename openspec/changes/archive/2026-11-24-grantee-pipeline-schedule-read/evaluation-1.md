## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 31c192103f0a9bc082e1f3c1940ac747e8b55fd0 (base d4e59f00629852df6debf9cc988c0c8a183483a4, resolved live).

### Phase 1: Spec Review — PASS
Issues: none blocking.
- Owner ruling "read all, owner writes" is implemented as ruled. `PipelineScheduleService.find` authorizes with
  `findByIdShared` and reads through the new `findByPipelineIdInternal`. `put`/`delete` stay on `findByIdOwned`, so a
  grantee gets `404`, the same answer the pipeline rename and delete routes give.
- Each driver-derived AC has a test. The route spec covers per role: owner GET/PUT/DELETE; editor and viewer GET 200
  with a body equal to the owner's and no owner/grantee key or owner id; PUT/DELETE 404 with the schedule unchanged;
  PUT on an unscheduled pipeline creates nothing; stranger 404 on all three; unknown id 404. The UI tests cover the
  read-only chip, owner unchanged, and fail-closed while ownership is unknown, on desktop and phone. The new e2e
  covers editor and viewer on desktop and phone in both themes. CLAUDE.md and the schema description are updated.
- The helio-mcp schedule tool descriptions (`helio-mcp/src/tools/scheduleTools.ts:43-68`) claim no grantee access
  and no owner-only read, so they are consistent and need no change.
- Task 3.0 is deferred to archive time, as accepted.
- The red evidence in `red-run.txt` is believable. Only the GET tests went red, as expected: PUT/DELETE were already
  404 for a grantee. I checked M1-M3 by reading the code, not by running them. For M2, the service grantee test would
  get `None` from the owner-JOIN read. For M3, the grantee tests check `tagName !== BUTTON` with `canEdit` true for an
  editor.
- `workflow-state.md` CONSTRAINTS is empty. The lane constraints are honoured in the diff: no sibling-lane files are
  touched.

### Phase 2: Code Review — FAIL
Gates (my own fresh runs, in WORKTREE_PATH, lane DB helio_hel1837):
- `npm run lint`: exit 0. `npm run format:check`: exit 0 ("All matched files use Prettier code style!").
- `npm test` (3 workers): exit 0. Root: 76 suites / 683 tests passed. Frontend: 941 suites / 10910 tests passed.
- `npm --prefix frontend run build`: exit 0.
- `sbt -J-Xmx3g testFull`, the WHOLE suite as 10 shards (HELIO_TEST_SHARD_COUNT=10, index 0-9): every shard exit 0,
  0 failures, 789 suites in total. The canceled tests are the existing report-only measurement tests (heap and
  p50/p95). The HEL-1837 tests ran in shards 7 and 9 and passed. Note: the executor's own `be-shard.txt` holds only
  one shard (89 suites), so the executor's run alone was not full-suite evidence. Mine is.
- e2e `hel1837-grantee-schedule-chip.spec.ts` + `hel1794-viewer-read-only.spec.ts` (2 workers, DEV_PORT 7269): 6 passed.

Issues:
1. **The read-only chip still looks like a control.** `SpineScheduleChip` gives the read-only `<span>` the same
   `spine-header__chip` class as the button (`frontend/src/features/pipelines/ui/spine/SpineScheduleChip.tsx:56-62`).
   That class carries `cursor: pointer`
   (`frontend/src/features/pipelines/ui/spine/PipelineSpineHeader.css:205`) and a hover wash: border-strong,
   surface-raised and text colour (`PipelineSpineHeader.css:209-213`). On phone it also has a hover background
   (`frontend/src/features/pipelines/ui/mobile/PipelineMobile.css:164-166`) and the 44px tap-target `::after`
   overlay meant for controls (`PipelineMobile.css:522-531`). So a grantee who hovers the read-only chip sees a
   pointer and a hover highlight, then clicks and nothing happens. design.md D4 requires a chip that "reads as state,
   not as an action". None of the jest or e2e tests can catch this, because all of them check only `tagName`.
   These selectors match a `span` with the class, so the outcome is certain from the code. I did not probe it live
   (see Phase 3).

Otherwise clean:
- DRY: the read-only variant shares `content`, `title` and the class with the button.
- Types: no escape hatches.
- Security: a privileged read is done only after `findByIdShared` on the same id, documented like
  `findByIdInternal`. The stranger and unknown-id 404s are pinned.
- No dead code. The old `findByPipelineId` is still used by `put` and the scheduler specs.

### Phase 3: UI Review — PASS (with gaps noted)
- Happy path, owner and grantees, desktop 1280 and phone 390, light and dark: verified by my own e2e run (6 passed).
  The editor sees `Every… no next run yet` in the desktop header, and the viewer sees `Every 15m no next run yet` next
  to "View only" on phone. Screenshots: `/home/matt/Development/helio/.concertino/runs/HEL-1837/evidence/e2e-evidence/HEL-1837/editor-desktop-light-chip.png`,
  `/home/matt/Development/helio/.concertino/runs/HEL-1837/evidence/e2e-evidence/HEL-1837/viewer-phone-dark-chip.png`.
- Grantee on a pipeline with no schedule sees no chip and no "Add schedule": checked by the e2e.
- Unhappy path: the schedule GET 404 for a grantee with no schedule renders nothing, with no error state. That is
  correct, and the client already treated a 404 as "no schedule".
- Accessibility: the read-only chip is a non-focusable span whose visible text is its name, and has no `aria-label`
  on a generic element. That is correct. The hover and cursor problem is Phase 2 issue 1.
- Gaps: I did not independently resize to 1100 or 768, and I did not capture a console log in my own session,
  because a grantee session needs the e2e fixtures. The e2e passed at 1280 and 390, and the change reuses the
  existing HEL-1579 narrow-width chip classes. Re-check 1100 and 768 in the next cycle together with CR 1.

### Overall: FAIL

### Change Requests
1. Stop the read-only chip from looking like a control. In
   `frontend/src/features/pipelines/ui/spine/SpineScheduleChip.tsx:56-62`, add a modifier class to the read-only
   `<span>` (for example `spine-header__chip--static`). In `PipelineSpineHeader.css`, give that modifier
   `cursor: default`. Exclude it from the hover rule, either with
   `.spine-header__chip:not(.spine-header__chip--static):hover` at line 209 or with an override that keeps the base
   colours. Do the same for the phone hover rule (`PipelineMobile.css:164`) and the tap-target `::after` overlay
   (`PipelineMobile.css:522-531`), so the span gets no 44px hit area. Use tokens only. Add a jest test asserting
   that the read-only chip carries the modifier class and the button does not. Optionally add an e2e assertion that
   the grantee chip's computed `cursor` is not `pointer`.

### Non-blocking Suggestions
- `PipelineScheduleRoutesSpec.scala`: in the per-role loop, "GET on a shared pipeline with no schedule" always grants
  `"viewer"`, and "PUT creates nothing" always grants `"editor"`, whatever `$label` says. So "editor GET ... no
  schedule" actually tests a viewer grant. Pass `label` as the role so each test name matches its grant.
- `SpineScheduleChip.test.tsx`: the test named "the default (owner) chip" passes `readOnly={false}`, but the
  default is `readOnly=true` (fail-closed). Rename it to "the owner chip (readOnly={false})".
