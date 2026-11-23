## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `ea376feae39207dbbe64d09f26d4ac3450dd084e`. The base was resolved live by `resolve-review-base.sh` as
`cba523c030821c709ba227ab8c06a59f9ab913fc`. The spawn guard returned
`READY ambient=/home/matt/Development/helio branch=bug/form-panel-min-height-clip/HEL-1618`.

Evidence prefix: `E=/home/matt/Development/helio/.concertino/runs/HEL-1618/evidence/.concertino/scratch/HEL-1618/skeptic-final/`.

### What I verified (with evidence)

**The split (AC 3).**
- I diffed the base `handleImmediateStep` body (from `cba523c03:FormPanelView.tsx`) against `step` in the split
  commit's `useCompactCounterSubmit.ts` (`3ddb446c0`), ignoring whitespace. The only difference is the function name.
- The split commit touches no test file: `git show --stat 3ddb446c0` lists 4 source files plus `measurements.md`.
- File sizes: `FormPanelView.tsx` is 278 lines, the hook is 205, and the two body components are 70 and 93. All are
  under about 400.
- The before and after counts in `measurements.md` §1-2 are equal: 149 jest, 43 e2e. My own jest run of the same
  areas plus `ui/grid` gave 49 suites and 399 / 399 tests passing, which matches §5.1.

**The non-owner stale-error clear (AC 4, D2).** I reproduced both mutations myself; the tree was restored with
`git checkout`, and `git status` was clean afterwards.
- With the clear removed (the third `reconciliationTail` argument set to `undefined`), exactly the new test fails:
  "clears an earlier burst's rejection error when a later step gets no response". Evidence: `$E/d2-m1.txt`. This is
  the red-first.
- With the `burstRejectedRef` guard dropped, 2 tests fail: the new same-burst GUARD and HEL-1819's owner
  same-burst test. Evidence: `$E/d2-m2.txt`. So the guard is genuinely failable.
- Code: the shared `clearStaleRejectionError` is passed separately as `onReconciled` (owner only) and
  `onQuiescedWithoutReconcile` (non-owner only, in the `!isFormOwner` branch). The owner semantics are unchanged.
  The alert still announces "Couldn't confirm".

**The 5-row minimum (AC 1, D3/D4).** I reproduced three mutations myself.
- `panelMinRows` always returning 4: 3 red (the minH-5, empty-form and helper cases). Evidence: `$E/d4-min4.txt`.
- The lift without the free-cell check: 3 red (blocked neighbour, KEPT unloaded item, helper). Evidence:
  `$E/d4-nofree.txt`. This also proves fold-in 4 (the kept items are checked).
- `createLayouts` emitting `Math.max(item.h, FORM_MIN_ROWS)` for non-counter forms: the no-bump GUARD turns red.
  Evidence: `$E/d4-max.txt`. This proves fold-in 1.
- Fold-in 2: `clearCommitFlag` clears `resizedIdRef`, and a stale-ref jest case exists ("a resize that ends where it
  started, then a drag of another panel"). The mutation's red evidence is the executor's `evidence/g4-mutation-stale.txt`.
- Fold-in 3: the lift is computed into `next` before `markLayoutChanged`. It is gated on
  `commitOnNextLayoutChangeRef.current` and on a held id (`useGridLayoutInteraction.ts:117-127`).

**Gates, re-run by me.**
- Typecheck: clean.
- eslint `--max-warnings 0` over `ui/form` and `ui/grid`: clean.
- Prettier over the changed files: clean.
- E2E (2 workers, lane DB) for `hel1618-form-min-rows`, `hel1819-form-live-region-gap` and
  `hel1784-editor-form-submit`: 15 / 15 passed.

**Live UI at 1280 px (the `sm` breakpoint), both themes.** I used my own throwaway user, which is now deleted by
exact id.
- On load, in dark: the 2-field form is 5 rows (308 px) with 0 px hidden and Submit fully visible. The compact
  counter is 4 rows (244 px). The saved 4-row forms render at 244 px, there is no "Save now", and nothing was bumped.
  Screenshot: `$E/sk-1280-dark-load.png`.
- Resizing (edit layout):
  - A saved 4-row form with free space below was narrowed. It ended at 308 px (5 rows).
  - The same kind of form with a text panel directly below stayed at 244 px, and the neighbour did not move.
  - Dragging the 2-field form's handle 300 px up held it at 308 px, even mid-drag.
  - Screenshot: `$E/sk-1280-dark-after-resize.png`.
- After Save now, the persisted `sm` layout from `GET /api/dashboards` was:
  - the lifted form at w2 h5;
  - the blocked form at w2 h4;
  - the neighbour unchanged at (0, 9, 3, 4);
  - the 2-field form at h5.
  - "Save now" then disappeared.
- After a reload in light, the same heights held: the lift was persisted, and the lifted form shows Submit with 0 px
  hidden. Screenshot: `$E/sk-1280-light-reload.png`.
- Design judgment: the change adds no new styles. Cards, fields and the Submit button use the existing tokens and
  look the same in light and dark. The 5-row form's spare space below Submit reads as normal card padding. The
  blocked sub-5 form still clips Submit by 21 px, which is the owner's no-bump ruling, stated in the spec and in
  `measurements.md`.

**Spec truthfulness on the backend paths that were reported but not changed.** `specs/form-panel-rendering/spec.md`
guarantees only create, batch create, the client's unplaced fallback and auto-layout. Each one is checked against code:
`CreatePlacement.ContentHeight = 5` and `dashboardLayout.ts:29` `defaultItemHeight = 5`. The spec explicitly states
that a duplicate keeps its source's size and that import and proposal apply keep the heights they carry. That is
truthful.

**AC 2 (measured live at 1280 px in both themes, before and after).** `measurements.md` §3 and §4.6 have the tables,
and my live numbers above agree with the "after" column: 308 / 0 / yes for 2 fields, and 244 / 21 for a saved 4-row form.

### Verdict: CONFIRM

### Non-blocking notes

- **A pre-existing react-grid-layout render loop, not caused by this change. It should become a follow-up.**
  - On a full page load of a dashboard whose stored `sm` layout leaves a column gap (here the items at x=3 with w=2
    after narrowing), React logs "Maximum update depth exceeded" 8-9 times. The stack is RGL's sync effect,
    `react-grid-layout.js:3512`, calling `setState`. The page settles and renders correctly.
  - It reproduces with the same layout and every panel turned into a `text` panel (9 errors). For non-form panels
    every changed code path is the identity: `panelMinRows` gives 4 and nothing lifts without a resize id. So the
    loop exists on base.
  - It does not occur with the original layout (0 errors), or on a single-text-panel dashboard.
  - The probe script is `/home/matt/Development/helio/.concertino/scratch/HEL-1618/skeptic-final/probe-depth.cjs`.
- The three backend paths (duplicate, import, proposal apply) still need the follow-up the evaluator named.
- `hel1618-form-min-rows.spec.ts`'s afterAll deletes only the data sources. Its user goes through the e2e
  registry's global teardown, which removed the users in my run ("deleted 7 recorded throwaway user(s)").

### Gate defect note

None. No mtime-ordering evidence is relied on in this review.
