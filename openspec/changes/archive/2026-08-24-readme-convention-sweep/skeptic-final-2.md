## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

**1. The round-1 fix (`frontend/src/utils/README.md`) is accurate.**
Re-derived the import graph myself from `frontend/src`, excluding self-references:
`grep -rn "utils/<name>" --include=*.ts --include=*.tsx . | grep -v "^./utils/"`

- `aggregate.ts` → 5 consumers, all under `features/panels/`
- `chartAppearance.ts` → 7 consumers, all under `features/panels/`
- `chartTypeOptions.ts` → 1 consumer, `features/panels/ui/ChartPanel.tsx`
- `formatRelativeTime.ts` → `features/panels/ui/grid/MobilePanelStack.tsx`,
  `features/panels/ui/PanelCard.tsx`, `features/pipelines/ui/PipelineDetailFooter.tsx`,
  `features/pipelines/ui/PipelineListTable.tsx` (two features — genuinely cross-feature)

Also confirmed there is no `frontend/src/utils/index.ts` barrel that could mask
indirect imports. The rewritten README matches this exactly. **Round-1 issue is fixed.**

**2. Diff since round 1 is docs-only and scoped to the one file.**
`git log --oneline 65eeea69..HEAD` → single commit `87465f52`.
`git diff --stat 65eeea69..HEAD` → `frontend/src/utils/README.md | 19 +++---`, 1 file changed.
Full branch diff (`main...HEAD`) is 38 `.md` files + `.openspec.yaml`; no source files.

**3. Randomly sampled other READMEs against real `ls`/import-grep** (seeded `shuf`
over the branch's changed READMEs, plus two adjacent siblings):

- `frontend/src/features/toasts/README.md` — file list matches `find` exactly
  (`state/toastsSlice.ts`, `state/toastListeners.ts`, `hooks/useToast.ts`);
  `shared/ui/Toast.tsx` exists, so the "does not belong here" pointer is real. OK.
- `frontend/src/features/auth/README.md` — every named file exists
  (`state/authSlice.ts`, `services/authService.ts`, `types/user.ts`,
  `utils/postLoginReturnTo.ts`, `ui/ProtectedRoute.tsx`, `ui/PublicOnlyRoute.tsx`). OK.
- `frontend/src/features/dataTypes/README.md` — all named files/UI components exist. OK.
- `frontend/src/features/panels/README.md` — all named state helpers
  (`panelNarrowing/panelPayloads/panelShapes/panelSlots/panelTemplates/panelThunks`)
  and all named `ui/` subdirs (`renderers`, `grid`, `creationSteps`, `creators`,
  `editors`, `detailModal`) exist. OK.
- `schemas/README.md` — the 14 named domain subdirs are exactly `ls schemas`;
  verified the "schema files directly, no code, no nesting" claim with
  `find schemas -mindepth 2 -not -name '*.json'` (empty) and
  `find schemas -mindepth 3` (empty). OK — this one is precise.
- `frontend/src/shared/README.md` — every named `chrome/` and `ui/` component
  exists. The lists are partial (e.g. `TextField`, `Textarea`, `ConfirmInline`,
  `SaveStateIndicator` are omitted) but read as illustrative, not exhaustive.
  Non-blocking.
- `frontend/src/services/README.md` — the three named files are exactly the
  non-test contents of the directory. OK.
- `frontend/src/hooks/README.md` — **FALSE CLAIM FOUND, see Change Request 1.**

**4. CI-relevant gates re-run on HEAD (`87465f52`), all output read:**
Full `.husky/pre-commit` suite, each step run individually:
`check:repo-integrity` PASS, `lint` PASS, `typecheck` PASS, `format:check` PASS
(`prettier --check .` → "All matched files use Prettier code style!"),
`check:schemas` PASS, `check:spec-structure` PASS, `check:openspec` PASS
(`check-openspec-hygiene.mjs` → "openspec/ is clean"), `check:openspec:selftest` PASS,
`check:scala-quality` PASS, `npm test` → 254 suites / 2751 tests passed.

No UI/behavioral changes in this branch, so the servers/screenshot pass does not apply.

### Verdict: REFUTE

The round-1 fix is correct, the diff is clean, and every gate passes. But the
instruction for this round was to assume the round-1 false claim was not the
whole set — and it wasn't. `frontend/src/hooks/README.md` carries the *same*
defect class, in the *same* sentence shape, in a file the executor explicitly
reported as "re-checked against fresh usage greps ... holds as written". That
report is wrong, which means the re-check either did not cover this file or did
not compare its result to the README's actual wording.

### Change Requests

1. **`frontend/src/hooks/README.md` — `useRelativeTime.ts` is not cross-feature.**
   The README opens "Cross-feature React hooks: `reduxHooks.ts` (...),
   `usePortalPopover.ts`, `useRelativeTime.ts`." and asserts
   "**Belongs here:** hooks used by more than one feature."

   Ground truth (`grep -rn "useRelativeTime" frontend/src --include=*.ts --include=*.tsx`,
   excluding the hook and its own test): exactly **one** consumer repo-wide —
   `frontend/src/shared/chrome/SaveStateIndicator.tsx:2`. Zero `features/*`
   consumers. It is used by one shared component, not by more than one feature,
   so both the opening sentence and the stated inclusion rule are false for it.

   For contrast, the other two do hold: `usePortalPopover.ts` is imported from
   `features/auth/ui`, `features/dashboards/ui`, `features/metrics/ui`,
   `shared/chrome`, `shared/ui`; `reduxHooks.ts` from `app/` and ~12 features.

   Required: rewrite this README the same way `utils/README.md` was rewritten —
   state the verified truth rather than the aspiration. A defensible framing is
   that `hooks/` holds hooks not owned by any single feature (which legitimately
   covers a hook consumed only by `shared/chrome`), with `useRelativeTime.ts`
   named as the single-consumer case so the next reader isn't misled into
   thinking it has multiple feature callers. Do not move any file — docs-only
   ticket.

2. **Re-do the sibling re-check honestly, and report per-file evidence.**
   The commit message / executor report for `87465f52` states `hooks/`,
   `services/`, and `shared/` were "re-checked against fresh usage greps" and
   "all three hold as written". `hooks/` demonstrably does not. Re-verify each
   remaining README that makes a *usage* claim (as opposed to a pure
   file-inventory claim) — specifically any that say "cross-feature",
   "used by more than one feature", or "every feature" — by pasting the actual
   grep output per named file into the report, so the claim is auditable rather
   than asserted. `frontend/src/services/README.md`'s "infrastructure every
   feature's API client builds on" is the next-most-likely instance of this
   pattern and should be checked literally against every `features/*/services/`
   file, not spot-checked.

### Non-blocking notes

- `frontend/src/shared/README.md`'s component enumerations omit several real
  files (`TextField`, `Textarea`, `ConfirmInline`, `SuspenseFallback`,
  `PageContentSkeleton`, `SaveStateIndicator`, `InlineError`, `StatusMessage`,
  `OrbitMark`). Read as illustrative examples this is fine; if any README in
  this sweep is meant to be an exhaustive inventory, this one silently isn't.
- This worktree's `scripts/concertino/` predates main's and lacks
  `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh`; I used
  main's copies. Not a defect in this change, just noting the divergence.
