# Verification log — HEL-1179

## 1.1 baseline
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n function prefersReducedMotion -- frontend/src
frontend/src/shared/ui/Toast.tsx:18:function prefersReducedMotion(): boolean {
frontend/src/utils/chartAppearance.ts:89:export function prefersReducedMotion(): boolean {
exit=0

## 1.1 baseline
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n prefersReducedMotion -- frontend/src
frontend/src/features/panels/ui/buildChartOption.ts:8:  prefersReducedMotion,
frontend/src/features/panels/ui/buildChartOption.ts:233:  built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());
frontend/src/hooks/useIsNarrowerThan.ts:6: *  `Toast.tsx`'s `prefersReducedMotion` guard convention.
frontend/src/shared/ui/Toast.tsx:18:function prefersReducedMotion(): boolean {
frontend/src/shared/ui/Toast.tsx:48:    if (prefersReducedMotion()) {
frontend/src/utils/chartAppearance.test.ts:8:  prefersReducedMotion,
frontend/src/utils/chartAppearance.test.ts:247:describe("prefersReducedMotion", () => {
frontend/src/utils/chartAppearance.test.ts:256:    expect(prefersReducedMotion()).toBe(true);
frontend/src/utils/chartAppearance.test.ts:262:    expect(prefersReducedMotion()).toBe(false);
frontend/src/utils/chartAppearance.ts:83: *  own private `prefersReducedMotion` (same guard shape, same query; kept as
frontend/src/utils/chartAppearance.ts:89:export function prefersReducedMotion(): boolean {
frontend/src/utils/chartAppearance.ts:253:  reducedMotion: boolean = prefersReducedMotion(),
exit=0

## 1.1 baseline
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -c prefers-reduced-motion: reduce)" -- frontend/src/*.ts frontend/src/*.tsx
frontend/src/shared/ui/Toast.test.tsx:1
frontend/src/shared/ui/Toast.tsx:1
frontend/src/utils/chartAppearance.test.ts:1
frontend/src/utils/chartAppearance.ts:1
exit=0

## 1.1 baseline
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n -e own private .prefersReducedMotion -e Toast.tsx..s .prefersReducedMotion -e Toast.tsx..s own .matchMedia -- frontend/src
frontend/src/hooks/useIsNarrowerThan.ts:6: *  `Toast.tsx`'s `prefersReducedMotion` guard convention.
frontend/src/shared/ui/toast.css:61:   than merely shortening it; `Toast.tsx`'s own `matchMedia` check zeroes the
frontend/src/utils/chartAppearance.ts:83: *  own private `prefersReducedMotion` (same guard shape, same query; kept as
exit=0

## 2.1
$ cat /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179/frontend/src/utils/prefersReducedMotion.ts
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
exit=0

## 2.2
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n prefersReducedMotion -- frontend/src/utils/chartAppearance.test.ts
exit=1

## 2.2
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 diff --stat -- frontend/src/utils/chartAppearance.test.ts
 frontend/src/utils/chartAppearance.test.ts | 20 --------------------
 1 file changed, 20 deletions(-)
exit=0

## 3.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n prefersReducedMotion -- frontend/src/utils/chartAppearance.ts
frontend/src/utils/chartAppearance.ts:4:import { prefersReducedMotion } from "./prefersReducedMotion";
frontend/src/utils/chartAppearance.ts:239:  reducedMotion: boolean = prefersReducedMotion(),
exit=0

## 3.2
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n prefersReducedMotion -- frontend/src/features/panels/ui/buildChartOption.ts
frontend/src/features/panels/ui/buildChartOption.ts:11:import { prefersReducedMotion } from "../../../utils/prefersReducedMotion";
frontend/src/features/panels/ui/buildChartOption.ts:233:  built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());
exit=0

## 3.3
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n -e prefersReducedMotion -e matchMedia -- frontend/src/shared/ui/Toast.tsx
frontend/src/shared/ui/Toast.tsx:11:import { prefersReducedMotion } from "../../utils/prefersReducedMotion";
frontend/src/shared/ui/Toast.tsx:39:    if (prefersReducedMotion()) {
exit=0

## 4.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 diff -- frontend/src/hooks/useIsNarrowerThan.ts
diff --git a/frontend/src/hooks/useIsNarrowerThan.ts b/frontend/src/hooks/useIsNarrowerThan.ts
index 55762a207..8ad1c134d 100644
--- a/frontend/src/hooks/useIsNarrowerThan.ts
+++ b/frontend/src/hooks/useIsNarrowerThan.ts
@@ -3,7 +3,7 @@ import { useEffect, useState } from "react";
 /** Reads `window.matchMedia` for `(max-width: {breakpointPx - 1}px)` and
  *  stays live across resizes -- returns `false` (never throws) when
  *  `matchMedia` doesn't exist (jsdom/tests) or during SSR, matching
- *  `Toast.tsx`'s `prefersReducedMotion` guard convention.
+ *  the guard convention of `utils/prefersReducedMotion.ts`.
  *
  *  Genuinely reactive at runtime, not a CSS-hidden duplicate: a caller
  *  branching render logic on this (e.g. moving an action from an inline
exit=0

## 4.2
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -ln -e utils/prefersReducedMotion" -e \./prefersReducedMotion" -- frontend/src
frontend/src/features/panels/ui/buildChartOption.ts
frontend/src/shared/ui/Toast.tsx
frontend/src/utils/chartAppearance.ts
exit=0

## 4.3
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 diff -- frontend/src/shared/ui/toast.css
diff --git a/frontend/src/shared/ui/toast.css b/frontend/src/shared/ui/toast.css
index 1d4ce3126..73c347ae6 100644
--- a/frontend/src/shared/ui/toast.css
+++ b/frontend/src/shared/ui/toast.css
@@ -58,9 +58,10 @@
 }
 
 /* HEL-535 D4 — reduced motion disables the entrance/exit outright rather
-   than merely shortening it; `Toast.tsx`'s own `matchMedia` check zeroes the
-   exit delay under the same query so a dismissed toast doesn't sit in
-   layout, invisible, for `--toast-exit-duration` while unpainted. */
+   than merely shortening it; `Toast.tsx`'s own reduced-motion check (the
+   shared `utils/prefersReducedMotion.ts`) zeroes the exit delay under the
+   same query so a dismissed toast doesn't sit in layout, invisible, for
+   `--toast-exit-duration` while unpainted. */
 @media (prefers-reduced-motion: reduce) {
   .toast,
   .toast--exiting {
exit=0

## 5.1
$ cd "$W/frontend" && nice -n 19 npx jest --maxWorkers=3 utils/prefersReducedMotion utils/chartAppearance shared/ui/Toast features/panels/ui/ChartPanel hooks/useIsNarrowerThan

Test Suites: 12 passed, 12 total
Tests:       143 passed, 143 total
Snapshots:   0 total
Time:        21.835 s
Ran all test suites matching utils/prefersReducedMotion|utils/chartAppearance|shared/ui/Toast|features/panels/ui/ChartPanel|hooks/useIsNarrowerThan.
exit=0

$ cd "$W/frontend" && nice -n 19 npx jest --maxWorkers=3 --verbose utils/prefersReducedMotion   (per-file count check)
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        1.704 s, estimated 15 s
Ran all test suites matching utils/prefersReducedMotion.
exit=0

## 5.2
$ (mutate guard line to:   if (typeof window === "undefined") return false;)  then: cd "$W/frontend" && npx jest --maxWorkers=3 --verbose utils/prefersReducedMotion
FAIL src/utils/prefersReducedMotion.test.ts
  ● prefersReducedMotion › returns false (and does not throw) when matchMedia is not implemented

    expect(received).not.toThrow()

    Error name:    "TypeError"
    Error message: "window.matchMedia is not a function"

           9 | export function prefersReducedMotion(): boolean {
          10 |   if (typeof window === "undefined") return false;
        > 11 |   return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
             |                 ^
          12 | }
          13 |

      at prefersReducedMotion (src/utils/prefersReducedMotion.ts:11:17)
      at src/utils/prefersReducedMotion.test.ts:24:38
      at Object.<anonymous> (node_modules/expect/build/index.js:1824:9)
      at Object.throwingMatcher [as toThrow] (node_modules/expect/build/index.js:2235:93)
      at Object.<anonymous> (src/utils/prefersReducedMotion.test.ts:24:46)
      at Object.<anonymous> (src/utils/prefersReducedMotion.test.ts:24:46)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 2 passed, 3 total
Snapshots:   0 total
Time:        2.493 s
Ran all test suites matching utils/prefersReducedMotion.
exit=1 (expected non-zero)

$ (restore original guard line)  then: cd "$W/frontend" && npx jest --maxWorkers=3 --verbose utils/prefersReducedMotion
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        2.533 s, estimated 3 s
Ran all test suites matching utils/prefersReducedMotion.
exit=0

$ grep -c 'if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;' prefersReducedMotion.ts
1
exit=0

## 5.3
$ cd "$W" && npx prettier --write <9 changed files>
frontend/src/utils/prefersReducedMotion.ts 23ms (unchanged)
frontend/src/utils/prefersReducedMotion.test.ts 8ms (unchanged)
frontend/src/utils/chartAppearance.ts 22ms (unchanged)
frontend/src/utils/chartAppearance.test.ts 33ms (unchanged)
frontend/src/shared/ui/Toast.tsx 15ms (unchanged)
frontend/src/shared/ui/toast.css 20ms (unchanged)
frontend/src/features/panels/ui/buildChartOption.ts 19ms (unchanged)
frontend/src/hooks/useIsNarrowerThan.ts 2ms (unchanged)
frontend/src/utils/README.md 13ms (unchanged)
exit=0
$ diff -r <pre-prettier src snapshot> frontend/src   (checks whether prettier changed anything)
prettier made no changes

$ npm --prefix "$W" run lint   (last 5 lines)

> helio@0.7.4 lint
> eslint . --max-warnings=0

exit=0

$ npm --prefix "$W" run typecheck   (last 5 lines)


> helio-frontend@0.0.0 typecheck
> tsc --noEmit

exit=0

$ npm --prefix "$W" run format:check   (last 5 lines)
> helio@0.7.4 format:check
> prettier . --check

Checking formatting...
All matched files use Prettier code style!
exit=0

## 5.4
$ cd "$W/frontend" && nice -n 19 npx jest --maxWorkers=3   (full output)

Test Suites: 475 passed, 475 total
Tests:       4960 passed, 4960 total
Snapshots:   1 passed, 1 total
Time:        66.46 s
Ran all test suites.
exit=0

## 6.1
### PRE-AMENDMENT plain `git grep` run (executor cycle 1; kept for the record, not the 6.1 verdict)
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n function prefersReducedMotion -- frontend/src
exit=1

## 6.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n prefers-reduced-motion: reduce)" -- frontend/src/*.ts frontend/src/*.tsx :!*.test.ts :!*.test.tsx
exit=1

## 6.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n prefersReducedMotion -- frontend/src
frontend/src/features/panels/ui/buildChartOption.ts:11:import { prefersReducedMotion } from "../../../utils/prefersReducedMotion";
frontend/src/features/panels/ui/buildChartOption.ts:233:  built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());
frontend/src/hooks/useIsNarrowerThan.ts:6: *  the guard convention of `utils/prefersReducedMotion.ts`.
frontend/src/shared/ui/Toast.tsx:11:import { prefersReducedMotion } from "../../utils/prefersReducedMotion";
frontend/src/shared/ui/Toast.tsx:39:    if (prefersReducedMotion()) {
frontend/src/shared/ui/toast.css:62:   shared `utils/prefersReducedMotion.ts`) zeroes the exit delay under the
frontend/src/utils/README.md:11:`prefersReducedMotion.ts` is the single shared reduced-motion read (HEL-1179), imported by
frontend/src/utils/chartAppearance.ts:4:import { prefersReducedMotion } from "./prefersReducedMotion";
frontend/src/utils/chartAppearance.ts:239:  reducedMotion: boolean = prefersReducedMotion(),
exit=0

## 6.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep -n -e own private .prefersReducedMotion -e Toast.tsx..s .prefersReducedMotion -e Toast.tsx..s own .matchMedia -- frontend/src
exit=1

## 6.2
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 status --porcelain -- frontend
 M frontend/src/features/panels/ui/buildChartOption.ts
 M frontend/src/hooks/useIsNarrowerThan.ts
 M frontend/src/shared/ui/Toast.tsx
 M frontend/src/shared/ui/toast.css
 M frontend/src/utils/README.md
 M frontend/src/utils/chartAppearance.test.ts
 M frontend/src/utils/chartAppearance.ts
?? frontend/src/utils/prefersReducedMotion.test.ts
?? frontend/src/utils/prefersReducedMotion.ts
exit=0

## 6.1 DISCREPANCY NOTE
Expected 1 line for 'function prefersReducedMotion' and 1 line for the query literal (non-test); plain git grep returned none because prefersReducedMotion.ts is UNTRACKED (git grep searches tracked files only). Diagnostic re-run below uses --untracked, same pathspec. This is NOT a substitute for the tasks.md expectation; executor is stopping per C1.

## 6.1 diagnostic (--untracked)
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep --untracked -n function prefersReducedMotion -- frontend/src
frontend/src/utils/prefersReducedMotion.ts:9:export function prefersReducedMotion(): boolean {
exit=0

## 6.1 diagnostic (--untracked)
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep --untracked -n prefers-reduced-motion: reduce)" -- frontend/src/*.ts frontend/src/*.tsx :!*.test.ts :!*.test.tsx
frontend/src/utils/prefersReducedMotion.ts:11:  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
exit=0

## 6.1 diagnostic (--untracked)
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep --untracked -n prefersReducedMotion -- frontend/src
frontend/src/features/panels/ui/buildChartOption.ts:11:import { prefersReducedMotion } from "../../../utils/prefersReducedMotion";
frontend/src/features/panels/ui/buildChartOption.ts:233:  built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());
frontend/src/hooks/useIsNarrowerThan.ts:6: *  the guard convention of `utils/prefersReducedMotion.ts`.
frontend/src/shared/ui/Toast.tsx:11:import { prefersReducedMotion } from "../../utils/prefersReducedMotion";
frontend/src/shared/ui/Toast.tsx:39:    if (prefersReducedMotion()) {
frontend/src/shared/ui/toast.css:62:   shared `utils/prefersReducedMotion.ts`) zeroes the exit delay under the
frontend/src/utils/README.md:11:`prefersReducedMotion.ts` is the single shared reduced-motion read (HEL-1179), imported by
frontend/src/utils/chartAppearance.ts:4:import { prefersReducedMotion } from "./prefersReducedMotion";
frontend/src/utils/chartAppearance.ts:239:  reducedMotion: boolean = prefersReducedMotion(),
frontend/src/utils/prefersReducedMotion.test.ts:1:import { prefersReducedMotion } from "./prefersReducedMotion";
frontend/src/utils/prefersReducedMotion.test.ts:3:describe("prefersReducedMotion", () => {
frontend/src/utils/prefersReducedMotion.test.ts:12:    expect(prefersReducedMotion()).toBe(true);
frontend/src/utils/prefersReducedMotion.test.ts:18:    expect(prefersReducedMotion()).toBe(false);
frontend/src/utils/prefersReducedMotion.test.ts:24:    expect(() => prefersReducedMotion()).not.toThrow();
frontend/src/utils/prefersReducedMotion.test.ts:25:    expect(prefersReducedMotion()).toBe(false);
frontend/src/utils/prefersReducedMotion.ts:9:export function prefersReducedMotion(): boolean {
exit=0

## 6.1 (POST-AMENDMENT, --untracked; this is the 6.1 verdict)

## 6.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep --untracked -n function prefersReducedMotion -- frontend/src
frontend/src/utils/prefersReducedMotion.ts:9:export function prefersReducedMotion(): boolean {
exit=0

## 6.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep --untracked -n prefers-reduced-motion: reduce)" -- frontend/src/*.ts frontend/src/*.tsx :!*.test.ts :!*.test.tsx
frontend/src/utils/prefersReducedMotion.ts:11:  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
exit=0

## 6.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep --untracked -n prefersReducedMotion -- frontend/src
frontend/src/features/panels/ui/buildChartOption.ts:11:import { prefersReducedMotion } from "../../../utils/prefersReducedMotion";
frontend/src/features/panels/ui/buildChartOption.ts:233:  built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());
frontend/src/hooks/useIsNarrowerThan.ts:6: *  the guard convention of `utils/prefersReducedMotion.ts`.
frontend/src/shared/ui/Toast.tsx:11:import { prefersReducedMotion } from "../../utils/prefersReducedMotion";
frontend/src/shared/ui/Toast.tsx:39:    if (prefersReducedMotion()) {
frontend/src/shared/ui/toast.css:62:   shared `utils/prefersReducedMotion.ts`) zeroes the exit delay under the
frontend/src/utils/README.md:11:`prefersReducedMotion.ts` is the single shared reduced-motion read (HEL-1179), imported by
frontend/src/utils/chartAppearance.ts:4:import { prefersReducedMotion } from "./prefersReducedMotion";
frontend/src/utils/chartAppearance.ts:239:  reducedMotion: boolean = prefersReducedMotion(),
frontend/src/utils/prefersReducedMotion.test.ts:1:import { prefersReducedMotion } from "./prefersReducedMotion";
frontend/src/utils/prefersReducedMotion.test.ts:3:describe("prefersReducedMotion", () => {
frontend/src/utils/prefersReducedMotion.test.ts:12:    expect(prefersReducedMotion()).toBe(true);
frontend/src/utils/prefersReducedMotion.test.ts:18:    expect(prefersReducedMotion()).toBe(false);
frontend/src/utils/prefersReducedMotion.test.ts:24:    expect(() => prefersReducedMotion()).not.toThrow();
frontend/src/utils/prefersReducedMotion.test.ts:25:    expect(prefersReducedMotion()).toBe(false);
frontend/src/utils/prefersReducedMotion.ts:9:export function prefersReducedMotion(): boolean {
exit=0

## 6.1
$ git -C /home/matt/Development/helio/.claude/worktrees/task/consolidate-reduced-motion-helper/HEL-1179 grep --untracked -n -e own private .prefersReducedMotion -e Toast.tsx..s .prefersReducedMotion -e Toast.tsx..s own .matchMedia -- frontend/src
exit=1

## 6.2
$ git -C "$W" status --porcelain -- frontend
 M frontend/src/features/panels/ui/buildChartOption.ts
 M frontend/src/hooks/useIsNarrowerThan.ts
 M frontend/src/shared/ui/Toast.tsx
 M frontend/src/shared/ui/toast.css
 M frontend/src/utils/README.md
 M frontend/src/utils/chartAppearance.test.ts
 M frontend/src/utils/chartAppearance.ts
?? frontend/src/utils/prefersReducedMotion.test.ts
?? frontend/src/utils/prefersReducedMotion.ts
exit=0

## 6.2 files-modified.md (written; contents)
$ cat openspec/changes/consolidate-reduced-motion-helper/files-modified.md
frontend/src/features/panels/ui/buildChartOption.ts
frontend/src/hooks/useIsNarrowerThan.ts
frontend/src/shared/ui/Toast.tsx
frontend/src/shared/ui/toast.css
frontend/src/utils/README.md
frontend/src/utils/chartAppearance.test.ts
frontend/src/utils/chartAppearance.ts
frontend/src/utils/prefersReducedMotion.test.ts
frontend/src/utils/prefersReducedMotion.ts

