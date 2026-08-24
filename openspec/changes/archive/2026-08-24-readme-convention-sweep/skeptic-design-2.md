## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Round-1 items, each checked against the live tree (not the diff):

1. **Stale `frontend/src/features/README.md` — RESOLVED.** `cat frontend/src/features/README.md`
   still shows the stale index (lists only `dashboards`, `panels`; "Each feature *should* own...").
   `ls frontend/src/features` = 14 feature dirs + README.md. tasks.md 2.2 now explicitly rewrites
   it, with design.md D2 giving the rationale and grounding it in the ticket's own "fix or delete
   any README that no longer matches its directory" scope item. This is a documented, justified
   deviation from the ticket's "leave it" line — acceptable and better than the ticket text.
2. **`frontend/src/shared` subdirs — RESOLVED.** `ls -R frontend/src/shared` = exactly two subdirs,
   `chrome/` and `ui/`. All design D3 examples exist: `SidebarBody.css`, `BottomNav.tsx`,
   `MobileNavSheet.tsx`, `OverlayProvider.tsx` in `chrome/`; `Modal.tsx`, `Toast.tsx`,
   `IconButton.tsx`, `FormField.tsx`, `Skeleton.tsx` in `ui/`. `ls -d frontend/src/features/*/*/`
   confirms **no** `features/*/shared` exists, so D3/3.2's "no feature-local equivalent — say so
   explicitly" framing is correct.
3. **`frontend/src/{app,config,context,store,test,theme,types}` exclusion — RESOLVED.** D4 states it
   and 5.3 carries it into the PR. Verified D4's factual claim: `frontend/src/app/README.md` and
   `frontend/src/store/README.md` both exist and accurately describe their contents (`app/` =
   App.tsx/AppRoutes.tsx/MobileShell/Sidebar/CommandBar → "bootstrap, provider composition, routing";
   `store/` = store.ts/listenerMiddleware.ts → "centralized Redux store setup"). The other five have
   no README and are indeed unnamed by the ticket.

Independent checks of the rest of the plan:

- **Backend gap count is exactly right.** A scripted sweep of every `backend/src/main/scala` dir
  containing `.scala` files and lacking a README returns precisely the 6 dirs named
  (`email`, `spark`, `ai`, `domain/panels`, `domain/shapes`, `domain/steps`) — no more, no fewer.
- **Stale-path sweep.** `grep -rl -e 'com/helio/security' -e 'com\.helio\.security' -e testutil
  --include=README.md .` returns nothing, matching proposal.md and tasks.md 1.2/5.1.
- **Top-level.** `scripts/`, `schemas/`, `e2e/`, `docs/` have no README; `infra/README.md` exists.
  `ls -d schemas/*/ | wc -l` = 14, matching D1's premise.
- **Feature-local subdir claim — FAILS.** See CR-1.

### Verdict: REFUTE

### Change Requests

1. **design.md Decision 3 and tasks.md 3.1 assert a false "verified at Planning" number.** Both
   state "11 of 14 feature dirs already have their own feature-local `hooks`/`utils`/`services`
   subdirs". Enumerating subdirs of every `frontend/src/features/*/` gives **14 of 14** — every
   feature has at least one of the three: assistant(services), auth(services,utils),
   dashboards(hooks,services,utils), dataTypes(services), layout(hooks), metrics(services),
   onboarding(hooks), panels(hooks,services), patchSets(services), pipelines(hooks,services),
   proposals(services), settings(services), sources(hooks,services,utils), toasts(hooks).
   (The D3 example `features/dashboards/{hooks,utils,services}` is correct.) This matters beyond
   arithmetic: it is presented to the executor as already-verified fact inside the very ticket whose
   stated failure mode is "confident, plausible, unverified prose", and a wrong count can land
   verbatim in `frontend/src/{hooks,utils,services}/README.md`. Correct both occurrences to 14 of 14
   (or drop the count and say "every feature dir"), and re-mark it as executor-verified rather than
   Planning-verified.

2. **tasks.md 4.1 and 4.2 give conflicting instructions for the same file.** 4.1 says write a
   "one-line-purpose `README.md`" for `scripts/`, `schemas/`, `e2e/`, `docs/`; 4.2 says write "a
   single `schemas/README.md` explaining the 14 domain-subdirectory grouping". An executor working
   the list in order writes `schemas/README.md` twice, and the second may or may not preserve the
   first. Remove `schemas/` from 4.1's list and let 4.2 own that file exclusively (or state that 4.2
   supersedes 4.1 for it).

### Non-blocking notes

- **D3's characterization of `chrome/` is narrower than its actual contents.** Beyond the app-shell
  items cited, `chrome/` also holds `AccentPicker`, `ActionsMenu`, `InlineError`, `Popover`,
  `SaveStateIndicator`, `ErrorBoundary`, `OrbitMark`, `pickerEmptyState` — several of which read as
  generic primitives closer to `ui/`'s remit. tasks.md 3.2 does instruct the executor to confirm the
  distinction against the current file list, so this is recoverable; just don't let "app-shell /
  navigation" be copied into the README as if it covered the whole directory.
- **tasks.md 4.1 mis-cites design.md.** "(design.md D4 excludes `infra/`)" — D4 is the
  `frontend/src/*` exclusion decision; the `infra/` carve-out comes from the ticket's scope list and
  appears nowhere in design.md. Fix the citation or add the carve-out to a decision.
- tasks.md 2.1 rightly warns against a generic copy-paste across all 14 feature READMEs. Given
  `layout` and `toasts` have only `{hooks,state}` and no `ui`, the slice convention genuinely varies
  per feature — worth the executor's attention.
