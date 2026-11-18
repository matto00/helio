## Why

HEL-1751 allowlisted picomatch GHSA-fc5q-39xc-vjpf in the root and `frontend/` `.audit-ci.jsonc` as one
`"<GHSA>|<package>>*"` entry per package in picomatch's dev-only effects set. audit-ci paths carry no dev/prod
marker, so if any listed package (e.g. `micromatch@4.0.8`) became a direct **production** dependency, the path
`micromatch>picomatch` would still match `micromatch>*` and the advisory would pass the gate. Every allowlist that
accepts real dependency paths has this gap. The fix is a second, independent gate that audits only production
dependencies and has no allowlist at all, so a dev-only allowlist can never hide a production advisory.

## What Changes

- Add three steps to the CI `security` job in `.github/workflows/ci.yml`, one per npm tree (root, `frontend/`,
  `helio-mcp/`), each running `npm audit --omit=dev --audit-level=moderate` against that tree's committed lockfile.
  These steps read no `.audit-ci.jsonc` and accept no allowlist.
- Each step reports independently of every other audit step (same convention as HEL-1296) and is time-bounded.
- Update the `security` job's header comment (and add a comment at the new steps) naming HEL-1753, HEL-1751 and
  HEL-1246, and stating the no-exceptions policy.
- No lockfile, `package.json` or `.audit-ci.jsonc` changes in the real tree.

## Capabilities

### New Capabilities
- `production-dependency-audit`: CI audits the production dependencies of every npm tree at moderate severity with
  no allowlist and no exceptions.

### Modified Capabilities
- `ci-security-job-reporting`: the list of audit steps that must report independently grows to include the three
  production-only audit steps.

## Impact

- `.github/workflows/ci.yml` (`security` job only). No application code, schema, migration, UI or lockfile change.
- Adds ~3 registry round-trips to the `security` job (seconds); the job's 5-minute timeout still holds.
- A future production advisory with no patched release will turn `security` red with no in-repo way to suppress it;
  that is the intended behavior (see design.md D4).
