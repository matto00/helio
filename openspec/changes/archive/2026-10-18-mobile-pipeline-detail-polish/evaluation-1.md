## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `389273bc66b5ce42ca867a3b36992e46d59fca45`. Diff base: `6477341111d4b4ec6d0368e5a1f46e473325f226`, from `resolve-review-base.sh`.
Evidence directory: `/home/matt/Development/helio/.concertino/scratch/HEL-1668/eval-1/`. It holds the screenshots, `eval-ui-log.txt`, `e2e-hel1668.log`, `e2e-regress.log` and `e2e-run/*.png`.

### Phase 1: Spec Review — FAIL

The seven ticket items are implemented and tested. The plan matches the code. C1 and C2 are honoured. Phase 1 fails on two points: merge readiness and planning artifacts that no longer match the code.

- **AC coverage.** I re-ran every item below and all passed (Phase 2/3). Each was checked at 375, 390 and 768 where the item applies, light and dark:
  - Item 1: deep link, including resize from desktop to phone.
  - Item 2: toast above the sheet, with the frame-gap ordering check.
  - Item 3: Escape scoping, for the schema panel and the step menu inside the sheet.
  - Item 4: placement at 1280x800 and 1000x800, plus the phone nav-clearance check.
  - Item 5: sticky hover on touch, plus the compact touch-tablet tones.
  - Item 6: copy at 375, 390, 768, 1000 and 1280.
  - Item 7: editor phone refresh.
- **C1 is honoured.** On the first render at a new portal target, `liveReady` is false because `live.target !== target` (`Toast.tsx`, `ToastViewport`). It only becomes true after the double-rAF `setLive({ready:true})`. Until then, deferred race-window toasts and newly pushed toasts are both filtered out of the regions. The `skip` set only removes toasts committed more than 100 ms before the move.
- **C2 is honoured.** Each `:hover` rule in `PipelineSpine.css` (old :189, :344, :356 and the rest) is wrapped in place. Relative source order is unchanged, and so are the values. The split rules (`.spine-row--selected`, `.mobile-pill--primary`, `.spine-header__btn--primary`, `.output-schema-disclosure__trigger`) keep their non-hover selectors ungated, with identical declarations.
- **Red-first records** in `.concertino/scratch/HEL-1668/red/`:
  - I re-ran the new jest tests myself against a throwaway detached worktree at the base commit, then removed it. They fail for the right reasons:
    - deep link: "Unable to find role=dialog Step editor"
    - Escape: `defaultPrevented` false
    - placement: `style.bottom` empty, so the panel opens below
    - hover guard: offenders listed
    - Output card: "off"
    - Toast.modal: all six behaviours red
  - The e2e reds in `e2e-on-origin-main.txt` and `d5-e2e-origin-main.txt` are plausible. However, the item 3 e2e red records only a 150 s test timeout, with no assertion message. That record does not show which assertion went red. The jest red for item 3 is genuine, so this is a non-blocking note.
  - Items 7 and 5 (compact tones) are labelled as mutation-proven guards, as designed:
    - `d7-mutation.txt`: the unscoped request returns 404.
    - `d2-single-raf-mutation.txt`: gap 1 < 2.
    - The two `compact-tones-*.txt` records are both failing runs: menu opacity was caught mid-transition. The tone values they log are identical before and after, and the later origin/main run passes (`e2e-on-origin-main.txt` #13).
- **Other lanes' files are untouched.** No diff in `frontend/src/app/App.tsx`, `e2e/hel1579-*` or `e2e/support/apiRequestCounter.ts`.
- **Merge readiness: FAIL.** `origin/main` moved to `49021293b` (HEL-1669, #1065) after this branch's base. Running `git merge-tree HEAD origin/main` reports `CONFLICT (content): Merge conflict in frontend/src/features/pipelines/ui/mobile/PipelineMobile.css`. HEL-1669 adds an UNGATED hover fill: `:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary):hover:not(:disabled)`. After the merge, this lane's own guard `pipelineHoverGating.css.test.ts` ("every :hover selector is inside @media (hover: hover)…") would go red. Design D5 and task 5.2 assign this to the lane that merges second, which is HEL-1668. `e2e/hel1582-mobile-pipeline.spec.ts` auto-merges, but HEL-1669 changed that test's exception block and the `--app-accent-strong` token. The merged hover test has therefore never been run. The rest of the HEL-1669 diff (theme.css, appearance.ts, charts, DESIGN.md) does not overlap.
- **Planning artifacts do not match the final behaviour:**
  - `tasks.md:44` (task 5.2, "Do not edit `e2e/hel1582-mobile-pipeline.spec.ts`") is ticked `[x]`, but the spec was edited. `design.md:127` still says "HEL-1668 does not edit the hel1582 spec". Only `files-modified.md` records that the driver lifted the rule.
  - Two CSS changes go beyond the design, and neither design.md D6 nor the `pipeline-detail-spine-layout` delta records them:
    - The desktop header's last-run meta now hides at a page container of 685px or less (it was 600px), with `min-width: 15ch` (`PipelineSpineHeader.css:128-134`, `:292-299`).
    - The phone source-card label gets a top margin when the kind meta is omitted (`PipelineMobile.css:529-536`).
  - The first is a desktop behaviour change. I measured it (`eval-ui-log.txt`, "WIDTH" lines):
    - At a 960px window (page container 656px), origin rules show the meta 74px wide, with its text overflowing by 24px. A 2-digit count ("42 rows written · 3 minutes ago") is already clipped there.
    - On this branch the whole line is hidden instead.
    - At 900, 1000 and 1100 the result is identical to origin, and so is header overflow (0).
    - This is a defensible trade-off: hiding beats a clipped fragment, and it follows the existing ≤600 rationale. But it is unrecorded, and it is not in the "UI decisions taken overnight" list that the brief requires.

### Phase 2: Code Review — PASS (for the reviewed commit; see Phase 1 for the merge-time defect)

I ran the gates myself in `WORKTREE_PATH`:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0, "All matched files use Prettier code style!".
- `npm run typecheck`: exit 0.
- `npm test` (`HELIO_JEST_MAX_WORKERS=2`, `nice -n 19`): root 524/524 and frontend 9080/9080 passed, 728 suites, exit 0.
- `npm --prefix frontend run build`: exit 0.

There are no backend changes.

- **CONTRIBUTING / DESIGN [mechanical] rules.** No inline FQNs, no `any`, and no literal px in the new CSS. The new margin is `calc(var(--space-4) + var(--space-1))` and the header uses `gap: 1ch`. The token audit baseline shift (`tokenAuditSweep.css.test.ts`, lines 178/236/386 to 182/240/396) is only a line move: the comment says the lines are byte-identical, and the suite passes. The literal px mirrors in `OutputSchemaDisclosure.tsx` are gone. Limits are read from `--schema-panel-*` custom properties declared on the panel class.
- **DRY.** The `?step=` resolver was extracted (`state/resolveStepParam.ts`) and is used by both layouts. The sample-label text logic moved into `useSourceSampleLabel`, shared by `SourceSampleLabel` and `SpineSourceCard`, so there is no duplicated decision. `FOCUSABLE_SELECTORS` is exported from `Modal.tsx`, not copied.
- **Type safety and error handling.** These are fine. `isOpenModal` guards `:modal` for jsdom with a try/catch and documents why.
- **Opt-in `place` in `usePortalPopover`.** Consumers that do not pass `place` keep the `computePos` path. `placed` is always true for them, and their existing jest suites pass.
- **Hover-gating guard.** It is non-vacuous (asserts more than 40 hover rules). It checks allowlist rot and mixed selector lists, and covers every pipeline-page stylesheet that contains `:hover`.

Non-blocking items are listed below.

### Phase 3: UI Review — PASS

Servers came up through `start-servers.sh` and `assert-phase.sh servers`: PASS on ports 7100 and 10007.

- **Targeted e2e** (2 workers, `nice -n 19`, `--trace retain-on-failure`): `hel1668-phone-sheet`, `hel1668-schema-panel-copy`, `hel1668-editor-phone-refresh` and `hel1608-spine-count-overlap` gave **30/30 passed** (`eval-1/e2e-hel1668.log`).
- **Regression subset: 11/11 passed** (`eval-1/e2e-regress.log`). It covered:
  - the hel1582 "phone hover, focus and pressed states" test and the "desktop (1440x900) N fields panel" test
  - hel1579 1280x800, 1440x900 and 820/900/1100 one-row header
  - hel1095 and hel1096 toast/ARIA specs
- **My own review** used an isolated browser with a throwaway user, deleted by exact id (`629082d3-…`, `0c89ac70-…`). It covered 375, 390, 768, 1000 and 1280, light and dark (`eval-1/*.png`, `eval-1/eval-ui-log.txt`):
  - **Deep link.** A sheet opens at 375, 390 and 768. Closing it clears `?step=`. On desktop, the step is selected and no sheet opens.
  - **Escape.** Inside the sheet, Escape closes the schema panel and the sheet stays open.
  - **Item 4 on desktop.** At 1000 and 1280, a short panel (content 192px) opens above its trigger, inside the viewport (`desktop-schema-1000x800-*.png`, `desktop-schema-1280x800-*.png`). The tall fixture opens below, capped. In the e2e screenshot `e2e-run/schema-tall-1000x800-dark.png` the panel is caught mid entrance fade. My settled screenshot is opaque.
  - **Item 4 on phone.** In the sheet and on the Preview tab, panels sit above their triggers, clear of the bottom nav.
  - **Copy.** "Static · 14 rows" appears once. The Output card reads "from Compute column". An 8-digit count keeps "3 minutes ago" fully visible at every width. At 1000 the count ellipsizes to "1…" (`header-1000-count8.png`). The full figure stays in `title`.
  - **Console errors.** The only one is a pre-existing `404` on each pipeline page load (the schedule GET, out of scope as HEL-1670). The `429`s came from my own rapid script runs.
- **hel1582 hover-test move (orchestrator decision): it holds.** The test now creates its own context at 375x812 with `isMobile:false, hasTouch:false, deviceScaleFactor:2`, so `(hover: hover)` matches. It is otherwise the same test:
  - the same 12 controls
  - the same hover, focus and pressed states, through the same `measureControl`
  - both themes
  - the same thresholds: surface 1.10, text 4.5, non-text 3, and the pinned 3.9 accent-hover exception
  - the same `.mobile-tabs__tab:hover` mutation proof

  It does not merely stop exercising hover on touch. The touch side is asserted separately by `hel1668-phone-sheet` item 5, which checks `matchMedia("(hover: hover)")` is false and that the fill after `realTap` equals the rest fill, at 375, 390 and 768, both themes. Before this change, hover under `isMobile/hasTouch` was only measurable because the fills were ungated. Weak points (non-blocking): the manually created context is not closed if the test fails (`context.close()` is only on the success path), and it does not get the config's `trace: retain-on-failure`.

### Overall: FAIL

### Change Requests
1. **Rebase onto `origin/main` (`49021293b`, HEL-1669) and resolve the `frontend/src/features/pipelines/ui/mobile/PipelineMobile.css` conflict.**
   - Keep HEL-1669's rest-fill rule `:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary) { background: var(--app-surface-soft); }` UNGATED.
   - Move only its hover rule, `:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary):hover:not(:disabled) { background: var(--app-surface-strong); }`, into `@media (hover: hover)`. Keep it in place: after the gated `.mobile-pill:hover:not(:disabled)` block and before the `.mobile-pill--primary` rules, so relative source order is preserved (C2). Values unchanged.
   - Then re-run:
     - `npm --prefix frontend test -- --testPathPatterns=pipelineHoverGating`
     - the full jest suite
     - lint and format
     - `e2e/hel1582-mobile-pipeline.spec.ts -g "phone hover"` (the auto-merged test now carries HEL-1669's exception-block changes and token values)
     - the three `hel1668-*` specs and `hel1608`
   - Record the results in the handoff.
2. **Bring the planning artifacts in line with what shipped:**
   - (a) `tasks.md:44` (5.2) and `design.md:127`: state that the hel1582 hover test was moved into a non-touch, hover-capable 375x812 context (driver lifted the do-not-edit rule), and say why.
   - (b) design.md D6(c) and the `pipeline-detail-spine-layout` delta: record that the desktop header's last-run meta now keeps `min-width: 15ch` and is hidden at a page container ≤685px (was ≤600px). At page widths 601-685px (about a 905-990px window with the context list open) the meta is hidden rather than clipped (measured at 960px: origin showed a 74px fragment with 24px of overflow).
   - (c) Record the phone source-card label top margin used when the kind meta is omitted (`PipelineMobile.css:529-536`, expander tiling).
   - (d) List (b) and (c) under "UI decisions taken overnight" for the PR body.

### Non-blocking Suggestions
- `PipelineMobile.css:443-455` and `PipelineSpineHeader.css:268-280`: two consecutive `@media (hover: hover)` blocks for the same `…--primary:hover:not(:disabled)` selector, where the second immediately overrides the first's `background`. These could be one rule (`border-color: transparent; background: var(--app-accent-strong); color: var(--app-accent-ink);`). The cascade result would be identical.
- `useTopModalDialog.ts`: the `childList` + `subtree` observer on `document.body` runs `querySelector("dialog")` on every added or removed element subtree anywhere in the app. Consider limiting it to the `open` attribute plus direct `dialog` node checks, or debouncing to a microtask, if it ever shows in a profile.
- `e2e/hel1582-mobile-pipeline.spec.ts:1047-1141`: wrap the test body in `try { … } finally { await context.close(); }`. Optionally start tracing on the manual context, so a failure keeps a trace like the rest of the suite.
- The red record for item 3's e2e (`red/e2e-on-origin-main.txt`, 2.5 m) has no assertion message. A future red record should capture the failing expectation, not only a timeout.
- At 1000px the 8-digit count ellipsizes to "1…" beside the time. This is acceptable per the ticket and leaves the visual judgement to the skeptic.
