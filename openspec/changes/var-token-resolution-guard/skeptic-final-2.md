# Skeptic Report — final gate (round 2, skeptic-final-2.md)

Fresh cold agent. Every number below was measured by me in this worktree, not inherited from
ticket.md, design.md, evaluation-1.md or skeptic-final-1.md.

## What I verified (with evidence)

### 1. Round 1's CR is fixed, and no false count survives anywhere

- `grep -o 'border-radius:[^;]*;' frontend/src/features/pipelines/ui/PipelineDetailPage.css | sort | uniq -c`
  → **34 total: 21 `var(--app-radius-sm)`, 8 `--app-radius-md`, 1 `--app-radius-pill`, 4 literals
  (2× `50%`, `4px`, `1px`)**. Round 1's 34 was right; executor's 24 and evaluator's 30 were both
  wrong.
- `files-modified.md:21` now reads "matching the dominant radius token in this
  same file" — no count. 21/34 is in fact the dominant token, so the claim is true and does not rot
  on the next edit. Correct fix pattern (remove, don't replace with a fourth number).
- Swept every `all|every|only|exclusively|always|never|none` quantifier and every `N <noun>` count
  across `ticket.md`, `design.md`, `tasks.md`, `files-modified.md`, `specs/*/spec.md`. One
  overstatement found (non-blocking note 1); no other false count.

### 2. Every headline measurement re-derived on untouched `origin/main` @ `3a0c0fe8`

Extracted `frontend/src` from `origin/main` via `git archive` into a scratch dir and drove the
change's own exported extractors over it (110 CSS files):

| Claim | Precondition | Measured |
| --- | --- | --- |
| 81 tokens in `theme.css` | post-strip, declaration-position | **81** ✓ |
| 83 across all `frontend/src` CSS | same | **83** ✓; the 2 outside `theme.css` are exactly `--toast-exit-duration`, `--toast-intent-color` ✓ |
| 89 unique refs pre-strip / 88 post | unique names | **89 / 88** ✓; set difference is exactly `['--app-top-chrome-']` ✓ — the comment artifact, confirming the comment-stripping design driver |
| 8 genuinely unresolved | unique names, empty allowlist | **8 unique names / 16 occurrences**: the 5 runtime-injected + `--radius-sm`, `--text-small`, `--space-sm` ✓ |
| naive matcher 100−17 pre / 99−16 post | over-permissive `(--[a-z0-9-]+)\s*:` vs strict | **100 defs / 17 extra; 99 / 16** ✓ |
| 3 defects at `PipelineDetailPage.css:524,538,543` + `AddSourceModal.css:111` | — | exact line hits ✓ |

Every number in ticket.md and design.md reproduces, with its stated precondition.

### 3. Guard behaviour unchanged by the round-1 markdown-only fix

- `git diff origin/main...HEAD --stat`: the only non-artifact files are `scripts/check-tokens.mjs`,
  `scripts/check-tokens.selftest.mjs`, `package.json`, `.husky/pre-commit`, `.github/workflows/ci.yml`,
  and the two CSS files (6 + 2 lines). Working tree modification is `files-modified.md` only.
- `npm run check:tokens` → OK. `npm run check:tokens:selftest` → **10 passed, 0 failed**.

### 4. The selftest is a genuine standing proof (mutation-verified myself)

- **Guard mutation:** replaced `DECLARATION_RE` with the permissive fail-open form
  `/(--[a-zA-Z0-9-]+)\s*:/g` → selftest went **6 passed, 4 failed**, and — the check round 1 did not
  isolate — **`node scripts/check-tokens.selftest.mjs` exited 1**, not 0. So the failure genuinely
  propagates to `.husky/pre-commit` (`set -e`) and to CI, rather than printing FAIL and exiting
  green. Restored; `git diff --stat scripts/check-tokens.mjs` empty afterwards.
- **Real-corpus mutation:** copied `frontend/src` to a scratch dir, appended
  `.zz { color: var(--nope); }` to `app/App.css`, ran `node scripts/check-tokens.mjs <scratch>` →
  exit 1, `app/App.css:653 references undefined token --nope`. Ticket AC 1 satisfied against a real
  tree, not only a fixture.
- No stray fixture dirs left in `/tmp` after the forced-failure run (`ls /tmp | grep -c check-tokens`
  → 0), so case (j)'s cleanup claim holds in fact.
- Main guard is byte-exact `process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]`
  (`check-tokens.mjs:173`) — the round-3 paraphrase trap is not present in the shipped code.

### 5. All five allowlist entries name a real SETTER, traced to source

- `--dashboard-background-override` → `app/App.tsx:192` ✓
- `--dashboard-grid-background-override` → `features/panels/ui/PanelList.tsx:272` ✓
- `--panel-surface-override` → `features/panels/ui/PanelCard.tsx:29` ✓
- `--panel-text-override` → `features/panels/ui/PanelCard.tsx:34` ✓
- `--mobile-panel-height` → `features/panels/ui/grid/MobilePanelStack.tsx:104`, inline
  `CSSProperties`, verified by line-numbered read ✓ (the case the discipline rule was written for)

### 6. Wiring, gates, and the three fixes

- `package.json:28-29` adds `check:tokens` / `check:tokens:selftest` beside the sibling `check:*`
  scripts; `.husky/pre-commit` runs both before `npm test`; `ci.yml` runs both in the frontend job
  with a comment stating why CI matters independently of the hook (`git commit -n`). Both surfaces,
  as ticket scope item 4 and the last AC require.
- `npm run format:check`, `npm run lint`, `npm run typecheck` all **PASS** in this worktree.
- Frontend runtime tests are not implicated: the shipped product diff is 8 lines of CSS token
  substitution, no TS/TSX touched. (I did not rely on root `npm test`, whose root jest arm
  `--passWithNoTests` would have been silent here.)
- `design.md:187` carries the `## Gate-Chain Implications Checklist` the binding state requires, and
  its content matches the implementation (read-only guard, no env vars, `mkdtemp`-only writes).
- The 3 defect fixes are each correct: `--radius-sm`→`--app-radius-sm` ×2 (the file's dominant
  radius token, 21/34), `--text-small`→`--text-xs` (the file's dominant font-size token, **40** of
  57 `font-size: var(--text-*)` sites; `--text-micro` is 10px vs `--text-xs` 12px per
  `theme.css:23-24`), `--space-sm`→`--space-2` (`ErrorBoundary.css:49` is indeed
  `margin: var(--space-2) 0 0;` — citation verified line-exact).
- Nothing from HEL-830/HEL-680/HEL-732 is absorbed: no spacing literal, eyebrow recipe, or chip
  padding is touched anywhere in the diff. HEL-830 and HEL-732 confirmed **live in Linear
  (Backlog, not closed)**; HEL-680 is an open cross-reference inside HEL-830's own AC list.

## Verdict: CONFIRM

The guard is correct, its failability is proven on every commit and CI run (and the failure actually
exits non-zero), every headline measurement reproduces exactly against untouched `main` with its
precondition attached, all five allowlist entries name a traced setter, the three fixes are right,
and round 1's single CR is fixed in the durable way rather than with a fourth number. Safe to merge.

## Non-blocking notes

1. **`files-modified.md:24-25` overstates one supporting clause** — "the smaller `--text-micro`
   reserved for uppercase tiny labels". Measured: repo-wide **27 of 47** rules using `--text-micro`
   set `text-transform: uppercase`; within `PipelineDetailPage.css`, **2 of 6** — and the "sibling
   button" the sentence points at (`.pipeline-detail-page__root-column-remove-btn`) is itself *not*
   uppercase. `DESIGN.md:275` ties `--text-micro` to uppercase *eyebrows* specifically, which is
   narrower than "reserved for". The **choice is still right and independently supported** (10px is
   wrong for a readable italic placeholder sentence; `--text-xs` is the file's dominant size at
   40/57), so this is a wording overstatement in a delivery artifact, not a defect — but it is the
   same "right conclusion, over-stated supporting fact" class the workflow state's own final-gate
   lesson names. Suggested wording: "…the smaller `--text-micro` (10px), which DESIGN.md scopes to
   eyebrow-style labels and which is too small for a readable italic sentence."
2. `ticket.md:16` "**8** genuinely unresolved references" is unique *names*; there are 16
   occurrences. Unambiguous in context (the neighbouring bullet establishes unique-name framing) and
   the per-defect bullet gives occurrence counts, so no change needed — noted only because this
   ticket's own discipline rule is to attach the precondition to every count.
3. The workflow state's recorded **process defect** stands and is worth carrying forward: the
   evaluator raised the false count as change request #3 and returned PASS anyway. Worth watching on
   HEL-465/469 as flagged.
