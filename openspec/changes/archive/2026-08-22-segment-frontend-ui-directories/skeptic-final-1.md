## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: `024ab7e5` on `task/segment-frontend-ui-directories/HEL-635`.
`BASE = git merge-base origin/main HEAD = 649f1490` — re-derived by me, not read from
`workflow-state.md` (which records it as the *expected* value). `origin/main == BASE == HEAD~1`'s
merge target, so task 7.6's merge step is still a no-op. I did **not** `git fetch`: advancing
`origin/main` mid-review would move `BASE` under the gate I am here to check.

Everything below is from my own fresh runs in `WORKTREE_PATH`. I read the executor's
`files-modified.md` and `evaluation-1.md` as claims and re-derived every number independently. I
modified no code; my only writes were this report, a throwaway audit script in a scratchpad outside
the repo, and 15 screenshots which I deleted (verified: `ls hel635-skeptic-*.png` → 0 files).

---

### What I verified (with evidence)

#### 1. The gates, re-run by me

| Gate | Command | Result |
| --- | --- | --- |
| lint | `npm run lint` (`eslint . --max-warnings=0`) | exit 0, zero output |
| typecheck | `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| test | `npm test` | `Test Suites: 254 passed, 254 total` / `Tests: 2751 passed, 2751 total`, exit 0 |
| build | `npm --prefix frontend run build` | `✓ built in 276ms`, `PWA v1.3.0 … precache 28 entries`, exit 0 |
| format | `npm run format:check` | `All matched files use Prettier code style!`, exit 0 |
| move-integrity | `node scripts/check-move-integrity.mjs` | exit 0 (output below) |
| the other six repo gates | `check:repo-integrity`, `check:schemas`, `check:spec-structure`, `check:openspec`, `check:openspec:selftest`, `check:scala-quality` | all exit 0 |

Note for the record: `npm run build` at the repo root is **not** a script (`npm error Missing
script: "build"`). The build gate is `npm --prefix frontend run build`, which is what the evaluator
ran and what I ran. Not a defect in the change — a detail of this repo's script layout.

```
BASE = 649f149035c89ba0b40541cfa9165540f826412c (git merge-base origin/main HEAD, re-derived this run)
Non-vacuity OK: 116 R entries (>= 116).
Whole-repo status assertion OK: 116 renames (all under frontend/), 30 other entries, all accounted for.
Whole-tree path-set assertion OK: 699 paths match exactly.
Content check: 131/131 files identical (normalize + prettier both sides).
Substitution-site check: 623/623 sites in an accepted form across 131 in-scope files (design.md D4 measured baseline: 623 sites).
Specifier-target check: 623 sites resolved and compared across 131 in-scope files.
check-move-integrity: all checks passed.
```

**The 254-suite baseline is derived from `$BASE`'s tree, not from anyone's report:**

```
BASE test files:     254   (git ls-tree -r --name-only 649f1490 -- frontend/src | grep -E '\.test\.tsx?$')
HEAD test files:     254
worktree test files: 254   (git ls-files);  untracked test files: 0
```

`frontend/jest.config.cjs`'s `testMatch` is `<rootDir>/src/**/*.test.ts(x)` — recursive, so the
matched set is exactly those 254 files, at BASE and now. The 2751 test count is then *entailed* by
file-content identity (§2), not merely asserted.

#### 2. Independent content audit — different normalization, different resolver

I did not re-run the committed checker and call it verification. I wrote my own audit
(scratchpad, outside the repo) using a **strictly stronger** normalization: mask quoted relative
literals, then strip *all* whitespace. Prettier-both-sides additionally erases trailing commas,
quote style and parens; whitespace-stripping does not. Results:

```
renames=116 mods=16 adds=14
Files differing beyond specifiers+whitespace: 4 of 131
relative specifiers across frontend/ at HEAD: 2293, dangling: 0
in-scope specifier sites: 623, mismatches: 0
```

All 4 deltas are a single added trailing comma in a named-import list — the exact prettier re-wrap
design.md D4 predicted for the imports that crossed `printWidth: 100`. First divergence in each,
verbatim from my audit:

- `detailModal/PanelDetailModal.appearanceSentinel.test.tsx` — `…panelTextEditorFallback}` → `…panelTextEditorFallback,}`
- `grid/PanelGrid.tsx` — `…PanelUpdatesFlushHandle}` → `…PanelUpdatesFlushHandle,}`
- `creationSteps/ShapeInstantiateStep.tsx` — `…ShapeParamsFields}` → `…ShapeParamsFields,}`
- `state/stepNarrowing.ts` — `…DateBucketConfigValue}` → `…DateBucketConfigValue,}`

Semantically inert, and the count matches D4's prediction of exactly 4 files. **No dropped line, no
truncation, no altered token anywhere else in 131 files.** 0 dangling specifiers across all 2293
relative imports in `frontend/` (far wider than the in-scope set), and 0 old→new target mismatches
across all 623 in-scope sites under my own resolver.

Also verified by hand, because the checker does *not* content-check it (§4, note 2): the single
non-`frontend/` modification is one line —

```
-and the frontend (`frontend/src/features/pipelines/ui/ComputeFieldConfig.tsx`) for the
+and the frontend (`frontend/src/features/pipelines/ui/stepConfigs/ComputeFieldConfig.tsx`) for the
```

`git diff -M --summary $BASE HEAD` shows **no mode changes** — only the 14 `create mode` lines for
the openspec artifacts and the checker.

#### 3. Acceptance criteria — each traced to evidence

| AC | Verdict | Evidence I produced |
| --- | --- | --- |
| 1 — pipelines segmented; `StepCard` at root | MET | `stepConfigs/` 42 (21 ops incl. `AssertConfig`), `computedFields/` 5, `schedule/` 5, `shapes/` 6, `proposalReview/` 6, root 37 = **101**. I listed all six directories member-for-member. `StepCard.tsx` + `StepCard.test.tsx` are in the root listing. `ComputeFieldConfig.*` is in `stepConfigs/` and `ComputedField*` in `computedFields/` — not conflated. |
| 2 — `detailModal/` + `grid/`; four existing subdirs untouched | MET | `detailModal/` 20, `grid/` 19, root 37 = **76** flat; +`creationSteps` 8 +`creators` 4 +`editors` 37 +`renderers` 20 = **145** recursive. For each of the four pre-existing subdirs I `diff`ed the BASE tree path set against the current one: **IDENTICAL path set** for all four, and the only content entry across all four is `M creationSteps/ShapeInstantiateStep.tsx` — the disclosed D5 import re-point, whose whole delta is one specifier plus one trailing comma (§2). |
| 3 — `sources/ui/forms/` | MET | `forms/` 13, root 17 = **30**; listed member-for-member. |
| 4 — every file accounted for | MET | BASE per-directory counts measured by me: pipelines **101**, panels **76** flat, sources **30** — identical to the post-move totals. Whole-tree path set: 699 tracked `frontend/` paths = BASE tree + rename pairs, exactly. `git diff -M --name-status` over the whole repo yields **116 R / 16 M / 14 A and zero D, T or C**. Nothing orphaned by omission. |
| 5 — moves + import updates only | MET | §2: 4 files differ beyond specifiers, all trailing-comma-only. 116 recorded as renames, not A+D. No CSS byte changed (all 14 moved `.css` files are content-identical). |
| 6 — path-sensitive references swept | MET | `jest.config.cjs` `testMatch` recursive and all 6 `moduleNameMapper` keys extension/module-name based, never directory-based. **No `paths`/`baseUrl` in any tsconfig and no `alias`/`resolve` in `vite.config.ts`** (grep returned nothing). All 21 `*.css.test.ts` `__dirname` reads resolve on disk. Repo-wide grep for old-path citations outside `frontend/src`: every hit is either an **archived** `openspec/changes/**` record (correctly untouched, historical) or this change's own planning docs. `docs/uploads.md` (`markdownUrls.ts`) and `notes/mobile-pwa-handoff.md` (`renderers/`) cite paths that genuinely did **not** move — I confirmed both targets exist at the cited paths. |
| 7 — per-feature count unchanged | MET | 101 / 76 flat + 145 recursive / 30 at BASE and at HEAD. |
| 8 — content identity per file | MET | §2 — proven by my own independent mechanism, not by the committed checker. |
| 9 — lint / test / build / format:check green | MET | §1, all re-run by me. |

`[PLANNER-ADDED]` items judged as disclosed planner choices, not ticket requirements:
`proposalReview/` (6 files, all postdating the ticket) and `grid/`'s 8 skeleton files. Both follow
the ticket's own grouping principle, both are flagged in `ticket.md`, `design.md` and
`files-modified.md`, and neither pulls in work beyond the three directories. I have no objection to
either. Task 8.1's deliberately-stale backtick comment is present exactly as declared at
`frontend/src/features/pipelines/ui/PipelineDetailPage.css.test.ts:13` and is indeed a code-span in
a comment, not a quoted specifier — correctly out of scope.

#### 4. Attacking the checker everyone has now blessed

I read all 448 lines of `scripts/check-move-integrity.mjs` and reasoned about what could survive
all six of its assertions simultaneously. **My honest answer: no meaningful corruption class
survives.** I am not manufacturing a finding. Specifically, I traced and closed these candidates:

- *Change to a literal outside an accepted form* — masked by the content check, but the site check
  counts raw literals against accepted-form-covered ones on the new side and fails when a literal
  sits anywhere else.
- *Literal deleted from a non-accepted position* — site counts stay consistent, but the masked
  content then genuinely differs → content check fails.
- *Import added or removed* — content check fails, and the specifier-target check's literal-count
  comparison fires independently.
- *Reordered specifiers* — line order survives prettier, so the content check fails.
- *Two moved files' contents swapped* (git would pair the renames crosswise, making the content
  check compare each against the other and report identical) — the rename map then **inverts the
  expected specifier target**, so the specifier-target check fails. I checked the precondition that
  makes this reliable: **all 14 moved `.css` files have at least one importer** (`PanelGrid.css` 4,
  `PipelineProposalReview.css` 2, the rest 1 each), so there is no unimported file for which this
  class could hide. For code modules `tsc` catches it too.
- *Wrong-depth specifier resolving to a real but different file* — the whole reason the
  specifier-target check exists; 623/623 resolved under my resolver as well as the checker's.

Two residuals I will state plainly rather than dress up as findings:

1. **The checker is insensitive to anything prettier normalizes away** (whitespace, semicolons,
   quote style, trailing commas, redundant parens). Every member of that class is semantically
   inert *and* independently caught by `format:check`, which I ran green. This is inherent to D4's
   prettier-both-sides rule and is correctly the price of not producing false failures on the four
   legitimate re-wraps.
2. **`docs/compute-expression-grammar.md` is status-asserted, not content-checked.** The status
   assertion allows it as an `M` outside `frontend/`; nothing in the script verifies the diff is the
   one expected line. The docblock and design.md both *say* it is one line, but the gate does not
   prove it. I proved it by reading the diff (§2). Not a defect worth changing — just a limit a
   future reader should not over-trust.

And one observation nobody has stated, which I think is the more useful framing than any of the
above: **the checker proves the moves were _faithful_, not that they were _correct_.** A file moved
into the wrong destination subdirectory — say `SortConfig.tsx` into `shapes/` — passes every one of
the six assertions: it is a rename, the path set matches baseline-plus-renames, the content is
identical, and the specifiers re-point consistently. Placement correctness is an *acceptance-criteria*
question, not a mechanical one, which is why I listed all six subdirectories and both roots
member-for-member in §3 rather than leaning on the green gate.

#### 5. Behavioural equivalence — exercised live on `:6067`

`start-servers.sh` → `READY backend=http://localhost:8974/health`, `READY
frontend=http://localhost:6067`; `assert-phase.sh servers` → `PASS servers`. (The
`emit-event.sh: No such file or directory` line is the known gitignored-`scripts/concertino/`
condition in `workflow-state.md`'s `SCRIPTS_NOTE`, not a server failure.)

I first confirmed the dev server is serving **this** worktree's post-move tree, since it was already
running from the evaluator's session: `GET /src/features/panels/ui/grid/PanelGrid.tsx` returns the
transformed module whose own emitted imports are `/src/features/panels/ui/grid/DesktopPanelGrid.tsx`
etc. (One measurement needed re-running before I would read it: the *old* path
`/src/features/panels/ui/PanelGrid.tsx` also returns 200. It is vite's SPA index.html fallback — a
deliberately bogus path returns the same 200 + `<!doctype html>`. Not a stale file; a measurement
artifact.)

Every relocated group exercised visually, screenshots taken and looked at:

- `grid/` — dashboard renders `PanelGrid`/`PanelCard` at 1440; `MobilePanelStack` + `BottomNav` at 375.
- `detailModal/` — modal opens, and **Edit** renders the APPEARANCE (title/colour/transparency) and
  DATA/binding surfaces, i.e. all five relocated stylesheets resolve.
- `stepConfigs/` — `/pipelines/:id` renders `StepCard`; expanding "Limit rows" renders `LimitConfig`
  with its ROW LIMIT (N) control.
- `shapes/` — "Start from a shape" renders `ShapePickerModal`; picking Top N renders
  `ShapeParamsFields` with its own stylesheet.
- `schedule/` — actions → "Set schedule" renders `PipelineScheduleDialog`, and entering an interval
  renders the relocated `schedulePreview` output: `Next run: Aug 21, 2026, 10:41 PM`.
- `proposalReview/` — `/pipeline-proposals/review` renders the **lazy** `PipelineProposalReviewPage`
  (`AppRoutes.tsx:39`, the dynamic-import specifier — the one form that fails only at runtime), plus
  `PipelineProposalReview`/`PipelineProposalSummary` and their CSS.
- `computedFields/` — `/registry/:id` → "+ Add" renders `ComputedFieldsEditor` + `ComputedFieldForm`.
- `forms/` — Add data source renders `RestApiForm`; switching to SQL Database renders `SqlTab` with
  its stylesheet intact.
- **Light/dark parity**: toggled to light and back. Identical layout, correct token-driven surfaces
  in both. This is preserved *by construction* — not one CSS byte changed anywhere in the diff — and
  the screenshots agree.

**Design-language judgement.** There is nothing here to judge against `DESIGN.md` in the usual
sense: no component body, no stylesheet, and no markup changed. I compared the rendered surfaces
against sibling screens and found no divergence, no off-pattern one-off, and no spacing or
typographic drift — because there is no mechanism by which any could have been introduced. That is
the correct outcome for a pure move, and I would have refuted on any visual difference at all.

**Console.** Two errors appeared during my session, both accounted for:

1. `404` on `GET /api/pipelines/:id/schedule` for a pipeline with no schedule — a backend response,
   not a JS error, on an endpoint this change does not touch.
2. The nested-`<form>` `validateDOMNesting` error on the Data Types page. **I confirm it is
   pre-existing**, and by stronger evidence than a line-number match: `TypeDetailPanel.tsx`'s entire
   diff is the single `ComputedFieldsEditor` import line, and `ComputedFieldForm.tsx` is content-
   identical across its move (§2). `git show $BASE:…TypeDetailPanel.tsx | grep -n '<form'` → `128`
   and `…ComputedFieldForm.tsx` → `90`, identical at HEAD. The nesting is fully determined by two
   byte-identical component bodies, so it cannot have been introduced here.

No other console errors on any surface I exercised.

---

### Verdict: CONFIRM

This ships. It is a genuinely pure structural move, and — unusually — I can say that from my own
measurements rather than from a green suite: 131 files compared under a normalization stricter than
the committed gate's, 4 trailing commas the design predicted in advance, 2293 specifiers resolved
with zero dangling, 699 paths matching baseline-plus-renames exactly, and every acceptance criterion
traced to a listing I produced myself. The one thing a mechanical gate structurally cannot check —
whether each file landed in the *right* subdirectory — I checked by enumeration, and it is right.

### Change Requests

None.

### Non-blocking notes

1. **`scripts/check-move-integrity.mjs` — my judgement: do not ship it in `scripts/`. Move it into
   the change directory before the PR; delete it if that is judged not worth a re-run.** You asked
   me to argue this, so:

   The failure is real and I reproduced its mechanism rather than assuming it: with `BASE == HEAD`,
   `git diff -M --name-status HEAD | grep -c '^R'` → **0**, which trips `MIN_RENAMES = 116` at line
   96 and exits 1. After the squash-merge, every future branch's `git merge-base origin/main HEAD`
   is at or after the merge commit, so this is the *permanent* state, not an edge case.

   The case for `scripts/` is weak. That directory has exactly one meaning in this repo today: it
   holds `check-openspec-hygiene`, `check-openspec-hygiene.selftest`, `check-repo-integrity`,
   `check-scala-quality`, `check-schema-drift`, `check-spec-structure` — six `check-*.mjs` files,
   **every one** wired into both `package.json` and `.husky/pre-commit`, plus `lib/`, `agent/` and
   `concertino/`. Adding a seventh `check-*.mjs` that is wired into neither and fails by
   construction inverts the directory's only invariant. The "it's inert, nothing breaks" argument is
   true of the build and false of the reader: the next person to run the checks in `scripts/` gets a
   red gate with no fixable cause. And HEL-635 is itself a child of the *repo structure cleanup*
   epic — shipping dead weight into a live-gate directory as part of a structure-cleanup change
   argues against itself.

   The docblock-only option is the weakest of the three. The header already says "Move-integrity
   gate for HEL-635"; that did not stop the evaluator from flagging exactly this risk, which is
   evidence that a stronger docblock would not stop the next reader either. It leaves the file
   failing, in the wrong directory, and adds a comment asking people not to be confused by it.

   Moving it to `openspec/changes/segment-frontend-ui-directories/check-move-integrity.mjs` keeps
   its one remaining use — a human PR reviewer re-running it, since a ~200-file rename diff is
   unreviewable line-by-line and `design.md` explicitly says reviewers must lean on this gate —
   while putting it with the artifacts it belongs to and letting it archive with the change. Cost:
   the reports' re-run instruction changes path, `CHECKER_PATH` (line 44) becomes dead (the file is
   then covered by `CHANGE_DIR_PREFIX`, so the `A`-allowlist still passes), and the gate wants one
   re-run to confirm. Caveat I should flag: **there is no precedent** — `git ls-files openspec/changes`
   returns zero `.mjs`/`.sh`/`.js` files across the entire archive. Deleting is the cheaper option
   and I would accept it: the evidentiary value really is spent, `design.md` D4/D6 specifies the
   mechanism completely enough to rebuild, and `evaluation-1.md` plus this report paste its output.
   What I would not do is leave it at `scripts/check-move-integrity.mjs`.

2. **If it does ship, two CONTRIBUTING items ride along.** It is 448 lines against the "~250 soft /
   propose a split in the PR description if you cross ~400" rule (`CONTRIBUTING.md:24`) — defensible
   given ~120 lines are load-bearing rationale, but it needs the PR-description note the rule asks
   for. And `canonicalizeExt` (lines 361–366) is an identity function called at two sites; the
   comment explains why it is a no-op, which is exactly the argument for inlining the comment at the
   comparison site and deleting the function.

3. **Two stale comments deserve one follow-up ticket, not two.** Task 8.1's
   `PipelineDetailPage.css.test.ts:13` backtick reference to the now-moved
   `../../panels/ui/PanelDetailModal.css.test.ts`, and the pre-existing misleading filename
   `PanelDetailModal.css.test.ts` (it reads `PanelDetailModal.mobile.css`). Both are correctly out of
   scope here — editing either would fail the content check, which is the gate working as designed.

4. **Pre-existing nested-`<form>` on the Data Types detail page** (`TypeDetailPanel.tsx:128` →
   `ComputedFieldsEditor` → `ComputedFieldForm.tsx:90`). Confirmed pre-existing above; a candidate
   spin-off, unrelated to this change.

5. **`docs/compute-expression-grammar.md` is now the precedent** for a live doc citing a
   `stepConfigs/` path. The pipeline-op wiring checklist under `~/` still records no path strings,
   so it needs nothing — correctly left for explicit user approval rather than edited unilaterally.
