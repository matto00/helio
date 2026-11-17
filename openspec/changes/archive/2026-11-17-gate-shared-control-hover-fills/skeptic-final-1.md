## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 8bc42f60bd28a40b7e5993d51404d10507d39bbb. The base fd3fbe7d098e6518cfd5ea44469a5a398cde2742 was resolved live with `resolve-review-base.sh`, which exited 0. I treated the evaluator's and executor's statements as claims and checked each one against the code or a run of my own.

### What I verified (with evidence)

**AC1: no sticky hover after a tap, and the touch e2e fails first**
- On HEAD, `e2e/hel1675-shared-hover.spec.ts` passed 4/4 (DEV_PORT=7107). All six instances were green in both themes, and every "under pointer" check held.
- I reproduced the red-first result myself without editing any tracked file:
  - I copied the spec to a scratch directory and changed one thing: an init script adds the BASE (fd3fbe7d0) text of all 20 changed shared stylesheets as a `<style>`.
  - I ran that copy against the HEAD app through a scratch Playwright config.
  - Both touch tests FAILED. Instances 1, 3, 4, 5 and 6 were RED in dark and in light; instance 2 was green.
  - The diffs are the hover recipes, not focus rings. Two examples:
    - Instance 1, dark: background `rgba(0,0,0,0)` -> `rgb(22,21,20)`, border alpha 0.09 -> 0.18.
    - Instance 5, light: background `rgba(0,0,0,0)` -> `rgb(239,236,230)`, colour `rgb(100,94,86)` -> `rgb(33,29,25)`.
  - This matches the evaluator's in-place swap result (5/6 red). The spec is a real failing-first proof, not a guard.
- Instance 2 (ActionsMenu item) shows no change on the base CSS. It is `probeOnly` in the spec: logged, never asserted. `files-modified.md` states it plainly: "green on unchanged CSS: guard + probe only", with the reason (reopened under a stationary pointer). This is the honest C1 classification the driver asked for.
- Readiness waits use real signals, with no fixed timeouts in the spec:
  - menuitem, listbox or dialog visible, then gone
  - `details[open]` plus the function list visible
  - the GET `/sample` response, then `aria-busy="false"` and the button enabled
  - `getAnimations()` settled
  - `openPipeline` waits on `.spine-row`, `data-theme` and `fonts.ready`
- `realTap` (`e2e/support/hel1668.ts:150`) is a touchscreen tap plus the compat mouse move. The paint is read from computed styles, never from `:hover` matching.

**AC2: the guard covers the shared component CSS**
- `frontend/src/shared/sharedHoverGating.css.test.ts` walks `shared/**/*.css`, has an empty allowlist and a floor of 36. It passes on HEAD.
- I ran the guard's own helpers (`frontend/src/test/cssHoverGating.ts`) from a scratch script:
  - On the base `shared/` tree (37 files, 36 hover rules): 38 ungated `:hover` selectors across 20 files.
  - On HEAD: 0 ungated selectors and 0 mixed lists.
  - The floor of 36 equals the measured hover-rule count, so the guard cannot pass vacuously.
- `pipelineHoverGating.css.test.ts` now uses the shared helpers, with its allowlist predicate unchanged. It passes.

**AC3: desktop hover unchanged (C12: light and dark, desktop and phone, against the running app)**
- Committed spec, desktop describe: a mouse at 390x844 matches the DESKTOP_HOVER fixture in both themes.
- I also ran my own before/after comparison on the running app at 1280x800 and at 390x844 with a hover-capable mouse, in both themes:
  - Method: I replaced each Vite-injected `<style data-vite-dev-id>` for the 22 changed stylesheets with its base text, in place. That keeps cascade position exact.
  - I hovered 9 controls per viewport and theme: the header or mobile-pill primary button, popover triggers, IconButtons, the disclosure summary, the header secondary button, and the in-sheet controls on the phone.
  - Result: `headVsBaseDiffs=[]` in all 4 runs. Hover paint differed from rest on 9/9 controls, so the comparison is not vacuous.
  - Hover screenshots of the primary button:
    - 390 dark and 390 light: byte-identical HEAD vs base (`cmp`).
    - 1280: the only differing pixels are a 6x2 box at (1035,56) on the anti-aliased corner of the "Add schedule" pill, off by 1/255 per channel. That is rasterisation noise, nothing visible, and not a hover control under test.
- I looked at the 1280 light and 390 dark screenshots. The layout and controls are on-pattern, and the merged primary buttons render the accent-strong hover in both themes.
- In the CSS diff, every rule is wrapped in place, with no change to specificity or order.
  - Three mixed selector lists were split, and each keeps its non-hover member ungated: `inputs.css` (`--focused`), `DataGrid.css` (`:active::after`) and `MobileNavSheet.css` (`:focus-visible`).
  - The merged primary blocks compute the same as the old two-block cascade: border transparent, accent-strong background, accent-ink text.

**Tidy items**
- The `PipelineSpineHeader.css` top comment is now accurate: the meta line is hidden in `@container (max-width: 685px)` at line 302, and the old 1100px claim is gone.
- The 1280 gap assertion in `e2e/hel1668-header-meta.spec.ts` is real: `trailingLeft - boxRight <= headerGap + 1`.
  - `hel1668-header-meta` and `hel1668-phone-sheet` passed 23/23 on HEAD.
- One `useNow` per card. In the base code, `SpineSourceCard` called `useSourceSampleLabel`, which calls `useNow` at line 15, and it also mounted `SourceSampleLabel`, which called the hook again. Now the card calls it once and renders `SourceSampleLabelView`. The new test passes.
- The `useTopModalDialog` narrowing and the feature stylesheets are deferred to HEL-1736 and HEL-1735. The ticket allows tidy items that grow to go to a follow-up.

**HEL-1684 surface**
- This branch changes four spine-area source files: `PipelineSpineHeader.css`, `PipelineMobile.css`, `SpineSourceCard.tsx` and `SourceSampleLabel.tsx`. It also adds or refactors two jest tests.
- I read HEL-1684's changed-file list from its worktree. None of its files overlap with this branch: `pipelineDraft.ts`, the draft hooks, `PipelineSpine.tsx`, `StepPreviewTable.tsx`, `StepCardFocused.tsx` and `useSpineStepActions.tsx` are all untouched here.

**Gates (fresh, in WORKTREE_PATH)**
- `npm run lint`, `npm run typecheck`, `npm run format:check` and `npm run check:e2e-types`: all exit 0.
- Frontend jest (maxWorkers 3): 773 suites and 9477 tests passed.

**Residue and housekeeping**
- Every e2e user I created was deleted by the harness registry: "deleted 4/2/4/4 recorded throwaway user(s)".
- I stopped the servers with `stop-servers.sh`.
- Disclosure: I read `scripts/concertino/.concertino.env`. That is the concertino port/config file that CLAUDE.md points to, not a secrets `.env`. I filtered out key, secret, token and pass lines, and no secret was printed.

### Verdict: CONFIRM

### Non-blocking notes
- `files-modified.md` evidence notes say "40 ungated `:hover` selectors on unchanged CSS". The guard's own helpers count 38 across 20 files on the base tree, which also matches design.md's figure. Correct the number before it goes into the PR body.
- The `SourceSampleLabel` wrapper is now used only by its own test. Production renders `SourceSampleLabelView` from the card. Consider retiring the wrapper in a later cleanup.
- Evidence persistence: the before/after measurement JSONs and screenshots are in session scratch and are not persisted, because I write no files into the worktree other than this report. The load-bearing values are quoted inline above, and they are self-authenticating: computed colour strings, `cmp` results and a pixel bbox. None of them depends on mtime.
