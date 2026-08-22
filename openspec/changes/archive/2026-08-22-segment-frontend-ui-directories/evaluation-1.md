# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `024ab7e5` on `task/segment-frontend-ui-directories/HEL-635`.
`BASE = git merge-base origin/main HEAD = 649f1490` (re-derived; `origin/main` has **not** advanced
past BASE, so task 7.6's merge step remains a no-op this cycle).

All evidence below is from my own fresh runs. Red-case mutation testing was performed in a
**throwaway detached worktree** at `024ab7e5`, never in the delivery worktree; it was removed on
completion (`git worktree list` verified clean). The delivery worktree's only dirty path at
start and end is the orchestrator's own `workflow-state.md`.

---

### Phase 1: Spec Review — PASS

Issues: none.

| AC | Verdict | Evidence |
| --- | --- | --- |
| 1 — pipelines segmented; `StepCard` stays at root | PASS | `stepConfigs/` 42, `computedFields/` 5, `schedule/` 5, `shapes/` 6, `proposalReview/` 6, root 37 = **101**. `pipelines/ui/StepCard.tsx` + `StepCard.test.tsx` present at the root. |
| 2 — `detailModal/` + `grid/`; four existing subdirs untouched | PASS | `detailModal/` 20, `grid/` 19, root 37 = **76** flat; **145** recursive. Zero rename lines touch `creationSteps/`, `creators/`, `editors/`, `renderers/` — the single entry is one `M` on `creationSteps/ShapeInstantiateStep.tsx`, a required import re-point disclosed in design D5, not a move. |
| 3 — `sources/ui/forms/` | PASS | `forms/` 13, root 17 = **30**. |
| 4 — every file accounted for | PASS | Whole-tree path-set assertion: 699 tracked `frontend/` paths = BASE tree + rename pairs, **exactly**; zero missing, zero extra. |
| 5 — moves + import updates only | PASS | 116 `R`, 0 `A`/`D` under `frontend/`. My own independent content audit (below) found the only non-specifier deltas are prettier trailing-commas on 4 files. |
| 6 — path-sensitive references swept | PASS | `jest.config.cjs`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.cjs`, `.husky/**`, `.github/workflows/**`, `scripts/check-*.mjs` all unchanged; no `paths`/`baseUrl`/`alias` exist to be stale. My own repo-wide re-sweep for old-path citations outside `frontend/src` returns **7 hits, all inside this change's own `skeptic-design-*.md`** planning records (historical, correctly untouched). All 21 `*.css.test.ts` `__dirname` reads resolve. |
| 7 — per-feature file count unchanged | PASS | 101 / 76 flat + 145 recursive / 30, identical to design D1 and to the BASE tree. |
| 8 — content identity proven per file | PASS | See Phase 2 gate section. |
| 9 — lint / test / build / format:check green | PASS | See Phase 2 gate section. |

`[PLANNER-ADDED]` items judged as disclosed planner choices, not ticket requirements:
`proposalReview/` (D2) and `grid/`'s 8 skeleton files (Planner Notes) are both consistent with the
ticket's own grouping principle and are correctly flagged in `ticket.md`, `design.md`, and
`files-modified.md`. No AC silently reinterpreted; no scope creep. All 22 task items are checked and
match what was implemented. The spec delta
(`specs/frontend-ui-directory-structure/spec.md`) describes exactly the implemented behaviour,
including the "no relocated file's content differs except in import/path-specifier lines" invariant
the gate enforces. Task 8.1's deliberately-stale backtick comment at
`frontend/src/features/pipelines/ui/PipelineDetailPage.css.test.ts:13` is present as declared.

---

### Phase 2: Code Review — PASS

Issues: none blocking.

#### Verification gates — all re-run by me in `WORKTREE_PATH`

| Gate | Result |
| --- | --- |
| `npm run lint` (`--max-warnings=0`) | exit 0, zero output |
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| `npm test` | **254 suites passed / 2751 tests passed**, exit 0 |
| `npm --prefix frontend run build` | exit 0 (the >500 kB chunk advisory is pre-existing vite/rolldown noise, unrelated) |
| `npm run format:check` | "All matched files use Prettier code style", exit 0 |
| `npm run check:repo-integrity` (new first pre-commit gate) | exit 0 |
| `npm run check:schemas` / `check:spec-structure` / `check:openspec` / `check:openspec:selftest` | all exit 0 |

**The test-count baseline was verified independently, not taken from the executor's report.** The set
of files matching jest's `testMatch` is **254 at BASE and 254 now** (`git ls-tree -r 649f1490` vs
`git ls-files`), and file content is byte-identical modulo specifiers, so the 2751 test count is
entailed rather than merely asserted.

#### `scripts/check-move-integrity.mjs` — not vacuous (the central question)

`node scripts/check-move-integrity.mjs` → exit 0:
`116 R entries` · `699 paths match exactly` · `131/131 files identical` · `623/623 sites in an
accepted form` · `623 sites resolved and compared`.

Each of the five properties I was asked to falsify holds, verified by reading the source **and** by
mutation:

- **BASE derivation** — line 73 is `git merge-base origin/main HEAD`, computed per run. Not `HEAD`,
  not a pinned SHA. The diff is taken as `git diff -M --name-status $BASE` (BASE → **working tree**),
  so it is non-vacuous post-commit and sees uncommitted changes.
- **Baseline path set** — line 137, `git ls-tree -r --name-only $BASE -- frontend/`, i.e. from
  `$BASE`'s **commit tree**, never the working tree. Not a tautology. Confirmed behaviourally: in red
  case (e2) the expected set still contained the pre-move path, which a working-tree-derived baseline
  could not produce.
- **Normalize-and-compare, not line-stripping** — lines 48–49 substitute the fixed-length, valid
  literal `"./__SPEC__"` (quote character preserved) on both sides, then prettier both sides, then
  byte-identity. Nothing is deleted from either side, so the round-1 over-consumption failure cannot
  recur.
- **Prettier error / unresolvable specifier = FAILURE, never a skip** — lines 208–218 fail on both a
  prettier throw and empty output; lines 404–417 fail on an unresolvable specifier on either side.
  Both were observed firing (below).
- **Specifier-target check is extension-aware** — `CANDIDATE_SUFFIXES` (line 338) resolves
  extensionless specifiers to the real on-disk path on both sides before comparison, so both sides
  are canonical by construction. 623/623 resolved with zero false mismatches on correct work.

**My own red cases (throwaway worktree, all reverted, `git status` clean after each):**

| Case | Mutation | Result |
| --- | --- | --- |
| (a) | change a token in a moved file (`stepConfigs/LimitConfig.tsx`) | FAIL — content check |
| (a2) | truncate a moved file's last 6 lines | FAIL — "prettier errored … JSX element 'span' has no corresponding closing tag" (proves the error-is-not-a-skip rule) |
| (a3) | whitespace-only change | checker green; **`prettier --check` flags it** (see suggestion 3) |
| (b′) | drop one named import from `grid/PanelGrid.tsx:7` | FAIL — content check |
| (c) | change a token in the in-place-modified `state/stepNarrowing.ts` | FAIL — content check (in-place files are genuinely in scope) |
| (d) | add `const stray = "./panelGridConfig";` in a non-import position | FAIL — substitution-site check (`8 literals, only 7 in an accepted form`), plus content + count checks |
| (e1) | **unstaged working-tree deletion** of `pipelines/hooks/useStepCardState.ts` | FAIL — **path-set check reports `Missing: [...]`** |
| (e2) | unstaged deletion of an unimported moved test file | FAIL — path-set check |
| (f) | run against a tree where `BASE == HEAD` (zero renames) | FAIL — `only 0 R entries … (need >= 116)` |
| (g) | swap `"./PanelGrid.css"` → `"./MobilePanelStack.css"` (both exist, same dir) | **content check 131/131 IDENTICAL *and* specifier-target check FAIL, in the same run** — exactly D6(g) |

**Point 1 — the case-(e) bug fix is present and load-bearing.** Lines 144–155 subtract
`git ls-files --deleted` from `git ls-files`, with a comment stating the index-vs-working-tree
rationale. I proved the fix is not decorative: with `useStepCardState.ts` deleted from disk but
unstaged, `git ls-files -- frontend/` **still returns 699 paths and still lists the deleted file**,
while `git ls-files --deleted -- frontend/` returns exactly that path. With the fix in place the
path-set check reports `expected 699 … got 698, Missing: ["…/useStepCardState.ts"]`. The check that
was previously blind now fires. Confirmed on two independent deletions, including one (e2) of a file
nothing imports, isolating the path-set check from the specifier-target check.

**Point 2 — no residue of the reported `git checkout --` specifier corruption.** I did not rely on
the green suite or on the executor's checker. I wrote an independent audit with a different
normalization (mask literals, then strip **all** whitespace) and an independent resolver:

- Content: across all 131 in-scope files, exactly **4** files differ beyond specifiers, and in every
  case the sole delta is a **trailing comma prettier adds when re-wrapping a single-line import that
  crossed `printWidth: 100`** — `detailModal/PanelDetailModal.appearanceSentinel.test.tsx`,
  `grid/PanelGrid.tsx`, `creationSteps/ShapeInstantiateStep.tsx`, `state/stepNarrowing.ts`. Design D4
  predicted "4 affected files"; the prediction is met exactly. No corrupted token, no dropped line,
  no truncation anywhere.
- Specifiers: **2293** relative specifiers across all of `frontend/src` (far wider than the in-scope
  set) — **0 dangling**. And for the 623 in-scope sites, resolving old-against-BASE and
  new-against-current and applying the rename map gives **0 mismatches**.

**Executor measurements confirmed independently:** 116 renames · 16 `M` (15 under `frontend/` +
`docs/compute-expression-grammar.md`) · **78** removed lines in those 15 files, and all 78 contain a
quoted relative literal (so not one non-specifier line was touched) · **623** substitution sites ·
131 in-scope files · 14 moved `.css` files containing **0** relative literals (design D4's claim) ·
101 / 76 flat + 145 recursive / 30. The physical `+` line count is 87 rather than 78 purely because
of the four prettier re-wraps above.

**Named structural checks:** `StepCard.{tsx,test.tsx}` at the `pipelines/ui/` root ✓ ·
`panels/ui/{creationSteps,creators,editors,renderers}` unmoved ✓ · all 5 `PanelDetailModal.*` CSS and
**both** `.css.test.ts` in `detailModal/` with nothing left at the panels root, and
`MobilePanelStack.css` + `MobilePanelStack.css.test.ts` together in `grid/` ✓ ·
`docs/compute-expression-grammar.md` is the only non-`frontend/` change apart from this change's own
`openspec/` artifacts and the checker, and its diff is the single expected line ✓.

**Standards.** `CONTRIBUTING.md` — no `any`, no dead imports, no leftover TODO/FIXME introduced;
the Imports & Qualifiers rule is Scala-scoped and unaffected. `DESIGN.md` mechanical rules
(tokens, spacing/type scales, shared components) are satisfied **by construction**: no CSS byte
changed and no component body changed. DRY / readability / modularity / type safety / security /
error handling are all unchanged by a behaviour-preserving move. Behaviour-preserving-when-expected
is the strongest finding here: the diff genuinely only moves and re-points, with zero drive-by
behaviour changes.

---

### Phase 3: UI Review — PASS

Issues: none.

Servers started via `scripts/concertino/start-servers.sh` (READY backend `:8974`, READY frontend
`:6067`); `assert-phase.sh servers` → `PASS servers`. (`emit-event.sh: No such file or directory` is
the known gitignored-`scripts/concertino/` condition recorded in `workflow-state.md`'s
`SCRIPTS_NOTE`, not a server failure.)

Every relocated group was exercised live, not merely imported:

- `grid/` — dashboard renders `PanelGrid`/`PanelCard` at 1440 and 1100; `MobilePanelStack` +
  `BottomNav` at 768 and 375. No layout breakage at any of the four widths.
- `detailModal/` — panel detail modal opens; **Edit** mode renders the APPEARANCE, DATA/binding and
  section surfaces, i.e. all 5 relocated stylesheets resolve.
- `stepConfigs/` — `/pipelines/:id` renders `StepCard`s; expanding "Date bucket" renders
  `DateBucketConfig` with its field/granularity/output controls.
- `schedule/` — actions menu → "Edit schedule" renders `PipelineScheduleDialog` **including the
  relocated `schedulePreview` output** ("Next run: Aug 21, 2026, 10:11 PM").
- `shapes/` — "Start from a shape" renders `ShapePickerModal`; choosing Top N renders
  `ShapeParamsFields`.
- `proposalReview/` — `/pipeline-proposals/review` renders the **lazy** `PipelineProposalReviewPage`
  (the one changed line in `app/AppRoutes.tsx`, a dynamic import — the specifier form that fails
  only at runtime) plus `PipelineProposalReview`/`PipelineProposalSummary` and their CSS.
- `computedFields/` — `/registry/:id` → "+ Add" renders `ComputedFieldsEditor` + `ComputedFieldForm`.
- `forms/` — Add data source renders `RestApiForm`; switching to SQL Database renders `SqlTab` with
  its own stylesheet intact.
- Unhappy path: an unknown route renders the "Page not found" state with a "Back to dashboards"
  action — no blank screen, no unhandled exception.
- **Console: 0 errors, 0 warnings** across the tested flows on `:6067`. (A large error list is
  visible in the shared Playwright session, but every entry originates from `localhost:5960` — a
  different worktree's dev server, the known parallel-session artifact — not from this build.)
- One React DOM `validateDOMNesting` error (`<form>` nested inside `<form>`:
  `TypeDetailPanel` → `ComputedFieldsEditor` → `ComputedFieldForm`) is **pre-existing, not a
  regression**: both `<form>` tags exist at identical line numbers at BASE
  (`TypeDetailPanel.tsx:128`, `ComputedFieldForm.tsx:90`) and the content check proves the bodies are
  byte-identical. Raised as a suggestion, not a change request.
- Accessible names present on the interactive elements exercised ("Add source", "Pipeline actions",
  "Enable schedule", "Schedule kind", "Computed field form"); `Escape` closes modals. Unchanged by
  construction, since no component body changed.

---

### Overall: PASS

This is a genuinely pure structural move, and — unusually — that claim is backed by evidence rather
than by a green suite. The move-integrity gate is real: I falsified it ten different ways and it
failed in every case it was designed to catch, including the silent ones. The case-(e) fix is
present, correct, and demonstrably load-bearing.

### Change Requests

None.

### Non-blocking Suggestions

1. **`scripts/check-move-integrity.mjs` becomes a permanently-failing script once this merges.** It
   is hard-scoped to HEL-635 (`CHANGE_DIR_PREFIX`, `MIN_RENAMES = 116`, `NON_FRONTEND_M_ALLOWED`),
   so after the squash-merge any future branch's `merge-base origin/main HEAD` yields 0 renames and
   it exits 1 by construction. It is **not** wired into `package.json`, `.husky/pre-commit`, or CI,
   so nothing breaks — but it is the only change-scoped one-shot among six repo-wide gates in
   `scripts/`, and a future reader may mistake it for a live gate. Consider deleting it (or moving it
   under the change dir) at archive time; its header already says "for HEL-635", which mitigates.
2. **`canonicalizeExt` (lines 361–366) is a no-op** that returns its argument. The comment explains
   why, but an identity function called at two sites reads as vestigial; inlining it and keeping the
   comment at the comparison site would be clearer. The file is also 448 lines against
   `CONTRIBUTING.md`'s ~250-line soft budget / ~400-line "propose a split" threshold — acceptable
   here given ~120 lines are load-bearing rationale comments and the checks are a single sequential
   pipeline, but worth calling out in the PR description as the standard asks.
3. **The content check is insensitive to changes prettier normalizes away** (verified: a
   double-space insertion in a moved file passes). This is an inherent consequence of D4's
   prettier-both-sides rule, not a defect — and the residual class is exactly what `format:check`
   independently catches (it flagged the same mutation). Worth stating explicitly in D4 so a future
   reader does not over-trust the gate in isolation.
4. **Two stale comments** are now worth a follow-up ticket together: task 8.1's
   `PipelineDetailPage.css.test.ts:13` backtick reference to the moved
   `../../panels/ui/PanelDetailModal.css.test.ts`, and the pre-existing misleading filename
   `PanelDetailModal.css.test.ts` (it reads `PanelDetailModal.mobile.css`). Both are correctly out of
   scope here — editing either would make the content check fail, which is the gate working as
   designed.
5. **Pre-existing nested-`<form>` DOM-nesting error** on the Data Types detail page (see Phase 3).
   Unrelated to this change; a candidate spin-off.
6. **`docs/compute-expression-grammar.md` is now the precedent** for docs citing `ui/` paths. Since
   `stepConfigs/` did not exist before, the pipeline-op wiring checklist under `~/` (Planner Notes)
   still records no path strings and needs nothing — correctly left for explicit user approval rather
   than edited unilaterally.
