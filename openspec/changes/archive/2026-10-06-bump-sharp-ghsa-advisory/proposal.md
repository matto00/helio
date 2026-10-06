## Why

GHSA-wq5f-xc86-pv6w (high; librsvg CVE-2026-96889 bundled in sharp's libvips) turns the CI `security` job's
"Frontend audit (frontend/)" step red, which blocks `ci-complete` on every PR. `frontend/package-lock.json` resolves
sharp 0.35.4; 0.35.5 is the first patched release and is published (dist-tag `latest`).

## What Changes

- Raise the existing scoped override `overrides["@vite-pwa/assets-generator"].sharp` in `frontend/package.json` from
  `^0.35.4` to `^0.35.5` (the floor, so a later re-resolve can never land on a vulnerable version).
- Regenerate `frontend/package-lock.json` lock-only. Expected version changes: `sharp` 0.35.4→0.35.5 plus its
  `@img/sharp-*` platform packages (0.35.4→0.35.5) and `@img/sharp-libvips-*` (1.3.3→1.3.4); nothing else.
- No allowlist entry, no `.audit-ci.jsonc` change, no source change.

## Capabilities

### New Capabilities

### Modified Capabilities

None — dependency patch only; `skip_specs: true`.

## Impact

- `frontend/package.json` (one line), `frontend/package-lock.json`.
- sharp is dev-only, used solely by the manual `npm run generate-pwa-assets` script; `vite build` does not invoke it.
- Root and `helio-mcp/` lockfiles contain no sharp — untouched.

## Non-goals

- Bumping `@vite-pwa/assets-generator`. 1.0.3/1.0.4 (in range) and 2.0.0 (major) exist, all declaring `sharp ^0.35.4`;
  none sets a patched floor by itself, so moving the parent adds churn without removing the need for the override.
  Revisiting the override once the parent moves is a noted follow-up, not this ticket.
- Clearing the frontend's moderate advisories (HEL-1320) or any other advisory.
- Regenerating committed PWA icons.
