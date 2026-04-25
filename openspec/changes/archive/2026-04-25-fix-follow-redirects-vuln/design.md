## Context

`follow-redirects` is a transitive dependency brought in by axios and webpack-dev-server. The installed version (<= 1.15.11) has a known CVE where auth headers are forwarded on cross-domain redirects. npm's `overrides` mechanism (npm 8.3+) lets us force a minimum version without touching direct dependencies.

## Goals / Non-Goals

**Goals:**
- Pin `follow-redirects` to `>=1.16.0` in all transitive positions
- Leave the rest of the dependency tree unchanged

**Non-Goals:**
- Upgrading axios or webpack-dev-server
- Any runtime or behavioral changes to the application

## Decisions

**Use npm `overrides`** — the package is transitive only; adding it as a direct dev dependency would misrepresent the dependency graph. `overrides` is the correct, minimal mechanism for this.

```json
"overrides": {
  "follow-redirects": ">=1.16.0"
}
```

**Verify with `npm audit`** — the fix is confirmed when `npm audit` reports no remaining findings for `follow-redirects`.

## Risks / Trade-offs

- [Risk] A future `follow-redirects` release introduces a breaking change → Mitigation: the override uses `>=1.16.0` which accepts any compatible release; can be tightened to a specific range if needed.
- [Risk] Override silently ignored if npm version < 8.3 → Mitigation: project already uses Node/npm versions that satisfy this (verified by existing lockfile v3 format).

## Planner Notes

Self-approved: pure dependency bump, no new capabilities, no schema changes, no API surface changes.
