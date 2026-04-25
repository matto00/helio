# HEL-123: Fix follow-redirects vulnerability (CVE: auth header leak on cross-domain redirect)

## Title
Fix follow-redirects vulnerability (CVE: auth header leak on cross-domain redirect)

## Description

**Severity:** Medium (Dependabot alert #37)

**Package:** `follow-redirects` (frontend dependency, transitive via axios/webpack-dev-server)

**Issue:** Versions <= 1.15.11 leak custom authentication headers to cross-domain redirect targets. Patched in 1.16.0.

**Fix:** Bump `follow-redirects` to >= 1.16.0. Since it's likely a transitive dependency, add an override in `frontend/package.json`:

```json
"overrides": {
  "follow-redirects": ">=1.16.0"
}
```

Then run `npm install` and verify with `npm audit`.

**Reference:** https://github.com/matto00/helio/security/dependabot/37

## Acceptance Criteria

- `follow-redirects` is pinned to >= 1.16.0 via an overrides entry in `frontend/package.json`
- `npm install` succeeds cleanly
- `npm audit` reports no remaining findings for `follow-redirects`
- No functional regressions to the frontend build or tests
