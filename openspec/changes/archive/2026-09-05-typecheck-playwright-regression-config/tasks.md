# Tasks

## 1. Baseline

- [x] 1.1 Run `npx tsc -p e2e/tsconfig.json --showConfig` and record whether `playwright.regression.config.ts`
      appears in the resolved `files` list. Expected: absent. Record the output of
      `npx tsc -p e2e/tsconfig.json --showConfig | grep -c 'regression\.config'` verbatim in the execution report, so
      the before/after pair is legible in the archive rather than asserted. This is the "before" half of the evidence.
- [x] 1.2 Confirm `npm run check:e2e-types` currently exits 0 — establishing that a green run does not imply
      coverage, which is the distinction this change's evidence turns on.

## 2. Change

- [x] 2.1 Add `"../playwright.regression.config.ts"` to `e2e/tsconfig.json`'s `include`, beside the existing
      `"../playwright.config.ts"` entry. Do not touch root `tsconfig.json`.

## 3. Verify

- [x] 3.1 Re-run `npx tsc -p e2e/tsconfig.json --showConfig` and confirm `playwright.regression.config.ts` is now
      in the resolved `files` list, recording the same command's output verbatim. This is the "after" half — the
      load-bearing evidence.
- [x] 3.2 Run `npm run check:e2e-types` and confirm it exits 0. If the newly-covered file reports real type errors,
      fix them in that file (design D3) — never by narrowing the include.
- [x] 3.3 Run the full pre-commit gate chain green. **No backend spec, no dev server, no database connection of any
      kind** — HEL-974 holds the dev Postgres with an in-flight `V100`. Do not edit `.github/workflows/ci.yml`
      (HEL-996 is live there); flag any collision instead.
- [x] 3.4 Write `files-modified.md` enumerating every file touched.

## 4. Guard against restating the false premise

- [x] 4.1 Confirm no artifact in this change (proposal, design, tasks, commit message, PR body) asserts that a bare
      root `tsc` walks `.claude/worktrees/`. That claim is measured false and must not survive into the archive.
