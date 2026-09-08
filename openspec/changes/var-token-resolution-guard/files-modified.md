# Files Modified — HEL-1037

- `scripts/check-tokens.mjs` — new guard: extracts `var(--*)` references and `--x:` declarations
  (declaration-position only, not any `--x:` in the file) from `frontend/src/**/*.css`, strips
  comments first, resolves references against the full scanned-CSS definition set plus a
  setter-named allowlist, and exits non-zero with file:line for each unresolved reference. Exports
  pure functions (`stripComments`, `extractDefinitions`, `extractReferences`, `checkTokens`,
  `ALLOWLIST`) and takes an optional scan-root CLI argument so the selftest can drive it over a
  `mkdtemp` fixture without touching a tracked file.
- `scripts/check-tokens.selftest.mjs` — new companion selftest (10 cases): the exact-set
  over-permissiveness detector (task 4.2a), decoy/comment/allowlist/fallback cases each asserting
  on the token named in the output (never exit code alone), two real CLI-subprocess cases exercised
  over a `mkdtemp` fixture, a startup prefix-sweep for stale fixtures, and a forced-failure case
  proving cleanup survives a mid-run throw.
- `package.json` — added `check:tokens` / `check:tokens:selftest` npm scripts beside the other
  `check:*` scripts.
- `.husky/pre-commit` — wired `check:tokens` and `check:tokens:selftest` into the commit-gate chain.
- `.github/workflows/ci.yml` — wired the same two into CI (frontend job), independent of the local
  hook so a `git commit -n` bypass doesn't skip it.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — fixed 3 defects: `var(--radius-sm)`
  → `var(--app-radius-sm)` (×2, matching the dominant radius token in
  this same file) and `var(--text-small)` → `var(--text-xs)` (the scale has no `small` step —
  `micro/xs/sm/base/lg/xl/2xl/3xl` — and `--text-xs` is the dominant `font-size` token in this file.
  The neighbouring rules use the smaller `--text-micro` (10px), which is too small for a readable
  italic placeholder sentence).
- `frontend/src/features/sources/ui/AddSourceModal.css` — fixed 1 defect: `var(--space-sm)` →
  `var(--space-2)` (matching the same `margin: var(--space-2) 0 0;` pattern used for an equivalent
  hint paragraph in `shared/chrome/ErrorBoundary.css:49`).
