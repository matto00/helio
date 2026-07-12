# HEL-287 — Address open Dependabot and CodeQL security alerts

## Title

Address open Dependabot and CodeQL security alerts

## Description (original ticket text)

### Context

GitHub's Dependabot and code-scanning (CodeQL) currently report 5 open alerts on `matto00/helio` (as of 2026-07-01). This ticket bundles all of them into one security-hardening pass.

### What

**Dependabot:**

- **#52** `echarts` 6.0.0 → 6.1.0 (medium, GHSA-fgmj-fm8m-jvvx / CVE-2026-45249): XSS in Lines-series tooltip rendering — if `series.data[i].name` contains raw HTML and no custom `tooltip.formatter` is set, it's rendered via `innerHTML`. Direct dependency, `frontend/package.json` (`"echarts": "^6.0.0"`). Fix: bump to `^6.1.0`.
- **#50 / #47** `@babel/core` 7.29.0 → 7.29.6 (low, GHSA-4x5r-pxfx-6jf8 / CVE-2026-49356): arbitrary file read via `sourceMappingURL` comment when compiling untrusted code. Transitive dev dependency in both root and `frontend/` lockfiles (via `eslint-plugin-react-hooks` and `@vitejs/plugin-react`). Fix: bump/override to `>=7.29.6`.

**CodeQL (code scanning):**

- **#8** `js/clear-text-storage-of-sensitive-data` (high): `frontend/src/features/auth/state/authSlice.ts:214` stores the OAuth callback token in `sessionStorage` as clear text (`sessionStorage.setItem(SESSION_STORAGE_KEY, action.payload.token)`). The identical pattern also exists at lines 180 and 197 for the login/register flows (CodeQL only flagged the OAuth case, but all three share the same design). Needs a decision on acceptable mitigation for a SPA — e.g. accept as a documented risk, encrypt-at-rest with a session-scoped key, or move to an httpOnly cookie issued by the backend — before making a code change.
- **#7** `js/incomplete-sanitization` (high/warning): `scripts/check-scala-quality.mjs:49` builds a regex from `FQN_PREFIXES` via `p.replace(/\./g, "\\.")`, which only escapes literal dots and not other regex metacharacters. Low real-world risk today since `FQN_PREFIXES` is a static hardcoded list, but should use a proper regex-escape helper for correctness/future-proofing.

### Acceptance criteria

- [ ] `echarts` bumped to `>=6.1.0` in `frontend/package.json` / lockfile; Dependabot alert #52 resolved
- [ ] `@babel/core` resolves to `>=7.29.6` in both root and `frontend/` lockfiles (via bump or override); alerts #50/#47 resolved
- [ ] A documented decision is made on the auth-token storage mitigation for alert #8, and implemented across all three call sites (login/register/OAuth) in `authSlice.ts` for consistency, not just the flagged line
- [ ] `scripts/check-scala-quality.mjs` regex construction properly escapes all regex metacharacters, not just dots; `check-scala-quality` script still passes on the existing codebase
- [ ] All 5 alerts (#52, #50, #47, #8, #7) show as resolved/fixed in GitHub's Dependabot and code-scanning views after merge

---

## Scope update from discovery (2026-07-12, this delivery run)

Re-investigation against the currently-open alert set (the ticket was written 2026-07-01; a prior stale attempt on a since-discarded branch is NOT being resurrected — this is a fresh pass off current `main` @ `e04d5006`) found the alert set has grown:

**Dependabot — 6 open alerts (was 3 named in the ticket):**

- **#52** `echarts` — as above.
- **#50** (root `package-lock.json`) / **#47** (`frontend/package-lock.json`) `@babel/core` — as above.
- **#53** (root `package-lock.json`) `js-yaml` 4.0.0–4.1.1 → 4.2.0 (moderate, GHSA-h67p-54hq-rp68): quadratic-complexity DoS via merge-key handling with repeated aliases. Transitive via `eslint` → `@eslint/eslintrc`.
- **#54** (root `package-lock.json`) / **#55** (`frontend/package-lock.json`) `js-yaml` ≤3.14.2 → 3.15.0 (moderate, same advisory). Transitive via `ts-jest` → `@istanbuljs/load-nyc-config` → `babel-plugin-istanbul`.

These are new since the ticket was filed and are folded into this delivery per explicit user instruction — all are patch/minor bumps of transitive dev-dependencies, same remediation shape as the babel/core fix (targeted `overrides`, no direct API usage by our code).

**npm-audit-only, NOT an open GitHub Dependabot alert:** `brace-expansion` (moderate, GHSA-f886-m6hf-6m8v / GHSA-jxxr-4gwj-5jf2). All prior Dependabot alerts for this package (#6, #7, #27, #28, #29, #41) are `fixed` or `auto_dismissed` — none currently open. Included in this change ONLY if a clean, scoped, patch/minor override resolves it with no risk (per user instruction); otherwise noted and skipped, not allowed to block delivery.

**CodeQL — 2 open alerts**, both proceeding as originally scoped: #7 (regex-escape fix) and #8 (see decision below).

### Decision on CodeQL #8 (from the ticket's own decision point)

**User has decided: Option 3 — full httpOnly-cookie migration**, not the accept/document or encrypt-at-rest options. This is a deliberate, explicit choice to do the "real fix" rather than a scanner-satisfying patch, made after the orchestrator escalated the three options (with a recommendation for the lighter-weight accept/document option, which the user overrode).

This elevates HEL-287 from a dependency-bump ticket to a security-critical auth-flow change. Requirements (all binding, to be designed explicitly in `design.md`):

1. **Backend sets the session token as a cookie** on LOGIN, REGISTER, and OAUTH-CALLBACK responses; **clears it on LOGOUT** (`Set-Cookie` expired / `Max-Age=0`). Attributes: `HttpOnly`; `SameSite` and `Secure` chosen via config (environment-conditioned, not hardcoded) — see design.md for the concrete values and the deployment-topology evidence behind them; `Path=/`; `Max-Age` matching the existing 30-day session TTL.
2. **Backend auth directive reads the session token from the cookie**, not the `Authorization` header, for browser-session auth. Decide dual-mode vs. hard cutover. Context: HEL-288 (merged this session) already hashes session tokens at rest and its `V45` migration deleted all existing sessions, so a hard cutover of the *session* auth path is safe (no live sessions to preserve) — but Personal Access Token (PAT) bearer-header auth (`helio_pat_...`, used by `helio-mcp` and other non-browser API clients, HEL-148) is a **separate credential type and must keep working unchanged** via the `Authorization` header. Document the choice and the PAT/session separation explicitly.
3. **Frontend**: `httpClient` uses `withCredentials: true`; `authSlice` stops storing the token in `sessionStorage` and stops reading/persisting it from the response body; remove the manual `Authorization`-header plumbing (`setAuthToken`) for session auth. This is the change that actually closes alert #8 — the token must no longer be in JS-readable storage.
4. **CSRF** — required once the token is an auto-sent cookie. Design an explicit defense for state-changing requests (custom-header requirement that a cross-site request can't attach without a CORS preflight the backend would reject). Document the mechanism and why it's sufficient given the chosen `SameSite` value.
5. **CORS** — `Access-Control-Allow-Credentials: true` with a specific allowed origin (never `*` with credentials); verify both dev (Vite proxy) and prod CORS config.
6. **Verification**: full Playwright pass over login, register, OAuth callback, an authenticated request succeeding via cookie, logout clearing the cookie, and confirmation the token is no longer in `sessionStorage` (the alert-#8 acceptance check) — plus the dependency bumps (build+tests green) and the CodeQL #7 fix.

Given the security-critical surface, expect (and this is welcomed by the user) extra skeptic scrutiny rounds on the cookie-attribute and CSRF-mechanism choices specifically.

### Documentation requirement

The PR description must state exactly which alert number(s) each change closes.
