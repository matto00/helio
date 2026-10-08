## Standing Constraints

- [C1] Every factual sentence you write (code comment, README, commit message, `files-modified.md`) that states a count, a caller list, or "X is/is not used by Y" MUST be backed by a verification command that you ran in this session, with its raw output pasted into `openspec/changes/consolidate-reduced-motion-helper/verification-log.md` directly under the task number it supports. If the output disagrees with what this file predicts, STOP, do not write the sentence, and report the discrepancy in your return message — never "adjust" the sentence to sound right.
- [C2] Behaviour-preserving refactor. Do NOT change any logic, query string, or guard. Do NOT touch any `.css` file (sole exception: the comment-only edit in task 4.3), any file under `openspec/changes/archive/`, `useIsNarrowerThan.ts`'s code (only its doc comment, task 4.1), or any test other than the ones named below.
- [C3] Run every command from the worktree root with absolute paths or `git -C`. Never run root `jest --coverage`. Never `HUSKY=0`, never `git commit -n`. Use Bash `timeout: 600000` for test/lint/typecheck commands.

All commands below assume `W=/home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179`.

## 1. Baseline (before any edit)

- [x] 1.1 Record the baseline. Run exactly these and paste each command and its full output into `verification-log.md` under heading `## 1.1 baseline`:
  - `git -C "$W" grep -n "function prefersReducedMotion" -- frontend/src` — expected: exactly 2 lines (`frontend/src/shared/ui/Toast.tsx:18` and `frontend/src/utils/chartAppearance.ts:89`).
  - `git -C "$W" grep -n "prefersReducedMotion" -- frontend/src` — expected: 12 lines (the full list is the "before" picture for task 6.1).
  - `git -C "$W" grep -c "prefers-reduced-motion: reduce)\"" -- 'frontend/src/*.ts' 'frontend/src/*.tsx'` — lists each file containing the JS query string literal and its count.
  - `git -C "$W" grep -n -e "own private .prefersReducedMotion" -e "Toast.tsx..s .prefersReducedMotion" -e "Toast.tsx..s own .matchMedia" -- frontend/src` — stale-pointer probe; expected: exactly 3 lines, `frontend/src/hooks/useIsNarrowerThan.ts:6`, `frontend/src/shared/ui/toast.css:61`, `frontend/src/utils/chartAppearance.ts:83`. (Task 6.1 re-runs this and expects NO output.)
  If the first command does not print exactly 2 lines, STOP and report.

## 2. Create the shared module

- [x] 2.1 Create `frontend/src/utils/prefersReducedMotion.ts` with exactly this content (verbatim body from `chartAppearance.ts`):

  ```ts
  /** Live, one-shot read of the OS/browser reduced-motion preference — the one
   *  shared implementation (HEL-1179). Use it wherever JS (not CSS) has to
   *  honour `prefers-reduced-motion`, e.g. ECharts option config or a JS-timed
   *  exit animation; CSS should keep using its own `@media` block.
   *
   *  Guards `matchMedia` itself, not just `window` — jsdom (the test
   *  environment) doesn't implement it at all, so an unmocked test would
   *  otherwise throw rather than simply behaving as "no preference". */
  export function prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  ```

  Verify: `cat "$W/frontend/src/utils/prefersReducedMotion.ts"` and paste it under `## 2.1`.

- [x] 2.2 Create `frontend/src/utils/prefersReducedMotion.test.ts`. Move (cut, not copy) the whole `describe("prefersReducedMotion", () => { ... });` block from `frontend/src/utils/chartAppearance.test.ts` (currently lines 247-264) into the new file, unchanged, importing `{ prefersReducedMotion } from "./prefersReducedMotion"`. Then add one new `it` inside the same `describe`:

  ```ts
  it("returns false (and does not throw) when matchMedia is not implemented", () => {
    // jsdom has no matchMedia; simulate that explicitly regardless of setup files.
    Reflect.deleteProperty(window, "matchMedia");
    expect(() => prefersReducedMotion()).not.toThrow();
    expect(prefersReducedMotion()).toBe(false);
  });
  ```

  (The existing `afterEach` restores `window.matchMedia = originalMatchMedia`, which also covers this case. Use exactly `Reflect.deleteProperty` as shown — do NOT add any `eslint-disable` comment; lint runs with `--max-warnings=0` and an unused disable comment is a warning.)
  Then remove `prefersReducedMotion,` from the import list at the top of `chartAppearance.test.ts`.
  Verify: `git -C "$W" grep -n "prefersReducedMotion" -- frontend/src/utils/chartAppearance.test.ts` — expected: NO output. Paste the (empty) result under `## 2.2`.

## 3. Point callers at the shared module

- [x] 3.1 `frontend/src/utils/chartAppearance.ts`: delete the doc comment + function at lines 79-92 (`/** Live read of the OS/browser reduced-motion preference ...` through the closing `}` of `export function prefersReducedMotion`). Add `import { prefersReducedMotion } from "./prefersReducedMotion";` to the import block at the top of the file. Do NOT re-export it. Make sure you do not leave two consecutive blank lines where the function was removed. `applyHoverEmphasis`'s default parameter `reducedMotion: boolean = prefersReducedMotion()` stays exactly as is.
  Verify: `git -C "$W" grep -n "prefersReducedMotion" -- frontend/src/utils/chartAppearance.ts` — expected: exactly 2 lines (the import, and the default parameter). Paste under `## 3.1`.

- [x] 3.2 `frontend/src/features/panels/ui/buildChartOption.ts`: remove `prefersReducedMotion,` from the `../../../utils/chartAppearance` import list and add `import { prefersReducedMotion } from "../../../utils/prefersReducedMotion";`. The call on the `applyHoverEmphasis(built, themeTokens, prefersReducedMotion())` line is unchanged.
  Verify: `git -C "$W" grep -n "prefersReducedMotion" -- frontend/src/features/panels/ui/buildChartOption.ts` — expected: 2 lines (new import + the call). Paste under `## 3.2`.

- [x] 3.3 `frontend/src/shared/ui/Toast.tsx`: delete the private `function prefersReducedMotion(): boolean { ... }` (lines 18-26, including its 3-line comment). Add `import { prefersReducedMotion } from "../../utils/prefersReducedMotion";` to the import block. The call `if (prefersReducedMotion()) {` inside `dismiss` is unchanged. Make sure you do not leave two consecutive blank lines where the function was removed.
  Verify: `git -C "$W" grep -n "prefersReducedMotion\|matchMedia" -- frontend/src/shared/ui/Toast.tsx` — expected: exactly 2 lines (import + the call; NO `matchMedia` line left). Paste under `## 3.3`.

## 4. Doc pointers

- [x] 4.1 `frontend/src/hooks/useIsNarrowerThan.ts`: in the doc comment ONLY, replace the phrase `` `Toast.tsx`'s `prefersReducedMotion` guard convention`` with `` the guard convention of `utils/prefersReducedMotion.ts` `` (keep line wrapping within the comment sensible). Change nothing else in the file.
  Verify: `git -C "$W" diff -- frontend/src/hooks/useIsNarrowerThan.ts` — paste it under `## 4.1`; it must show changes only inside the `/** ... */` block.

- [x] 4.2 `frontend/src/utils/README.md`: add one new paragraph after the first paragraph, with exactly this shape: `` `prefersReducedMotion.ts` is the single shared reduced-motion read (HEL-1179), imported by <the files from the command below>. `` Do NOT call it "cross-feature" (the importers are one feature, `features/panels`, plus `shared/ui` and another util). BEFORE writing the sentence, run `git -C "$W" grep -ln -e 'utils/prefersReducedMotion"' -e '\./prefersReducedMotion"' -- frontend/src` and paste the output under `## 4.2`. The sentence must name exactly the non-test files that command prints (expected: `features/panels/ui/buildChartOption.ts`, `shared/ui/Toast.tsx`, `utils/chartAppearance.ts`) and nothing else. Do not edit any other sentence of the README (its first paragraph is known to be out of date; that is a separate follow-up, leave it alone).

- [x] 4.3 `frontend/src/shared/ui/toast.css`, comment ONLY: in the `/* HEL-535 D4 — ... */` comment above `@media (prefers-reduced-motion: reduce)` (lines 60-63), replace the text `` `Toast.tsx`'s own `matchMedia` check zeroes the`` with `` `Toast.tsx`'s own reduced-motion check (the shared `utils/prefersReducedMotion.ts`) zeroes the`` and re-wrap the comment lines so none exceeds ~100 characters. Change nothing outside that comment.
  Verify: `git -C "$W" diff -- frontend/src/shared/ui/toast.css` — paste under `## 4.3`; every `-`/`+` line must be inside the `/* ... */` comment.

## 5. Gates

- [x] 5.1 Targeted tests: `cd "$W/frontend" && nice -n 19 npx jest --maxWorkers=3 utils/prefersReducedMotion utils/chartAppearance shared/ui/Toast features/panels/ui/ChartPanel hooks/useIsNarrowerThan` — all pass. Paste the final summary lines (`Test Suites:` / `Tests:`) under `## 5.1`. The new suite must show 3 passing tests in `prefersReducedMotion.test.ts`.
- [x] 5.2 Prove the new absent-matchMedia test can fail: temporarily change the guard line in `prefersReducedMotion.ts` to `if (typeof window === "undefined") return false;`, run `cd "$W/frontend" && npx jest utils/prefersReducedMotion`, paste the failing summary under `## 5.2`, then restore the exact original line and re-run to green (paste that summary too). Verify restoration with `grep -c 'if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;' "$W/frontend/src/utils/prefersReducedMotion.ts"` — expected output `1` (the file is untracked, so `git diff` cannot show it). Paste under `## 5.2`.
- [x] 5.3 First run `cd "$W" && npx prettier --write frontend/src/utils/prefersReducedMotion.ts frontend/src/utils/prefersReducedMotion.test.ts frontend/src/utils/chartAppearance.ts frontend/src/utils/chartAppearance.test.ts frontend/src/shared/ui/Toast.tsx frontend/src/shared/ui/toast.css frontend/src/features/panels/ui/buildChartOption.ts frontend/src/hooks/useIsNarrowerThan.ts frontend/src/utils/README.md`. Then `npm --prefix "$W" run lint`, `npm --prefix "$W" run typecheck`, `npm --prefix "$W" run format:check` — all exit 0. Paste the last 5 lines of each under `## 5.3`.
- [x] 5.4 Full frontend Jest (no coverage): `cd "$W/frontend" && nice -n 19 npx jest --maxWorkers=3` — paste the `Test Suites:`/`Tests:` summary under `## 5.4`.

## 6. Final verification and commit

- [x] 6.1 (Amended by orchestrator after executor cycle 1 correctly found plain `git grep` cannot see the two new untracked files: every grep below uses `--untracked`.) Run and paste under `## 6.1`:
  - `git -C "$W" grep --untracked -n "function prefersReducedMotion" -- frontend/src` — expected: exactly 1 line, `frontend/src/utils/prefersReducedMotion.ts`.
  - `git -C "$W" grep --untracked -n "prefers-reduced-motion: reduce)\"" -- 'frontend/src/*.ts' 'frontend/src/*.tsx' ':!*.test.ts' ':!*.test.tsx'` — expected: exactly 1 line, in `prefersReducedMotion.ts`.
  - `git -C "$W" grep --untracked -n "prefersReducedMotion" -- frontend/src` — the full "after" list.
  - `git -C "$W" grep --untracked -n -e "own private .prefersReducedMotion" -e "Toast.tsx..s .prefersReducedMotion" -e "Toast.tsx..s own .matchMedia" -- frontend/src` — expected: NO output (no stale pointers).
- [x] 6.2 Run `git -C "$W" status --porcelain -- frontend` and paste under `## 6.2`. Expected exactly these 9 entries (order may differ):
  ` M frontend/src/features/panels/ui/buildChartOption.ts`, ` M frontend/src/hooks/useIsNarrowerThan.ts`, ` M frontend/src/shared/ui/Toast.tsx`, ` M frontend/src/shared/ui/toast.css`, ` M frontend/src/utils/README.md`, ` M frontend/src/utils/chartAppearance.test.ts`, ` M frontend/src/utils/chartAppearance.ts`, `?? frontend/src/utils/prefersReducedMotion.test.ts`, `?? frontend/src/utils/prefersReducedMotion.ts`.
  If it differs, STOP and report. Then write `openspec/changes/consolidate-reduced-motion-helper/files-modified.md` listing exactly those 9 repo-relative paths, one per line.
- [x] 6.3 Commit with message `HEL-1179 Consolidate prefersReducedMotion into one shared utility` (plus the Co-Authored-By trailer). Let the pre-commit hook run. If the hook fails, fix the cause and commit again — never bypass it.
