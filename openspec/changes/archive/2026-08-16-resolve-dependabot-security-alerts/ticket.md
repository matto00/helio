# HEL-688: Resolve 35 open Dependabot security alerts (15 high, 19 medium, 1 low)

## Description

35 open Dependabot alerts across the repo's three npm lockfiles, unaddressed for an extended period. Pulled directly from `gh api repos/matto00/helio/dependabot/alerts` on 2026-08-16:

* **15 high**, 19 medium, 1 low
* `frontend/package-lock.json` — 23 alerts
* `helio-mcp/package-lock.json` — 10 alerts
* root `package-lock.json` — 2 alerts

## Affected packages

`frontend/` (10 distinct advisories, several with multiple alerts):

* `axios` — 10 alerts (prototype pollution via nested option objects/auth subfields, DoS via recursive formData/formToJSON, `maxBodyLength` bypass via fetch-adapter streams and HTTP/2 uploads, inherited-proxy leak after interceptor cloning, `NO_PROXY` bypass for `0.0.0.0`). **An open Dependabot PR already exists — #258, bumping 1.16.0 → 1.18.0 — whose release notes claim fixes for redirect header safety, URL hardening, prototype-pollution-safe config reads, and `NO_PROXY` matching. Verify it actually clears these alerts before assuming it's sufficient; some may need a newer version than 1.18.0.**
* `react-router` — 5 alerts, 3 high (RSC Mode CSRF bypass, unauthenticated DoS via inefficient route matching, open redirect via backslash in `<Link>`/`useNavigate`, RSCErrorHandler missing protocol validation (XSS), arbitrary constructor injection via `deserializeErrors()` in SSR hydration)
* `postcss` — 2 alerts, 1 high (path traversal via `sourceMappingURL` auto-loading → arbitrary `.map` file disclosure; an incomplete-fix follow-up of the same class)
* `fast-uri` — 2 alerts, both high (host confusion via backslash authority delimiter, two separate GHSAs)
* `brace-expansion` — 1 advisory, 2 alert entries, high (DoS via exponential-time expansion)
* `js-yaml` — 1 alert, high (quadratic CPU consumption in `!!omap` resolution — CVE-2026-59870 fix not backported)
* `sharp` — 1 alert, high (inherited `libvips` CVEs)

`helio-mcp/` (5 distinct advisories):

* `hono` — 4 alerts (cross-user SSR output disclosure via `memo()`, `Connection`-header response-header leak in Proxy Helper, algorithmic-complexity DoS in Language Middleware, ReDoS in CORS middleware)
* `ip-address` — 3 alerts, all medium-high (leading-zero-octet decimal/octal mismatch, CIDR-suffix special-use-classification bypass, IPv4-mapped/NAT64 misclassification — all SSRF/trust-boundary bypass variants)
* `fast-uri` — 1 alert (same GHSA class as the frontend one)
* `@hono/node-server` — 1 alert, medium (path traversal via encoded backslash on Windows)

**root** `package-lock.json`: `js-yaml` — 2 alert entries, same advisory as the frontend one.

## Scope

* Bump each flagged package to a version that resolves its advisories, across all three lockfiles (`frontend/package-lock.json`, `helio-mcp/package-lock.json`, root `package-lock.json`).
* `axios` and `react-router` are both runtime-relevant to `frontend/` (not just dev tooling) — check for breaking API changes across any major-version jump and exercise the affected code paths (HTTP client usage, routing) after upgrading, not just a green `npm test`.
* Close or supersede dependabot's existing PR #258 once its axios bump is folded in (or confirmed insufficient and superseded by a larger bump).
* Re-run `gh api repos/matto00/helio/dependabot/alerts` (or check the repo's Security tab) after the bump to confirm the alert count actually drops — a version bump that satisfies `npm audit` doesn't always fully resolve every listed GHSA.

## Acceptance criteria

- [ ] All 35 currently-open Dependabot alerts are resolved (verified via the Dependabot alerts API/UI post-merge, not just by version-bumping and assuming).
- [ ] `sbt test`, `npm test` (root, `frontend/`, `helio-mcp/`), lint, and build all pass with the bumped dependencies.
- [ ] No functional regression in axios-based HTTP calls or react-router navigation — spot-check the app's actual request/routing behavior, not just unit tests, given both packages are runtime-critical.
- [ ] PR #258 is closed as superseded (or merged, if it turns out to be the complete fix) rather than left open alongside this change.

## Out of scope

* Any alerts that open *after* this ticket is scoped (new Dependabot findings from a future scan are a separate follow-up, not scope creep onto this one).

## Delivery notes (from the dispatching session)

* Merge/CI is handled by the parent session manually (never `--auto`).
* This run is parallel with HEL-412 (backend+frontend pipeline-editor work) — no code overlap expected; shared infra is worktree scripts/ports only.
* No Flyway/backend involvement: npm/JS-only across the 3 workspaces.
