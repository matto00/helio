## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `0b46ee0d2f2f898f07737972c7e95ecae513ca62`. Review base, resolved live with `resolve-review-base.sh`: `f3113ed454c4636dc466f7eb93deb976d30829a4`. The diff contains one commit (0b46ee0d2).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/consolidate-reduced-motion-helper/HEL-1179`.
- **AC1, exactly one implementation:** `git grep -n "function prefersReducedMotion\|prefersReducedMotion *=\|const prefersReducedMotion" HEAD -- frontend` returns one hit, `src/utils/prefersReducedMotion.ts:9`.
  - Repo-wide, a `prefers-reduced-motion` literal in non-test `.ts`/`.tsx` code appears only at `prefersReducedMotion.ts:11` and in a JSDoc mention at `chartAppearance.ts:230`. Other hits are in CSS-source tests and `Toast.test.tsx`.
  - A non-test `matchMedia` grep shows only the new module and `useIsNarrowerThan.ts`. The hook is a `(max-width)` hook, not a reduced-motion read, so the ticket premise of a third copy was stale, as the ticket note says.
- **AC1, all callers import it:**
  - `buildChartOption.ts:11` imports it and calls it at line 233.
  - `Toast.tsx:11` imports it and calls it at line 39.
  - `chartAppearance.ts:4` imports it and uses it as the default argument at line 239.
  - The re-export from `chartAppearance` was removed. Grepping for `prefersReducedMotion` outside `frontend/src`, the archive and this change dir returns nothing, so no consumer was left on the old export.
- **AC2, behaviour-preserving:**
  - The new body (`prefersReducedMotion.ts:10-11`) uses the same guard and query, token for token, as both removed copies. Toast's copy differed only in brace style.
  - `applyHoverEmphasis`'s default parameter is still evaluated at each call, so it remains a live read.
  - CSS changes: only the comment in `toast.css`. No markup changed. The visual output cannot change, so I did not start the app or take screenshots; there is no view to judge.
- **AC2, reduced-motion tests pass (fresh run, `nice -n 19`, `--maxWorkers=3`, no coverage):** `prefersReducedMotion.test.ts`, `chartAppearance.test.ts`, `Toast.test.tsx`, `toast.css.test.ts`, `motionTokenGuard.css.test.ts` and `buildChartOption*` gave 7 suites / 135 tests passed.
  - `Toast.test.tsx:277` is the D4 reduced-motion test. It mocks `matchMedia` globally, so it exercises Toast's call through the shared module. The evaluator's mutation run showed it goes red when the helper returns `false`.
  - The two moved test cases are byte-identical to the base. A third case was added for absent `matchMedia`.
- **Other gates (fresh):**
  - `npm run typecheck` (frontend) is clean.
  - `eslint --max-warnings=0` on the changed files exits 0.
  - `prettier --check` on the changed files reports "All matched files use Prettier code style!"
  - For the full suite I rely on the evaluator's pasted output (475 suites / 4960 tests). It is specific, and my targeted re-run agrees with it.
- **Every factual sentence the commit adds is true against the tree:**
  - README: the "single shared reduced-motion read … imported by `features/panels/ui/buildChartOption.ts`, `shared/ui/Toast.tsx`, and `utils/chartAppearance.ts`" sentence is true. It is the only JS reduced-motion read, and the importer list matches the grep exactly; the only other importer is the module's own test.
  - `toast.css` comment: "`Toast.tsx`'s own reduced-motion check (the shared `utils/prefersReducedMotion.ts`) zeroes the exit delay" is true. `Toast.tsx:39-42` dispatches `dismissToast` immediately and skips `TOAST_EXIT_MS`.
  - `useIsNarrowerThan.ts` doc comment: "matching the guard convention of `utils/prefersReducedMotion.ts`" is true. The guard at lines 17 and 24 is the same `typeof window === "undefined" || typeof window.matchMedia !== "function"`.
  - New module JSDoc:
    - "Live, one-shot read": true. It has no subscription and reads `.matches` on each call.
    - "the one shared implementation": true, per AC1.
    - "Guards `matchMedia` itself … jsdom doesn't implement it": true. `frontend/src/test/jest.setup.ts` has no `matchMedia` polyfill (grep returns nothing), so jsdom's absence of the API is what tests see.
  - New test comment: "jsdom has no matchMedia; simulate that explicitly regardless of setup files" is consistent with that. `Reflect.deleteProperty` makes the case independent of any future polyfill.
- **Scope:** 9 frontend files, matching `files-modified.md`. There are no archive edits and no change to the `useIsNarrowerThan` code, only its comment, so C2 is honoured.

### Verdict: CONFIRM

### Non-blocking notes
- The removed `chartAppearance.ts` JSDoc had a specific hazard note: `motionTokenGuard.css.test.ts` scans only `.css`, so ECharts motion is invisible to that guard. The new module says "wherever JS (not CSS) has to honour…", but the guard-blindness detail is gone. Consider one sentence in `applyHoverEmphasis`'s JSDoc. The evaluator raised the same point.
- `frontend/src/utils/README.md`: the new paragraph wraps at about 95 columns, while the surrounding prose wraps at about 75. This is cosmetic, and Prettier accepts it.
- `tasks.md` 6.3 is unticked, and several change-dir artifacts are untracked. The archive step must commit them.
- No dev-DB residue was created by this gate. I did not use Playwright or start servers.
