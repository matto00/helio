## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD 8bc42f60bd28a40b7e5993d51404d10507d39bbb (delta from a02681da0). The base, fd3fbe7d098e6518cfd5ea44469a5a398cde2742, was resolved live.
Cycle 1 findings and evidence are in evaluation-1.md and still stand; this report covers the cycle-2 delta.

### Phase 1: Spec Review — PASS
- Cycle-1 CR3 is resolved:
  - design.md D4 now states the desktop test uses a hover-capable mouse at 390x844, and why.
  - The spec carries a matching comment at `e2e/hel1675-shared-hover.spec.ts:347`.
- The delta touches no other source files. Its other files are the spec, the pipeline guard, the JSDoc in
  `SourceSampleLabel.tsx`, and evaluation-1.md, which is now committed in the change dir.
- No spine/draft files are touched (HEL-1684 surface intact).
- The C1 constraint is still honoured.

### Phase 2: Code Review — PASS
Gates (fresh, in WORKTREE_PATH, all exit 0):
- `npm run lint`
- `npm run format:check`
- `npm test`: root 66 suites / 579 tests, frontend 773 suites / 9477 tests
- `npm --prefix frontend run build`
- `npm run check:e2e-types`

CR1 (pipeline guard reuses the shared helpers) is resolved:
- `pipelineHoverGating.css.test.ts` now calls `ungatedHoverSelectors(rulesByFile, isAllowed)` with the unchanged
  REVEAL_ALLOWLIST check, and calls `mixedGatedRules(rulesByFile)`.
- The duplicate loops are gone and `isAllowed` now has a caller.
- The guard passes on HEAD, so the allowlisted reveals are still exempt through the new predicate.

I verified the guard still fails under mutation. Each mutation was applied in place and then restored, and
`git status` was clean afterwards:
- Un-gate: changing `PipelineSpineHeader.css:30` `@media (hover: hover)` to `@media (min-width: 0px)` makes it fail
  1/4, naming `spine/PipelineSpineHeader.css: .spine-header__crumb-link:hover`.
- Mixed list: adding `, .eval-mixed-probe` to the gated rule at line 31 makes it fail 1/4, naming the mixed rule.

CR2 (orphaned JSDoc in the spec) is resolved: it was removed from the `Instance` interface.

Suggestions from cycle 1 that were taken:
- The always-true `if (DESKTOP_HOVER[theme])` is removed, so the desktop assertion is now unconditional.
- The blur comment now names instance 3.
- The fetch-ownership sentence moved from `SourceSampleLabel` to the `SourceSampleLabelView` JSDoc.

### Phase 3: UI Review — PASS
- The servers on 7107/10014 are healthy (`assert-phase.sh servers` PASS).
- `e2e/hel1675-shared-hover.spec.ts` on HEAD: 4/4 passed (touch and mouse, light and dark), with no RED verdicts and no
  "not under pointer".
- This cycle's delta has no CSS or UI change. The red-first and desktop-unchanged evidence from evaluation-1.md still
  applies:
  - On the parent CSS, 5/6 instances were RED in both themes.
  - The 1280 and 390 mouse hover probes were byte-identical between the parent CSS and HEAD.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- The module-level `touchMode` flag toggled in `beforeAll`/`afterAll` works per worker. A describe-scoped option would be
  less stateful. Optional.
