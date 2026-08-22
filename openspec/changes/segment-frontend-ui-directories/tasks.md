## 1. Frontend — baseline capture (before any move)

- [x] 1.1 Record the fork-point SHA as **`BASE`** (`git merge-base origin/main HEAD`), write it into
      `workflow-state.md`, and confirm the worktree is clean. Every integrity check below diffs against `BASE`,
      never `HEAD` — `git diff … HEAD` is vacuous once the work is committed (verified: 0 lines, exit 0).
- [x] 1.2 Write a baseline manifest (path + `sha256` per file under the three `ui/` dirs) as a record only — the gate
      derives the path set and counts it compares against from `$BASE` at check time (6.4), not from this file.
- [x] 1.3 Record expected-at-`649f1490` counts for documentation: pipelines 101, panels 76 flat / 145 recursive,
      sources 30.
- [x] 1.4 Record the baseline Jest test count (suites and tests) for comparison in 7.3.

## 2. Frontend — pipelines/ui segmentation

- [x] 2.1 `mkdir -p` each destination before its moves — `git mv` does not create the target directory.
- [x] 2.2 `git mv` the 42 `{Op}Config.{tsx,test.tsx}` files into `stepConfigs/` (21 ops incl. `AssertConfig`).
- [x] 2.3 `git mv` the 5 `ComputedFieldForm.*`/`ComputedFieldsEditor.*` files into `computedFields/`
      (`ComputeFieldConfig` is a *different* component and belongs in `stepConfigs/` — do not conflate).
- [x] 2.4 `git mv` `PipelineScheduleDialog.*` + `schedulePreview.*` (5 files) into `schedule/`.
- [x] 2.5 `git mv` `ShapeParamsFields.*` + `ShapePickerModal.*` (6 files) into `shapes/`.
- [x] 2.6 `git mv` the 6 `PipelineProposal*` files into `proposalReview/` (unrelated to
      `features/dashboards/ui/ProposalReview.tsx` — different feature, untouched).
- [x] 2.7 Confirm 37 files remain at the root, `StepCard.{tsx,test.tsx}` among them.

## 3. Frontend — panels/ui segmentation

- [x] 3.0 `mkdir -p` each destination first — `git mv` does not create it.
- [x] 3.1 `git mv` all 20 `PanelDetailModal.*` files into `detailModal/` — all 5 CSS and both `.css.test.ts` together,
      so each disk-reading test keeps its `__dirname` sibling.
- [x] 3.2 `git mv` the 19 grid files into `grid/` (`PanelGrid*`, `panelGrid*`, `DesktopPanelGrid*`, `MobilePanelStack*`,
      `mobilePanelHeights*`), keeping `MobilePanelStack.css` with `MobilePanelStack.css.test.ts`.
- [x] 3.3 Confirm 37 files remain at the root; `creationSteps/`, `creators/`, `editors/`, `renderers/` untouched.

## 4. Frontend — sources/ui segmentation

- [x] 4.1 `mkdir -p forms/`, then `git mv` the 13 form files into `forms/`; confirm 17 remain at the root.

## 5. Frontend — reference updates

- [x] 5.1 Re-point relative specifiers inside every moved file (depth +1 to reach siblings and parents).
- [x] 5.2 Re-point the measured incoming set — **15 files, 78 lines** (design.md D5). Includes the two largest sites,
      which are in the same feature's **non-`ui/`** dirs: `pipelines/hooks/useStepCardState.ts` and
      `pipelines/state/stepNarrowing.ts` (17 `../ui/*Config` imports each). `app/App.tsx` and `shared/ui/` need no
      change. Re-derive the set from the tree rather than trusting this list.
- [x] 5.3 Update `docs/compute-expression-grammar.md`'s `ComputeFieldConfig.tsx` path. Leave `docs/uploads.md`,
      `notes/mobile-pwa-handoff.md`, and all archived `openspec/changes/**` documents untouched.
- [x] 5.4 **Verify (do not edit)** that `jest.config.cjs`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.cjs`,
      `.github/workflows/ci.yml`, `.husky/**` and `scripts/` need no change (`check-schema-drift.mjs` hard-codes a
      *different* feature's path). This change touches no live infrastructure; if that stops being true, stop and
      flag it. `check:repo-integrity` is now the FIRST pre-commit gate — never bypass it with `git commit -n`.

## 6. Tests — move-integrity gate (full spec: design.md D4/D6 — follow it, not this summary)

- [x] 6.1 Re-derive `BASE=$(git merge-base origin/main HEAD)` every run; never `HEAD`, never a hard-pinned SHA.
- [x] 6.2 Non-vacuity: fail if fewer than 116 `R` entries.
- [x] 6.3 Whole-repo status assertion: no `D`/`T` anywhere; `A` only under this change's `openspec/` dir **or**
      the checker itself, which lives in that same change dir (6.10); the only
      non-`frontend/` `M` is `docs/compute-expression-grammar.md`, confirmed by its one-line diff.
- [x] 6.4 Whole-tree path set: baseline is `git ls-tree -r --name-only $BASE -- frontend/`; the post-change tracked
      set under `frontend/` must equal it with the rename pairs applied. Derive per-feature counts from that same
      tree — never pin them (`main` advances; 7.6 re-runs after merging it). `$BASE` predates the moves, so this is
      not D6(e)'s tautology; deriving from the *working tree* would be.
- [x] 6.5 Content check by normalize-and-compare, scoped to `frontend/`; prettier error on either side is a FAILURE.
- [x] 6.6 Substitution-site check, statement-level; baseline 623 sites.
- [x] 6.7 Specifier-target check: resolve both sides against their directories, apply the rename map, require the
      same target — the only thing catching a wrong-but-existing `.css` path. **Resolution must be extension-aware:**
      the rename map is keyed on real filenames (`DesktopPanelGrid.tsx`) while ~1030 of ~1073 specifiers are
      extensionless, so canonicalise extensions on BOTH sides or it throws hundreds of false mismatches on correct
      work. A specifier that cannot be resolved is a **FAILURE, never a skip**.
- [x] 6.8 Red-before-green, seven cases (a)(b′)(c)(d)(e)(f)(g) per design.md D6, each shown FAILING with pasted
      output. (g) swaps `"./PanelGrid.css"` for `"./MobilePanelStack.css"` and must show 6.7 FAIL **and** 6.5
      IDENTICAL in the same run — the one case proving 6.7 catches what byte-identity provably cannot.
- [x] 6.9 Revert all seven mutations; confirm each with a clean `git status`.
- [x] 6.10 Commit the checker inside this change dir (NOT `scripts/`) so the evaluator and final skeptic can re-run
      it, and so it archives with the design that specifies it rather than becoming a permanently-red seventh script
      in a directory whose six `check-*.mjs` are all wired into `package.json` + `.husky/pre-commit`.

## 7. Tests — gates

- [x] 7.1 `npm run lint` (zero warnings), 7.2 `npm run typecheck`, 7.4 `npm run build`.
- [x] 7.3 `npm test` — green, suite/test counts match the 1.4 baseline.
- [x] 7.5 `npm run format:check` clean; expect prettier to re-wrap ~5 lines that crossed `printWidth: 100`.
- [x] 7.6 Merge `origin/main` before the evaluation gates, then re-run 6.1–6.7 and 7.1–7.5, re-deriving `BASE`.

## 8. Known-stale, deliberately not touched

- [x] 8.1 `pipelines/ui/PipelineDetailPage.css.test.ts:13` cites `../../panels/ui/PanelDetailModal.css.test.ts` in a
      backtick comment; that file moves. It is a comment, not a specifier, so 6.5 **fails** if tidied — leave it
      stale and raise a follow-up.
