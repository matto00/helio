## Standing Constraints

- [C1] Every red/green audit claim is measured with the exact CI command (root-pinned audit-ci, helio-mcp config/dir), never a bare `npm audit`
- [C2] Red-gate revert proof: commit the bump first, then prove the revert by matching `sha256sum` of the lockfile before/after
- [C3] The Dependabot-0 AC is post-merge only; pre-merge evidence states `npm audit` 0 as a proxy, never claims the AC met

### Dependencies

- [x] 1.1 `npm ci` in the worktree root and `helio-mcp/` so installed trees match the lockfiles (MISTAKES.md)
- [x] 1.2 Capture the pre-bump `npm audit` and `npm ls hono ip-address fast-uri` for helio-mcp (evidence)
- [x] 1.3 Write `helio-mcp/.audit-ci.jsonc` (`"moderate": true`, empty allowlist, header comment per design D2/D3)
- [x] 1.4 Red-first: run the exact CI command on the unbumped lockfile -> non-zero; control with `"high": true` -> 0
- [x] 1.5 `npm audit fix` (no --force) in `helio-mcp/`; confirm `package.json` unchanged; post-bump audit 0
- [x] 1.6 Allowlist only advisories with no patch (none expected), HEL-1246 pattern, each justified

### CI and docs

- [x] 2.1 Add the helio-mcp audit step to `ci.yml`'s `security` job using the root-pinned audit-ci (design D4)
- [x] 2.2 Add `helio-mcp/package-lock.json` to the `security` job's `cache-dependency-path`
- [x] 2.3 Update MISTAKES.md's security-gate entry and ci.yml's security-job header comment: three trees, helio-mcp at moderate
- [x] 2.4 Verify reachability claims (design D6) against helio-mcp `src/` and the SDK import graph; record them

### Tests

- [x] 3.1 Red-gate: reintroduce a vulnerable version, exact CI command -> non-zero; revert -> 0, byte-identical
- [x] 3.2 helio-mcp full suite via root jest, `check:helio-mcp-types`, `npm --prefix helio-mcp run build`
- [x] 3.3 `npm run verify` stdio smoke against a worktree backend; delete the PAT by exact id afterwards
- [x] 3.4 Write `audit-evidence.md` in the change dir with all transcripts (before/after audit, red-first, red-gate)
