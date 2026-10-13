## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `1730daa1f3aebdf6807681f19c838dc22ce6a875` against the live-resolved base `f63ab8365d2b0e6cac36154a83437b6d26b3a209`
(`resolve-review-base.sh`, origin/main). Four commits: 496b603b9 (pure move), 5fc32982a (pointers), 9dfccd7b5 (test
mock), 1730daa1f (scroll hint). 21 files, 1148+/673-. Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1449/evidence/`
(my artifacts are prefixed `eval-1-`).

### Phase 1: Spec Review — PASS

- AC1: `PanelDetailModal.chartTypeDefault.test.tsx:30` adds the `getFilterCapabilities` mock with the `{ columns: [] }`
  shape. I re-ran the suite: AggregateError 0 and ECONNREFUSED 0 (executor's before file shows 2). The 2 `act()`
  warnings are the same pre-existing ones, none new. 3/3 green (`eval-1-d4-after.txt`). For the mutation red, I am
  relying on the executor's `d4-mutation-red.txt`, which shows 1 failed out of 3. I did not re-run it, because the
  read-only rule forbids mutating code.
- AC2: every pointer named in item 2 is fixed, and the 7 dead write-path-audit rows are re-pointed. I looped over all 9
  `frontend/src/...` paths in `openspec/specs/write-path-audit/spec.md` with `test -e`: all OK. I re-ran the D3 grep
  myself. The remaining hits are all still correct, and I checked each one:
  - `MarkdownRenderer.tsx:10`: `PanelContent.tsx` does import it.
  - `InlineError.tsx:47`: `PanelContent.tsx:162` carries `role="alert"`.
  - `usePanelData.ts:44`: both files wire `rowsTruncated`.
  - `PanelCardBody.tsx:266`: correct.
  - `appearance.ts`, `usePanelDetailEditState.ts`, `OutputControlsEditor.tsx`: correct.

  The "`PanelContent` withholds this component" comments moved by D1 now name `OutputPanelContent`. That is correct:
  `OutputPanelContent.tsx:112/120` holds the `useOutputMeta` + `PanelBodySkeleton` guard.
- `PanelContent.test.tsx:323` (ticket item 2): the executor says there was no stale pointer there, and that is correct.
  At HEL-1399's commit `fd99c3dd`, lines 321-327 are the HEL-909 comment, and it already names `OutputPanelContent`.
  On HEAD that comment is at :341, unchanged. The file has no `PanelContent.tsx` or `TableRenderer.tsx:N` pointer
  anywhere (grepped).
- AC3: the split is behaviour-preserving. I re-proved it independently (details in Phase 2). Host 299 lines; new files
  101/124/44/209/266 lines, all under 400. Commit 1 touches no test files.
- AC4: the vertical axis is added to `useScrollEdges` additively. `EditFormScrollArea` owns the hook and mounts with the
  form, and the overlay carries the top/bottom fades. `elevationTokenGuard.css.test.ts` pins the 3 new declarations by
  exact text and count. I verified it live in both themes (Phase 3).
- AC5: I re-checked the dev DB by **id** (not email). All 8 ids are absent: the 5 HEL-1399 users plus the executor's
  eff23d9e, b49527ae and f8703467. No `hel1449%`/`hel1399%` user remains (`eval-1-d6-recheck.txt`).
  - The 5 HEL-1399 (id, email) pairs in `d6-select-before.txt` match the HEL-1399 evidence files exactly.
  - `buildUserDeleteSql` requires that exactly n recorded pairs match by id AND email, and that exactly n users are
    removed, so the transaction could not delete anything outside the records it was given.
  - The executor reports n=8. All 8 are now gone and none of the 8 is a non-throwaway account.
  - f8703467 / `hel1449-shots-1791914228820-46588@example.test` was found by a read-only prefix SELECT. It is the
    executor's own failed first seed: same `uniqueEmail("hel1449","shots")` format, timestamp 7.5 s before the
    second seed. It was then deleted by its exact pair.
  - Caveat: the actual `records` array passed to the delete was not persisted. `d6-delete.txt` only says "8 exact
    pairs". So "exactly these 8 and nothing else" rests on the guard's semantics plus the post-state, not on a
    transcript of the call.
- Scope: no file outside the ticket's items. None of the open merge-train PRs #999/#998/#994/#1000/#1001 touches a file
  in this diff (checked with `gh pr diff --name-only`).
- CONSTRAINTS C1-C9: all honoured.
  - C4: the 4-commit separation holds.
  - C3: test-file edits are comment-only (D3), the one mock (D4), or new D5 tests.
  - C8: `files-modified.md` lists all 21 changed files with complete repo-relative paths. The commits carry no session
    link or Claude-Session trailer.

### Phase 2: Code Review — PASS

Gates, re-run fresh in `WORKTREE_PATH`, all under nice -n 19 with jest `--maxWorkers=3`:
- `npm run lint`: exit 0, zero warnings.
- `npm run format:check`: clean.
- `npm run typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- `tsc --noEmit --noUnusedLocals` filtered to touched/new files: 0 hits.
- `npm test`, split into foreground shards, exactly what ran:
  - root `jest`: 49 suites / 458 tests passed.
  - frontend `jest --shard=1/3`: 195 suites / 2297 tests passed.
  - frontend `jest --shard=2/3`: 195 suites / 2239 tests passed.
  - frontend `jest --shard=3/3`: 195 suites / 2477 tests passed.
  - Total frontend 585 suites / 7013 tests, 0 failures (`eval-1-test-*.txt`).

D2 proof, re-run independently against commit 1 (`eval-1-d2-proof.py`, output `eval-1-d2-proof-commit1.txt`). I wrote
my own script rather than reusing the executor's:
- The base partition over 1..903 is checked mechanically as sorted, contiguous and non-overlapping.
- Blocks a/b/c are identical after stripping whitespace, import statements and line-leading `export `.
- The d/e hook bodies (between signature and trailing `return {…}`) are identical.
- The host remnant (base L1-30 minus imports, plus L284-321, L469 and L695-903) is identical after removing exactly the
  two call-site destructures.
- My char counts and sha256 match the executor's for every block.
- The call sites sit in the original slot: after `canWrite` and before the D4/4.1 comment.
- Hook sequence, with comments stripped and generic-aware: base L284-903 equals the branch host with both hooks inlined.
  Both are 28 calls: `useState`, `useAppSelector`, 5×`useMemo`, …, `useEffect`×3, `useMemo`×3.

Code-quality notes:
- `useScrollEdges`: the change is additive. `overflowing` keeps its horizontal meaning, and the doc comment says so.
- `EditFormScrollArea`: small, typed, and its doc comment explains why it is a separate component.
- The overlay is `aria-hidden` and `pointer-events: none`.
- CSS uses tokens only (`--app-text` in `color-mix`, existing 12px/35% scroll-fade family). The literal `z-index: 1`
  matches the existing precedent (DESIGN.md:577, plus 9 other sites).
- I found no `PanelDetailModal.mobile.css` rule that conflicts.

DESIGN.md: one hunk only, lines 341-349, the shadow paragraph. The original "Neither carries a y-offset with a blur"
would have become false with the new vertical insets. The rewording correctly limits the claim: the rings are
zero-blur, and the insets are drawn inside their box. The over-replace amend left nothing elsewhere in DESIGN.md.

Tests:
- The new `PanelDetailModal.editScrollFade.test.tsx` starts in view mode and stubs the measurements before going to
  edit. The executor's evidence shows it red under the host-level-hook mutation (`t6-2-mutation-red.txt`, 2/3 failed).
- The guard mutation goes red (`t4-4-guard-mutation-red.txt`).
- The `useScrollEdges` vertical red (`t6-1-red.txt`) is a compile-only red, not a behavioural one. It is acceptable
  because the assertions themselves are concrete; see the suggestions below.

### Phase 3: UI Review — PASS

I seeded my own throwaway user (`903d4f92-24a1-43d2-8c21-7308ca2cb4ea` /
`hel1449-eval-1791916497098-40312@example.test`) through a separate fetch context with its own cookie jar, plus a chart
Output panel with 3 controls and a text panel. All ids are recorded in `eval-1-dev-db-ids.txt`. There was one UI login.
Afterwards I deleted the user with `buildUserDeleteSql` over that exact pair and confirmed 0 rows remain
(`eval-1-user-cleanup.txt`). I started the servers with `start-servers.sh`, checked them with `assert-phase.sh servers`
(PASS), and stopped them with `stop-servers.sh`.

- Desktop view→Edit at 1440×900, light and dark: the form is scrollHeight 1442 vs clientHeight 520 at scrollTop 0. The
  class is `--bottom` only, and the computed shadow is `inset 0 -12px 12px -12px`, rgb(33,29,25)/0.35 in light and
  rgb(242,239,233)/0.35 in dark (`eval-1-edit-top-1440-{light,dark}.png`).
- Controls row under the fade: at scrollTop 892/922, the "Add control" combobox sits in the bottom 12px, and both fades
  are shown. I compared screenshots against the same frame with the fade classes removed:
  - light: bottom 12px mean delta 13.44 (max 37); top 12px 13.67.
  - dark: bottom 12.74 (max 35); top 12.88.
  - the middle of the form, rows 200-499: delta 0.00.

  Files: `eval-1-fade-delta-{light,dark}.txt` and `eval-1-controls-{under-fade,nofade}-{light,dark}.png`.
- Clickability: `elementFromPoint` 6px above the form's bottom edge returns the combobox's own span, not the overlay, in
  both themes. A real Playwright click on that combobox passed the hit-target check and opened the listbox. The same
  check does reject a genuinely intercepting element: the select's own scrim was correctly reported as intercepting on
  the next click.
- Adding a control without scrolling: sh 1442 → 1740 while scrolled near the end, and `--bottom` re-appeared. At the
  end of the scroll the class is `--top` only.
- Other entry points:
  - The E key from view mode, and re-entering edit after a Close→view, both measured correctly (`--bottom`).
  - The discard-warning footer shrinks the form and the fades stay coherent (`eval-1-discard-warning-light.png`).
- Mobile 390×844, light and dark: sh 1622 vs ch 686, `--bottom` over the Controls card, no horizontal page overflow
  (`eval-1-mobile-edit-{light,dark}.png`).
- 768×1000 and 1100×800: `--bottom` is shown and nothing breaks. A resize to 1100×600 with the form open re-measured
  (ch 520 → 380), and it is `--top` at the end.
- Non-overflowing form, text panel at 1440×900, light and dark: sh = ch = 520, class is base only, and the computed
  `box-shadow` is `none` (`eval-1-text-nofade-1440-{light,dark}.png`).
- Console: the only errors were 2× 401 on `/api/auth/me` before login (expected) and 2× 502 on
  `/api/pipelines/<id>/run-events` (an SSE stream through the Vite proxy, around reloads and mode toggles). No file in
  this diff touches run-events or EventSource, so I do not attribute them to this change.
- Not caused by this diff, observed only: crossing from the mobile stack to the desktop grid (768 → 1100 width) closes
  an open detail modal, because the opening view unmounts.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `openspec/specs/write-path-audit/spec.md:188`: the row `frontend/src/features/panels/state/panelsSlice.ts | Panel
  thunks and triggers` points at a file that has 1 `createAsyncThunk`. The thunks live in `panelThunks.ts`, which has
  16 and is re-exported from `panelsSlice.ts:21/423`. Design D3 promised to re-check each Role. Consider re-pointing the
  row to `panelThunks.ts`, or adding that file as a row.
- `d6-delete.txt` should persist the exact `records` JSON passed to `buildUserDeleteSql`, not just "8 pairs". Also
  record each user id at creation time, so a failed seed never needs a prefix-SELECT discovery.
- `useScrollEdges.test.tsx`: the vertical cases were only compile-red before 4.1. A one-line behavioural mutation (for
  example `bottom: maxScrollTop - el.scrollTop >= 0`) red-then-revert would make "the suite bites" explicit.
- `useTablePersistedState.ts` is 266 lines, slightly over CONTRIBUTING's ~250 soft budget. That is fine under the AC's
  400 cap, and noted only for awareness.
- The change dir `openspec/changes/split-tablerenderer-panel-followups/` is still untracked on the branch. Make sure
  the delivery/archive step commits it.
