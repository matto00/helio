## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `e5f04b7130e1faf41c6ae40a2a68f627e2bb9ef9`. Review base, resolved live with `resolve-review-base.sh`
(main/origin): `24f6de4cf290c216c8ba94359f82d1d35ae88f2a`. `git diff 0de17a630 24f6de4cf` touches only the HEL-1181 test
and its archived change dir. `PanelCard.tsx` is the same at both commits, so 24f6de4cf is a valid identity base.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-panelcard-sync-specs/hel-1365`.
- **Module sizes (AC1)**, from `wc -l` at HEAD:
  - PanelCard.tsx: 325
  - PanelCardBody.tsx: 299
  - PanelCardHeader.tsx: 192
  - hooks/usePanelCardInspect.ts: 135
  - controlResultCountText.ts: 24

  All are under 400.
- **Moved-code identity (AC1)**, my own check, independent of `d3-identity-transcript.txt`:
  - **Multiset check.** I stripped whitespace from every line of base `PanelCard.tsx` and from every line of the 5
    new modules, then compared the two sets of lines with `comm`.
    - Lines found only in the base are import lines and comment lines, nothing else.
    - Lines found only in the new modules are imports, the props interface, prop and return plumbing, the hook's
      `useAppDispatch()`, new doc comments and repointed comments.
    - No logic line was added or removed.
  - **Ordered checks.** I diffed each base region against its new home after stripping indentation:
    - Base 76-372 against `PanelCardBody.tsx`: the only difference is the import header plus the
      `controlResultCountText` block moving out to its own file. That block matches `controlResultCountText.ts`
      exactly.
    - Base 449-546 against `usePanelCardInspect.ts`: the differences are the import header, the function signature
      plus `useAppDispatch()`, the return object, and 3 comment rewordings.
    - Base 604-727 against `PanelCardHeader.tsx`: the JSX is identical apart from 1 comment rewording.
    - Base 374-448 + 547-595 + 728-end against the new `PanelCard.tsx`: the differences are the inserted
      `usePanelCardInspect(...)` destructure and 2 comment rewordings.
- **Hook order and memo boundaries.**
  - The inspect hook is called at `PanelCard.tsx:116-127`. That is after `useState`/`useCallback` for fullscreen and
    before `useDataInvalid`, which is exactly where base lines 457-545 sat.
  - Inside the hook, the order of `useOutputMeta` → `useMemo` → `useCrossFilterServerOps` →
    `useCrossFilteredPanelData` → `useState` → `useCallback` ×4 is verbatim.
  - The only addition is a `useAppDispatch()` (a context read) at the top of the hook.
  - `PanelCard` and `PanelCardBody` both keep `React.memo`.
  - `PanelCardHeader` is deliberately not memoised and calls no hooks (`grep "use[A-Z]...("` finds only a comment).
    In the base this was inline JSX, so its re-render behaviour is unchanged.
- **Test diffs.** I read `git diff 24f6de4cf...HEAD -- '*.test.tsx'` in full:
  - 6 files change one line each, `import { PanelCardBody } from "./PanelCard"` → `"./PanelCardBody"`.
  - `PanelCard.test.tsx` has a comment-only change at lines 597-604.
  - The corrected comment now says the flush "does NOT by itself yield a settled baseline". It credits the
    identical-props `rerender` with absorbing the deferred render, and that matches the code right below it
    (line 616, HEL-1215 block).
  - The render-count assertions are untouched.
- **Comment repoints in non-moved files.** I spot-checked them against the code:
  - `PanelCardBody.tsx` passes `onLoadMore` (line 258), owns `EMPTY_CONTROLS` (line 57) and has the `role="status"`
    region (line 293).
  - `usePanelCardInspect.ts` owns the independent `useOutputMeta` call (line 33) and calls
    `useCrossFilteredPanelData`.

  They are accurate, and every one of these diffs changes comments only.
- **Specs (AC2/AC4).** I checked each claim against the code:
  - `resolvePanelChartType.ts:16-18` resolves the panel `chartType`, then the Output `config.chartType` if it is in
    `CHART_TYPES`, then `"line"`.
  - `PanelDetailModal.tsx:540` passes `showChartSection={false}`.
  - The only "Chart type" UI is in `ChartAppearanceEditor`, which is not mounted with its chart section in the modal.
  - The `panel-appearance-settings` MODIFIED delta replaces "renderers fall back to line" with the resolver order and
    adds 2 scenarios. Both are accurate.
  - The `chart-type-selector` delta REMOVES all 5 current requirements (the headers match the live spec exactly) and
    ADDS a "no selector" requirement.
  - The Purpose edit in `openspec/specs/chart-type-selector/spec.md` no longer describes a visible selector.
  - `openspec validate split-panelcard-sync-chart-specs --strict` reports the change is valid.
- **Item 3 (AC3).** `usePanelData.ts:215` derives `headers` as `Object.keys(rows[0])`, so "order by headers" would be
  a no-op. No code change shipped for item 3: no file outside the split/comment/spec set is in the diff. design.md D7
  records the owner question.
- **Gates (AC6)**, re-run by me at HEAD:
  - `npm run lint` (`--max-warnings=0`) exited 0.
  - `npm run typecheck` exited 0.
  - `nice -n 19 npx jest --config jest.config.cjs --maxWorkers=3 src/features/panels` gave 138 suites / 1412 tests
    passed. This includes every PanelCard*/PanelCardBody* suite and the merged HEL-1181 aggregatePieChart suite.
  - I relied on the evaluator's pasted full-suite output (468 suites / 4942 tests) for the rest. It is explicit and
    consistent with my subset.
- **UI (skeptic domain).**
  - `assert-phase.sh servers` returned PASS on 6797/9704.
  - The shared browser was still logged in as the evaluator's user, so I logged out and used my own fresh user.
  - Desktop 1440×900, in dark and then light:
    - The table and both bar-chart cards render with an identical header chrome (Refresh, Fullscreen, Actions,
      drag handle) and footer.
    - The Actions menu (rendered by `PanelCardHeader`) shows Inspect for chart panels, which proves
      `chartInspectConfig` flows from the extracted hook.
    - Inspect opens its "Nothing selected" empty state and closes on Escape.
    - The console showed 0 errors.
  - Light/dark parity holds, and no CSS or tokens were touched; the JSX moved verbatim.
  - The evaluator's base-vs-branch outerHTML and computed-style hash comparison (18 states, identical) is the
    stronger cohesion evidence. My screenshots are supplemental and not load-bearing: the CONFIRM rests on the
    content diffs above. They are `/home/matt/Development/helio/.playwright-mcp/hel1365-skeptic-{desktop-dark,desktop-light-menu,light-inspect}.png`.
  - I restored the browser's `helio-theme` localStorage to `dark`.
- **Dev-DB rows I created** (exact ids, left in place):
  - user `1dcbdee1-3da9-431f-b87e-960ca5b86ec9` (skeptic-hel1365-1791467010@test.local)
  - dashboard `8a64f1fd-9a87-48d4-9f96-167c2fba8235`
  - pipeline `294b3584-9901-452d-a2e3-e4dd7631db96`
  - source `0d222f38-a23f-4a67-ad83-2052dc860dea`

  The last three come from the finance template.

### Verdict: CONFIRM

### Non-blocking notes
- `usePanelCardInspect` returns a fresh object each render. That is harmless, because `PanelCard` destructures it
  immediately and every member is memoised or a stable callback.
- The change dir (with the spec deltas) is still untracked, as the orchestrator noted. It must be included in the
  delivery commit.
- Gate-defect check: no evidence here rests on mtime ordering. Identity rests on content diffs.
