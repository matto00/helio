## Standing Constraints

## 1. Frontend

- [x] 1.1 Re-derive the fail-open list (grep `features/pipelines` non-test for `(canEdit|canRun|editable|isOwner)\s*=\s*true`, `readOnly\s*=\s*false`, and optional `readOnly?:`/`canEdit?:`/`canRun?:`/`isOwner?:`/`runRole?:` read without a default); record it in files-modified.md
- [x] 1.2 List every production call site of each component with the value it passes; add an explicit prop where one is missing, derived from the role already in scope (never a literal `true`)
- [x] 1.3 Flip each default to deny (`canEdit`/`canRun`/`isOwner` → `false`, `readOnly` → `true`) and make `usePipelineDraftSave`'s `runRole` required; verify `npm run typecheck` and lint pass
- [x] 1.4 Pass the role explicitly in EVERY test render or harness that asserts an edit/run/owner-only control or editor copy (about 20 files, incl. `test/conditionalFormatsEditorHarness.tsx`); verify the full jest suite is green
- [x] 1.5 Rewrite `viewerCopy.test.ts`'s header comment to describe what its two tests assert, including the regex limit

## 2. E2E

- [x] 2.1 In `e2e/hel1794-viewer-read-only.spec.ts` `scan()`, skip by `el.matches(":disabled")` instead of `fieldset[disabled]` ancestry, and add `summary` to `SELECTOR`
- [x] 2.2 Classify anything the wider scan newly reports (D3): navigation/disclosure into `ALLOWED` with a comment, an edit affordance fixed, a product call escalated

## 3. Tests

- [x] 3.1 Jest: render each component from 1.1 without its role prop and assert its own read-only signal (control absence + disabled config, or viewer copy for copy-only components); the StepCardFocused `isOwner` test passes `readOnly={false}` so only `isOwner` decides; commit the red run (.txt) before 1.3
- [x] 3.2 Jest guard over `features/pipelines` (ui + hooks): no fail-open default and no undefaulted optional role prop (an interface file like `stepCardTypes.ts` paired with its consumer by an explicit commented map, never "a default anywhere"); prove by reintroducing one of each (mutation transcript)
- [x] 3.3 E2E self-test (D4, plant+scan in one evaluate, running the SAME in-page scan body as `scan()`, factored out, not a copy): planted link + summary in a disabled fieldset are reported, planted input is not; commit the red run before 2.1
- [x] 3.4 Record mutations: old fieldset skip → 3.3 red; `summary` removed → 3.3 red; each default flipped back → 3.1 red
- [x] 3.5 Run the full `hel1794-viewer-read-only.spec.ts` file green (viewer and editor halves) and the full jest suite green
