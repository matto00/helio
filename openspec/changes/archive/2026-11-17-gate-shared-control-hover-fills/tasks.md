## Standing Constraints

- [C1] Touch e2e: red-first on unchanged CSS; only instances shown red count as e2e-covered, others are listed as guard + probe only; read computed styles, never :hover matching

## 1. Frontend

- [x] 1.1 Write `e2e/hel1675-shared-hover.spec.ts` (D4 instances, touch + desktop) and run it on UNCHANGED CSS; record red per instance, the tap primitive, and desktop hover values
- [x] 1.2 Gate every `:hover` rule under `frontend/src/shared/**/*.css` in place, splitting mixed lists; verify jest + lint pass
- [x] 1.3 Add the DESIGN.md §5 `@media (hover: hover)` rule naming both guards; verify prettier check passes
- [x] 1.4 Merge the paired primary-button hover blocks in PipelineSpineHeader.css and PipelineMobile.css; verify computed hover identical in both themes
- [x] 1.5 Rewrite the stale ~1100px comment at the top of PipelineSpineHeader.css to match the CSS
- [x] 1.6 Split SourceSampleLabel into hook + `SourceSampleLabelView`; SpineSourceCard calls the hook once; verify existing tests pass

## 2. Tests

- [x] 2.1 Extract the CSS rule parser to `frontend/src/test/cssHoverGating.ts`; the pipeline guard imports it unchanged and still passes
- [x] 2.2 Add `frontend/src/shared/sharedHoverGating.css.test.ts` walking `shared/**/*.css`; verify per-file un-gate mutations and one mixed-list mutation each fail it
- [x] 2.3 Jest test: one `useNow` interval per SpineSourceCard; verify red on the pre-split code
- [x] 2.4 Assert `trailingLeft - boxRight` at 1280 in `e2e/hel1668-header-meta.spec.ts`; verify a width-reserving mutation fails it
- [x] 2.5 Re-run `e2e/hel1675-shared-hover.spec.ts` green after 1.2; desktop values equal the 1.1 recording in both themes
- [x] 2.6 Visual cohesion: screenshots against the running app, light and dark, desktop and phone

## 3. Follow-ups

- [x] 3.1 Filed by the orchestrator at Planning: HEL-1735 (feature stylesheets outside `shared/`), HEL-1736 (`useTopModalDialog` narrowing); executor records both ids in `files-modified.md`
