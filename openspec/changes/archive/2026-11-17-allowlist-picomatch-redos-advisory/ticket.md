# HEL-1751: CI security red on main: allowlist dev-only picomatch ReDoS GHSA-fc5q-39xc-vjpf (no patched release)

## Description

Main's `security` CI job has failed since 2026-11-17 at about 17:47 UTC (run on 2e98eba92). The `Frontend audit (root)`
and `Frontend audit (frontend/)` steps fail on a new advisory, GHSA-fc5q-39xc-vjpf: picomatch ReDoS through
single-branch repeated extglobs, affecting `<= 4.0.7`. There is no patched version, and 4.0.7 is the latest release.

Every open PR is blocked, because `ci-complete` requires `security`.

Measured locally on 2e98eba92:

* frontend/: 46 high, all from picomatch.
* Root: 43 high, all from picomatch.
* helio-mcp/: clean.
* `npm audit --omit=dev` finds 0 in both trees. Every path runs through dev and build tooling: jest, rollup plugins,
  vite/tinyglobby/fdir, anymatch and micromatch.

## Owner ruling (2026-11-17)

Allowlist, dev-only, following the HEL-1246 pattern.

## Acceptance criteria

- [ ] `.audit-ci.jsonc` (root) and `frontend/.audit-ci.jsonc` gain allowlist entries for GHSA-fc5q-39xc-vjpf in the
  `"<GHSA>|<path-scope>*"` form, never a bare GHSA id or a package-wide wildcard.
- [ ] Each entry has an inline comment with this ticket, the reason (dev-only, no patch), the dependency path(s) and a
  review-by date of 2026-12-17.
- [ ] Path scopes cover only the dev-tool paths. Prove it: `npx audit-ci --config .audit-ci.jsonc` exits 0 in both
  directories, and the same advisory reached through any other path still fails. Show this with a recorded check,
  for example a scratch lockfile or the audit-ci path match logic.
- [ ] `npm audit --omit=dev` stays 0 in both trees; record the output.
- [ ] The HEL-1246 braces entry (review-by 2026-11-02, now past) is re-checked. Either a patch exists and the entry is
  removed, or its review-by date is extended, with the reason stated.
- [ ] The PR's `security` job is green.

## Agent notes

audit-ci path strings use `>` between package names, for example `*micromatch>braces*` in the HEL-1246 entry.
Enumerate the distinct parent paths of picomatch from `npm audit --json` in each tree rather than guessing.
