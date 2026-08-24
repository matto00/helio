## 1. Backend package README gaps

- [x] 1.1 `ls` each of the 6 gap dirs (`backend/src/main/scala/com/helio/email`,
      `.../spark`, `.../ai`, `.../domain/panels`, `.../domain/shapes`, `.../domain/steps`),
      read the file names, then write `README.md` in each per the ticket's format. Match the
      register of `backend/src/main/scala/com/helio/api/README.md`.
- [x] 1.2 Confirm no existing backend README references `com/helio/security`,
      `com.helio.security`, or `testutil` (`grep -rl` across `backend/**/README.md`).

## 2. Frontend feature READMEs

- [x] 2.1 For each of the 14 dirs under `frontend/src/features/*`, `ls` the dir (and its
      `services`/`state`/`types`/`ui` subdirs where present), then write a `README.md`
      explaining the slice convention as it is actually used in that feature (not a generic
      copy-paste across all 14).
- [x] 2.2 Rewrite `frontend/src/features/README.md` (design.md D2): it currently lists only
      2 of the 14 feature dirs and describes the convention aspirationally ("should own..."). Re-run
      `ls frontend/src/features` to confirm the full list, then rewrite it to enumerate all 14 and
      state the slice convention as fact. This is a "fix a stale README" task, in scope per the
      ticket's own "fix or delete any README that no longer matches its directory" item — not new
      scope.

## 3. Frontend shared-dir READMEs

- [x] 3.1 For `frontend/src/hooks`, `utils`, `services`: `ls` each dir, then `grep` a sample of
      real imports (e.g. `grep -rl "from '../../hooks'" frontend/src/features`) to confirm each
      holds cross-feature-shared code, distinct from the same-named feature-local subdir most
      features already have (verified at Planning: all 14 features have at least one of their own
      `hooks`/`utils`/`services`), then write `README.md` with a "does not belong here" line
      pointing at the feature-local equivalent.
- [x] 3.2 For `frontend/src/shared`: `ls` its two subdirs `chrome/` and `ui/`, confirm the
      distinction (chrome = persistent app-shell/navigation components; ui = generic
      feature-agnostic UI primitives) still holds against the current file list, then write
      `frontend/src/shared/README.md` documenting both, cross-referencing each other (no
      `features/*/shared` exists, so there is no feature-local equivalent to distinguish from —
      say so explicitly rather than implying one).

## 4. Top-level and schemas/ READMEs

- [x] 4.1 `ls` `scripts/`, `e2e/`, `docs/` and write a one-line-purpose `README.md` for each
      (`infra/` already has one — no action; `schemas/` is handled separately by 4.2 below, not
      here — do not also write a generic one-liner `schemas/README.md` in this task).
- [x] 4.2 `ls schemas/` (top level and its 14 domain subdirs) and write the single
      `schemas/README.md` (design.md D1) explaining both the directory's overall purpose *and*
      the 14-domain-subdirectory grouping, rather than 14 near-identical per-domain stubs. This
      is the only README written for `schemas/` — supersedes/replaces task 4.1's scope for this
      one directory, it does not add to it.

## 5. Repo-wide fix/delete sweep

- [x] 5.1 Re-run the full-repo grep for `com/helio/security`, `com.helio.security`, and
      `testutil` across all `README.md` files (not just backend) to confirm none exist;
      fix or delete any that do.
- [x] 5.2 Spot-check: pick 5 README files (a mix of new and pre-existing) at random, `ls`
      their directories, and confirm every claim in each README holds against the real
      directory contents. Record which 5 were picked and the outcome.
- [x] 5.3 Enumerate every in-scope directory (6 backend + 14 frontend features + 1 corrected
      features index + 4 frontend shared-tier dirs (`shared`,`hooks`,`utils`,`services`) + 4
      top-level + `schemas/README.md`) and confirm each has an accurate README; state the final
      count for the PR description. Explicitly note in the PR that `frontend/src/{app,config,
      context,store,test,theme,types}` are out of scope per design.md Decision 4 (app/store
      already accurate; the rest were never in the ticket's scope list) — do not claim full
      `frontend/src/*` coverage.
