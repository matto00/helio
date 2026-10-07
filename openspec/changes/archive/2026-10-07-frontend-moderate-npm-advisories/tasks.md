## Standing Constraints

- [C1] The AC1 advisory table's "parent" is the dependent that requires the package (from the lockfile / `npm ls`), never npm's `via`; fixAvailable is reported raw alongside any interpretation.

## 1. Frontend

- [x] 1.1 Change `frontend/package.json` overrides `@istanbuljs/load-nyc-config.js-yaml` to `^4.1.1`; run `npm install` in frontend/; verify `npm ls js-yaml argparse sprintf-js` shows js-yaml 4.x, argparse 2.x, no sprintf-js
- [x] 1.2 Diff lockfile `.packages` name/version before vs after; verify the delta is exactly the expected entries and record it
- [x] 1.3 Set `frontend/.audit-ci.jsonc` to `"moderate": true` with an HEL-1320 comment and empty allowlist; verify `npx audit-ci --config .audit-ci.jsonc` exits 0

## 2. CI and docs

- [x] 2.1 Update the `security` job comment in `.github/workflows/ci.yml` to say frontend/ is at moderate; verify comment-only diff
- [x] 2.2 Update `docs/dependency-management.md` Frontend gate and allowlist paragraphs to the accurate current state
- [x] 2.3 Update the `MISTAKES.md` security-gate entry (heading + body) so frontend/ is at moderate with helio-mcp; verify a repo-wide grep shows no stale frontend "high" threshold claim
- [x] 2.4 Reword the `helio-mcp/.audit-ci.jsonc` header comment (lines 2-5) so only the root config is at `high`; comment-only diff; grep `"high": true` + `frontend/` across *.md, *.yml, *.jsonc for stale claims

## 3. Tests

- [x] 3.1 Red/green proof: base lockfile + new config -> audit-ci non-zero; base lockfile + old config -> zero; new lockfile + new config -> zero; keep transcripts
- [x] 3.2 Run `npm test` and one file with `--coverage`; verify both pass
- [x] 3.3 Exercise load-nyc-config's `.nycrc.yaml` branch against a temporary file in the worktree; verify parsed config, then remove the file
- [x] 3.4 Regenerate the AC1 triage table (parent = dependent, runtime/dev, raw fixAvailable) from fresh base `npm audit --json` + base lockfile, and the full lockfile delta, for the PR body, and replace design.md's triage table with it (run base audit at least twice and record any disagreement; state that parent = lockfile `dependencies` only, peer edges excluded)
