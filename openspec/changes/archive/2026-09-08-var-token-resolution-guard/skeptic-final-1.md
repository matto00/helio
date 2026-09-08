## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold agent. Everything below is my own measurement in this worktree at HEAD `3bd81bc6`.
No UI surface in the diff, so no servers/Playwright (per instruction).

### What I verified (with evidence)

**1. Guard behaviour on ground truth (re-derived, not inherited).**
`npm run check:tokens` → `check-tokens: OK`. `npm run check:tokens:selftest` → `10 passed, 0 failed,
10 total`. Run from this LINKED worktree, where `ls -la .git` shows `-rw-r--r-- ... 61 .git` (a FILE).
Both pass on first run; neither script reads `.git` or `process.env` (`grep 'process.env|execSync|
spawnSync' scripts/check-tokens.mjs` → zero hits; the selftest's only `spawnSync` is its own CLI case).

**2. Untouched-`main` reproduction, independent of the evaluator.**
`git archive origin/main frontend/src` into a tmp dir, then `node scripts/check-tokens.mjs <that dir>`
→ exactly 4 findings, `exit=1`:
`PipelineDetailPage.css:524 --radius-sm`, `:538 --text-small`, `:543 --radius-sm`,
`AddSourceModal.css:111 --space-sm`. Nothing else. Against the fixed tree: zero findings, exit 0.
This distinguishes the three independent red-at-install causes, not just the defect fix.

**3. Non-allowlisted undefined token still fails on the REAL corpus (not a toy fixture).**
Copied `frontend/src` to tmp, appended `.zz-probe { color: var(--totally-undefined-xyz); }` to
`theme/theme.css`, ran the guard → `theme/theme.css:371 references undefined token
--totally-undefined-xyz`, `exit=1`. The tracked tree was never mutated (`git status --porcelain`
clean apart from the evaluator's untracked `evaluation-1.md`).

**4. Selftest failability — four independent mutations, all red (I mutated, ran, restored).**
Against a COPY of both scripts:
- naive `DECLARATION_RE = /(--[a-zA-Z0-9-]+)\s*:/g` (the fail-open BEM hole) → **8/10**, red on (a) and (b).
- `stripComments` → `return text;` → **9/10**, red on (c) with
  `MobileNavSheet.css:2 references undefined token --app-top-chrome-` — the exact day-one false positive.
- `REFERENCE_RE` tightened to `var\(\s*(--[a-zA-Z0-9-]+)\s*\)` (fallback exempts) → **9/10**, red on (f).
- `errors.push(...)` neutered → **6/10**, red on (b)(e)(f)(h).
So a wrong implementation cannot satisfy the 10 cases along any of the four axes the design is built
on. The `total !== 10` case-count guard (`selftest:...:281`) also prevents silently dropping cases.

**5. Sandbox / commit-path safety, including SIGKILL.**
Started the selftest, `kill -9` at 50ms. Result: repo tree clean (`git status --porcelain` unchanged);
ONE `helio-tokens-selftest-*` dir left in `/tmp` (outside the repo, as designed); the very next
selftest run swept it (`tmp leftovers after=0`) and still reported 10/10. Case (j)'s forced-throw path
verified by reading it: it asserts `!existsSync(plantedDir)` after a throw inside the run body, and it
passes. Nothing the selftest writes ever lands inside the repo.

**6. Allowlist — all five setters traced by me, not read off the comment.**
`app/App.tsx:192`; `features/panels/ui/PanelList.tsx:272`; `features/panels/ui/PanelCard.tsx:29` and
`:34`; `features/panels/ui/grid/MobilePanelStack.tsx:104` (inline `CSSProperties`). All five are real
assignments in non-test code. No allowlist entry is unjustified.

**7. Adversarial matcher probing — I constructed inputs, did not reason about them.**
Fed 16 hand-built cases through the exported extractors. Correct on: `@media`/`@supports`-scoped
declarations, declaration inline after `}`, multiline `var(\n --x\n )`, uppercase token names,
case-sensitivity (`--foo` ≠ `--FOO` — correct per spec), nested-fallback `var(--ok, var(--missing))`
(inner reference IS checked), a `--x:` inside a quoted string at declaration position, and a
selector-fragment decoy. Five divergences found, all FAIL-LOUD (false positive) rather than fail-open,
and all absent from the corpus — see non-blocking notes.

**8. Varied data (input no prior round fed it).** Ran the guard over `frontend/node_modules` (12 CSS
files, FontAwesome etc.) — it correctly reports the JS-injected `--fa-*` family and does not crash on
third-party CSS. Also checked coverage: there is NO `.css` anywhere in the repo outside
`frontend/src` (excluding node_modules), so the scan root has no blind spot in CSS. I additionally
ran the CSS definition set against `var(--*)` references in all non-test `.ts`/`.tsx` under
`frontend/src`: **0 unresolved** — so the tsx-inline surface is a scope note only, not a hidden defect.

**9. Scope / deferrals.** The diff touches exactly 4 CSS lines in 2 files. No token cleanup was
absorbed: no HEL-830 spacing-literal edits, nothing from HEL-680/HEL-732. Confirmed by reading the
full `git diff origin/main...HEAD -- frontend/`.

**10. Defect-fix intent.** `--radius-sm` → `--app-radius-sm`: the only radius scale in `theme.css:59`.
`--text-small` → `--text-xs` (0.75rem): `--text-small` does not exist; `PipelineDetailPage.css` uses
`--text-xs` 40×, `--text-sm` 11×, `--text-micro` 6× — `xs` is the dominant small size and `micro` is
reserved for tiny uppercase labels, so `xs` is defensible for an italic empty-state sentence.
`--space-sm` → `--space-2` (8px): `AddSourceModal.css`'s sibling hint/table rules use `--space-2`.
All three choices stand.

### Verdict: REFUTE

One committed artifact carries a false, spot-checkable count — the *same* one the evaluator raised as
its own change request #3 (`evaluation-1.md:144`) and then returned PASS anyway. It is documentation,
but it is documentation this ticket's own workflow-state explicitly ruled must not ship
("the PR body must not repeat the false count"), and it is the first thing a reader spot-checks.

### Change Requests

1. `openspec/changes/var-token-resolution-guard/files-modified.md:21` still reads
   `(×2, matching the token used at all 24 other 'border-radius' sites in this same file)`.
   My own count of `frontend/src/features/pipelines/ui/PipelineDetailPage.css`:
   **34** `border-radius:` declarations total — 21 `var(--app-radius-sm)` (including the two fixed),
   8 `var(--app-radius-md)`, 1 `var(--app-radius-pill)`, and 4 literals (`50%` ×2, `4px`, `1px`).
   So "24" is wrong, "all" is wrong, and note the evaluator's replacement figure of **30** is itself
   partial (it counted only the token-valued declarations and omitted the 4 literals). Replace with a
   count that carries its precondition, e.g. "matching the 19 other `border-radius` sites in this file
   that already use `--app-radius-sm` (of 34 `border-radius` declarations: 21 `sm`, 8 `md`, 1 `pill`,
   4 literals)". Do not let the "24"/"exclusively" phrasing reach the PR body either — `git log -1`
   confirms the commit message does not contain it, so only this file needs the edit.

### Non-blocking notes

- **Matcher divergences, all fail-loud, none present in the corpus today** (verified by grep: zero
  `@property`, zero `VAR(`, zero `&`-nesting, zero underscore custom-property names in
  `frontend/src/**/*.css`). Worth recording somewhere a future contributor will find them so a
  legitimate red is investigated rather than bypassed:
  (a) `@property --p { ... }` is not recognised as a definition → a legitimate `@property` token would
  be reported undefined; (b) native CSS nesting with a declaration inline after a nested rule's `}`
  (`.a{ .b{...} --n: 1px; }`) is missed for the same reason (`}` is not in the leading character
  class); (c) `var(--x)` inside a quoted string or `url("...")` is counted as a reference;
  (d) token names containing `_` are truncated at the underscore in both extraction and the error
  message; (e) `VAR(` (legal, case-insensitive CSS) is not matched — this one is the only *fail-open*
  of the five, and is vanishingly unlikely under Prettier.
- `--mobile-panel-height` has a **second** setter, `features/panels/ui/grid/MobilePanelStackSkeleton.tsx:34`,
  not just `MobilePanelStack.tsx:104`. The entry is still checkable and correct; naming both would make
  it harder to stale out.
- `evaluation-1.md` is untracked in the worktree (`git status --porcelain` → `?? .../evaluation-1.md`).
  Whether delivery artifacts get committed is the orchestrator's call, not a defect in this diff.
