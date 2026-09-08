# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `3bd81bc6`, base `origin/main` @ `3a0c0fe8`. Working tree clean before and
after every probe below (all mutations restored; `git status --short` empty).

## Phase 1: Spec Review — PASS

Issues: none blocking.

- **AC "fails on a newly introduced undefined token, demonstrated by mutation"** — reproduced
  independently. Appending `.evalprobe { color: var(--evalprobe); }` to `frontend/src/theme/theme.css`
  produced `theme/theme.css:370 references undefined token --evalprobe`, exit 1; restored, green.
- **AC "passes on `main` only once comment-stripping exists"** — task 6.1 reproduced from a clean
  `git archive origin/main frontend/src` extraction. The finished guard reported **exactly 4
  occurrences of the 3 known defects and nothing else** (`PipelineDetailPage.css:524 --radius-sm`,
  `:538 --text-small`, `:543 --radius-sm`, `AddSourceModal.css:111 --space-sm`); against the fixed
  tree, zero findings, exit 0. Zero false positives from the `MobileNavSheet.css:54-55` comment
  artifact, from the BEM selector class, or from the two `toast.css` definitions — i.e. all three
  independent red-on-`main` causes are genuinely handled, not merely masked by fixing the defects.
- **AC "a var() in a comment does not trip it, demonstrated against MobileNavSheet.css:54-55"** —
  selftest case (c) uses that exact wrap-mid-token shape; the corpus run confirms it live.
- **AC "each allowlist entry names the file that sets the token at runtime"** — all five setters
  traced independently, none copied: `--dashboard-background-override` App.tsx:192;
  `--dashboard-grid-background-override` PanelList.tsx:272; `--panel-surface-override`
  PanelCard.tsx:29; `--panel-text-override` PanelCard.tsx:34; `--mobile-panel-height`
  MobilePanelStack.tsx:104 (inline `CSSProperties`). Each is a real assignment, not a sighting.
- **AC "runs in CI, not only locally"** — `ci.yml:59-60` plus `.husky/pre-commit:19-20`.
- **Counts re-measured independently on this tree** (preconditions attached): theme.css defs **81**,
  all-scanned-CSS defs **83**; `var(--*)` unique refs **86 pre-strip / 85 post-strip** on the FIXED
  tree (89/88 on `main`, difference = the 3 defect names); naive matcher **100 pre-strip / 99
  post-strip** definitions = **17/16 spurious**, the pre-only extra being `--error`
  (ToolCallIndicator.css:81 comment prose). The 16 spurious names match design.md D3a's list
  exactly, `--text` included. After the fixes, the only unresolved references corpus-wide are
  precisely the 5 allowlisted ones.
- **Scope**: diff touches only the guard, its selftest, package.json, pre-commit, ci.yml, 4 CSS
  lines, and the change dir. No HEL-830/680/732 cleanup absorbed — no spacing-literal or unrelated
  token edits anywhere in the diff.
- **Tasks**: all 29 `[x]`; spot-checked 1.2a, 1.3a, 2.2, 4.2a, 4.2b, 4.3a, 4.3b, 4.4, 6.1, 6.2, 6.4
  against the diff and by re-execution — each has real implementation behind it (details in Phase 2).
  Task 7.1 (rebase) is a Delivery-phase action: `origin/main` has since advanced to `0826b4ae`
  (HEL-519). I ran the guard against that newer tree: it reports the same 4 known findings and no
  new ones, so the post-rebase tree stays green. Re-run at rebase time regardless.
- Spec delta and design.md match the implemented behavior, including the Gate-Chain checklist.

## Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` unset), with what each actually scans:

| gate | result | what it scans |
| --- | --- | --- |
| `npm run lint` | pass, 0 problems | `eslint . --max-warnings=0`; verified NOT vacuous for the new files — `npx eslint scripts/check-tokens*.mjs` resolves a config and exits 0, so both new scripts are genuinely linted |
| `npm run format:check` | pass | `prettier . --check`; both new scripts explicitly re-checked by name |
| `npm run typecheck` | pass | `tsc --noEmit` over `frontend/tsconfig.json` — note this does NOT cover the new `.mjs` scripts (no TS in this change; nothing lost) |
| `npm --prefix frontend test` | 281 suites / 2861 tests pass | frontend Jest only. Root `npm test` deliberately NOT cited: its root jest arm is `--passWithNoTests` and finds zero tests here |
| `npm run check:tokens` | pass on this tree | the new guard over `frontend/src/**/*.css` — which is 100% of the repo's CSS (verified: no `.css` outside `frontend/src` except node_modules) |
| `npm run check:tokens:selftest` | 10/10 pass | the guard's own failability |
| `scripts/concertino/test-gate-in-isolation.sh HEL-1037 scripts/check-tokens.mjs check:tokens` | PASS | pre-commit-shaped env in a disposable fixture repo |
| `scripts/concertino/check-gate-chain-change.sh . 3a0c0fe8 HEL-1037` | `GATECHAIN yes` + both scripts detected | gate-chain detection |

Backend gates: N/A (no `backend/**` change).

**Selftest failability re-proven by my own mutations** (four independent directions, each restored):

| mutation | selftest result |
| --- | --- |
| `stripComments` → identity | RED on (c) only |
| `REFERENCE_RE` → `var\(\s*(--[\w-]+)\s*\)` (fallback refs exempted) | RED on (f) only |
| `DECLARATION_RE` anchored to `^` only (drops `[{;]`) | RED on (g) and (i) |
| (orchestrator's) `DECLARATION_RE` → permissive fail-open form | RED on (a) and (b) |

So the selftest is not a green-only decoy: each guarantee has a case that fails for the right
reason and names the right token, and none of the cases pass on exit code alone.

Design decisions 1-6 all hold in the shipped code:

1. `DECLARATION_RE = /(^|[{;])[ \t\r\n]*(--[a-zA-Z0-9-]+)[ \t\r\n]*:/gm` (`check-tokens.mjs:51`) is
   declaration-anchored; measured against the corpus it extracts 83, not the naive 99.
2. Case (a) asserts set equality `== ["--real"]` over a controlled fixture, not a live count — and
   it is the mutation that catches the fail-open hole (confirmed above). No `definitions == 83`
   assertion exists anywhere (grep-verified).
3. Every failing case asserts the token named in the output; the two CLI cases assert output text,
   not just `status`.
4. `REFERENCE_RE` (`:72`) stops at the token name and never consumes a fallback; case (f) proves it.
5. Allowlist entries name setters, all five verified live (Phase 1).
6. `mkdtemp` in `os.tmpdir()` + `finally` (`:199-207`) + startup prefix sweep (`:41-53`). Case (j)
   forces a throw inside the run body and asserts the planted directory is **gone** — I confirmed
   the failure path, not only the success path, and `git status` stayed clean across every selftest
   invocation. No tracked file is ever written.

Gate-chain checklist vs implementation: read-only guard (no writes at all); reads no env var
(grep: zero `process.env` in either script); no `git` invocation and no `.git` access, so the
linked-worktree answer holds — both scripts were run from this linked worktree and behave
correctly; passes on first run (task 6.1 evidence above). The selftest cannot brick the commit path:
it plants nothing in the repo tree and its only destructive operation is scoped to
`os.tmpdir()/helio-tokens-selftest-*` directories.

Quality: DRY (`stripComments` deliberately ported with a provenance comment rather than editing
HEL-441's shipped guard — design D2, no shipped code refactored for a test); readable, no magic
values; small pure units with a thin `main()`; error output names file:line; no dead code, no
TODO/FIXME; no over-engineering. `check-tokens.selftest.mjs` is 298 lines, over the ~250 soft budget
but well under the ~400 split threshold and structured as one function per case — acceptable.

Issues: none blocking (see Non-blocking Suggestions).

## Phase 3: UI Review — N/A

`frontend/**` files changed, but the change is 4 CSS token references with no rendered-surface
behaviour to exercise, and the orchestrator scoped Phase 3 out. Judged instead by whether each
replacement matches the declaration's intent:

- `--radius-sm` → `--app-radius-sm` (PipelineDetailPage.css:524, :543). Correct: `--radius-sm` is
  undefined; `--app-radius-sm` (6px) is the file's dominant radius. **Correction to the executor's
  stated count**: the file has 30 `border-radius` declarations — 21 `--app-radius-sm` (including
  these two), 8 `--app-radius-md`, 1 `--app-radius-pill` — so "all 24 other sites" is wrong on both
  the number and the "all". The 19 other `sm` sites still make `sm` the right pick, and both fixed
  rules (a small icon button, a dashed hint box) sit among `sm` siblings.
- `--text-small` → `--text-xs`. Correct: no `small` step exists on the scale
  (`micro/xs/sm/base/lg/xl/2xl/3xl`), and `--text-micro` is verifiably reserved for uppercase tiny
  labels in this same file (`:466`, `:509`, both with `text-transform: uppercase`), which does not
  fit a readable italic hint sentence. `--text-xs` is the correct neighbouring step.
- `--space-sm` → `--space-2` (8px). Correct: `--space-sm` is undefined, and the cited precedent
  holds — `shared/chrome/ErrorBoundary.css` uses `margin: var(--space-2) 0 0;` for the equivalent
  hint paragraph.

## Overall: PASS

## Change Requests

None.

## Non-blocking Suggestions

1. `check-tokens.selftest.mjs:41-53` — the startup prefix sweep deletes **any**
   `os.tmpdir()/helio-tokens-selftest-*` directory, including one belonging to a concurrently
   running selftest in another worktree lane (this repo routinely runs parallel lanes). I could not
   reproduce a failure — 6 simultaneous and 12 staggered concurrent runs were all 10/10 green, so
   the window is narrow — but the race is real, and its symptom would be a spurious red pre-commit
   on an unrelated lane. Consider skipping entries whose mtime is under, say, an hour old, or
   embedding the pid in the prefix and sweeping only dead pids.
2. Same function — wrap the per-entry `rmSync` in `try/catch`. `force: true` suppresses `ENOENT`,
   not `EACCES`; on a shared `/tmp` a foreign directory matching the prefix would throw and take
   down a gate wired into `.husky/pre-commit`. A one-line catch keeps a sweep failure from
   ever blocking a commit.
3. `files-modified.md:21` — correct the "all 24 other `border-radius` sites" claim to the measured
   19 other `--app-radius-sm` sites (of 30 `border-radius` declarations), before it is quoted into
   the PR body. The conclusion is unaffected; the number is not.
