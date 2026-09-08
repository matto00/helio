## Skeptic Report — design gate (round 1, skeptic-design-1.md)

## What I verified (with evidence)

All measurements taken by me in this worktree at `3a0c0fe8` (`git log --oneline -1` confirms base;
`git status --porcelain` shows only the untracked change dir).

### 1. The premise — CONFIRMED EXACTLY
Ran my own walker over `frontend/src/**/*.css` (110 files), stripping comments with
`text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g," "))`:

- `theme.css` unique definitions: **81** ✓
- Unique `var(--*)` references, raw: **89** ✓ ; after comment-stripping: **88** (the delta is the
  false positive)
- Unresolved after stripping: **8** ✓ — exactly the 3 defects + 5 runtime-injected, at the exact
  files/counts claimed:
  `--radius-sm` PipelineDetailPage.css:524,543; `--text-small` :538; `--space-sm`
  AddSourceModal.css:111; plus the five overrides.
- Unresolved without stripping: **9**, the ninth being `--app-top-chrome-` ✓

The ticket's corrected 8/3 is right and the original 9/6 was wrong. Nothing downstream of the
premise is built on a bad number.

### 2. The three claimed red-on-`main` causes — ALL THREE CONFIRMED
(a) `--app-top-chrome-` appears only in the raw pass, never the stripped pass; the real
`--app-top-chrome-height` is defined at `theme.css:134`. ✓
(b) `--toast-exit-duration` / `--toast-intent-color` are the only two definitions outside
`theme.css` under a declaration-context extraction (83 − 81 = 2). Scoping to `theme.css` would
report both. ✓
(c) The 3 defects reproduce at the stated lines. Their targets exist and are unambiguous:
`--app-radius-sm` (theme.css:59), `--text-sm` (:25), `--space-*` scale (:43-52). ✓

### 3. Allowlist setters — all five traced to real assignments
`App.tsx:192`, `PanelList.tsx:272`, `PanelCard.tsx:29`, `PanelCard.tsx:34`,
`MobilePanelStack.tsx:104`. All five verified as setters, not sightings.

### 4. Deferrals are live
HEL-830 Backlog/open, HEL-732 Backlog/open (Linear). Real deferrals.

### 5. Existing precedent checked
- `motionTokenGuard.css.test.ts` has **0 exports** and no `:selftest` — D1's claim is accurate.
- Four `check:*:selftest` scripts exist and are wired into both `.husky/pre-commit` and
  `.github/workflows/ci.yml`. The convention is real.
- `.git` is a FILE here (`-rw-r--r-- ... 61 ... .git`) — the worktree hazard is real; no existing
  `check:*` script stats `.git` (the `isDirectory()` hits in `check-openspec-hygiene.mjs` are
  directory-walk logic, not repo-metadata probing). Task 1.4 is correct and no existing check
  violates it.

### 6. THE FOURTH CAUSE — FOUND (see CR1)
The naive definition regex `(--[\w-]+)\s*:` yields **99** definitions, not 83. The extra **16** are
BEM modifier class names in selectors, e.g. `.inline-connector-setup__btn--primary:hover`,
`.mfa-security-section__action-btn--danger:hover`,
`.pipeline-detail-page__run-status--queued::before`. They admit these as "defined tokens":
`--primary --secondary --ghost --text --table --cancel --save --collection --link --queued
--running --danger --active --settings --getting-started --signout`.

This is not a red-on-`main` cause — it is worse. It is a **fail-OPEN** hole in the guard, the exact
failure class the ticket exists to close: a future `var(--text)` or `var(--danger)` typo would
silently resolve against a selector fragment and pass. It is also why the design's own "83" number
is only reachable under an extraction rule the design never states.

## Verdict: REFUTE

The premise is sound and the three named causes are right. Three specific gaps must be closed
before implementation.

## Change Requests

1. **`design.md` D3 and `tasks.md` 1.3 must specify HOW a definition is distinguished from a BEM
   selector.** As written ("every `--x:` definition in the scanned CSS") the obvious implementation
   admits 16 selector fragments as tokens (evidence above), fail-open. Require declaration-context
   extraction — a custom-property definition is a `--name:` preceded by `{` or `;` (or start of a
   declaration block), not one preceded by an identifier character. Add a task asserting the
   definition set is **exactly 83** on untouched `main`, and a selftest case that
   `.foo__btn--primary:hover { }` does NOT define `--primary` (i.e. `var(--primary)` in a test
   fixture must still FAIL). Without that assertion this hole is invisible: the guard is green
   either way on `main`. Add the corresponding spec scenario under the resolution requirement.

2. **The selftest's sandbox seam is unspecified, and as written 4.3 is unimplementable.** Tasks 4.3
   requires `mkdtemp` and forbids mutating a tracked file, but task 1.1 fixes the guard's scan root
   at `frontend/src/**/*.css` with no configurable root — so a fixture in a temp dir is never
   scanned. Decide and record the seam explicitly: a CLI arg / env var scan-root the selftest passes
   (`node scripts/check-css-token-resolution.mjs <root>`), or export the extractor as a pure
   function the selftest feeds strings to. Note for the record: the `check:no-credential-leak`
   selftest's precedent does the opposite — it plants files inside the repo tree (gitignored paths),
   `finally`-guarded *plus* idempotently cleaned at startup. That precedent is safe only because of
   the double guard; do not follow the planting half of it. If any planting inside the repo tree
   survives the decision, adopt the startup-idempotent-cleanup half too, since `finally` does not
   run on SIGKILL.

3. **Resolve the D1 / task 1.2 contradiction about reusing `stripComments`.** Task 1.2 says "REUSE
   HEL-441's ... Do NOT write a third implementation", but D1 chose a root `.mjs` `check:*` script
   and `motionTokenGuard.css.test.ts` has **0 exports** — its `stripComments` is a file-local
   function in a TS Jest test. A `.mjs` root script cannot import it. State the decision: either
   extract `stripComments` to a shared module both consumers import (and update HEL-441's test to
   use it, in scope), or explicitly accept a second copy of the one-line regex and drop the "do not
   write a third implementation" imperative. Leaving it as-is hands the executor a task it cannot
   satisfy literally.

## Non-blocking notes

- **D1 is otherwise correct.** I looked for a way to get standing failability from a Jest test and
  the honest answer is that you can (assert the extractor against an in-memory string fixture —
  zero filesystem, zero sandbox hazard), but that is a *better* argument for CR2's pure-function
  seam than against `check:*`+`:selftest`. The `:selftest` choice matches the repo's convention,
  runs in CI, and D1's reasoning about HEL-441 having no selftest is factually verified. Keep it.
- `--mobile-panel-height` has a **second** setter: `MobilePanelStackSkeleton.tsx:34`. The allowlist
  entry naming only `MobilePanelStack.tsx:104` is not wrong, but naming both makes the entry survive
  removal of either.
- HEL-439 already shipped `frontend/src/theme/tokenAuditSweep.css.test.ts`, a sibling token guard
  the design does not mention. No overlap in what it checks (raw literals vs. reference resolution),
  so no conflict — but worth a sentence in design.md so the next reader does not have to rediscover
  which guard owns which property.
- Tasks 6.1 (untouched-`main` run) and 6.2 (mutation) do produce real evidence for each AC, and 6.3
  correctly steers off root `npm test`. With CR1's added assertion, the evidence set is complete.
