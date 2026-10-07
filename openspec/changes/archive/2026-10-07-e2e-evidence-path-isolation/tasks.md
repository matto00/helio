## Standing Constraints

## 1. Evidence location

### Tests
- [x] 1.1 Add `/e2e-evidence/` to `.gitignore`; verify `git check-ignore -v e2e-evidence/HEL-1/a.txt` matches it
- [x] 1.2 Add `e2e/support/evidencePath.ts` per design D2; verify `npm run check:e2e-types` passes
- [x] 1.3 Migrate hel1275, hel1277, hel1350, hel1351 off `openspec/changes` SHOTS dirs to `evidencePath`; verify `git diff` per file touches only path/import/mkdir lines (plus stale header comments about the old location)
- [x] 1.4 Migrate hel588, hel1085, hel1087, hel1088, hel1095, hel1169 off cwd-relative `.concertino/runs` paths; same diff check
- [x] 1.5 Probe: call the helper from a cwd other than the worktree root (e.g. a tsx/node one-liner run from `/`), record the resolved path, and confirm `git status --porcelain` is empty and nothing appears under `openspec/changes/`

## 2. Guard

### Tests
- [x] 2.1 Add `scripts/check-e2e-evidence-paths.mjs` per design D3; verify it exits 0 on the migrated tree and 1 on the pre-migration tree (`git stash`-free: run it with the target-root arg against an export of the base SHA printed live by `scripts/concertino/resolve-review-base.sh`, or the selftest fixture)
- [x] 2.2 Add `scripts/check-e2e-evidence-paths.selftest.mjs` per design D4; verify every red case fails and every green case passes, and show it red by temporarily breaking rule (b) in the guard (mutation), then restore
- [x] 2.3 Wire `check:e2e-evidence-paths` and `:selftest` into `package.json`, `.husky/pre-commit`, and `.github/workflows/ci.yml` next to `check:test-temp-dir-hygiene`; verify a commit runs them (hook output)

## 3. check:openspec

### Tests
- [x] 3.1 Implement design D5 in `scripts/check-openspec-hygiene.mjs`; verify against a real ghost dir (`mkdir -p openspec/changes/zz-ghost/screenshots && touch .../a.png`) the check exits 0 with the notice, then remove that exact dir
- [x] 3.2 Add D5 selftest cases to `check-openspec-hygiene.selftest.mjs` (ignored-only → pass + notice; one committable file → fail); verify `npm run check:openspec:selftest` passes and goes red when the exemption is mutated to apply unconditionally
- [x] 3.3 Run the full pre-commit chain via a real commit (no `-n`) and verify it passes
