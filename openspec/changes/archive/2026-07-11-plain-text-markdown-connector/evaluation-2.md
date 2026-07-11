## Evaluation Report — Cycle 2

Scope: re-verification of the cycle-2 SSRF fix (commit `d108f12`) for the orchestrator-found
vulnerability in `ContentSourceSupport.fetchUrl`, per `orchestrator-security-followup.md`. Cycle 1
(spec/code/UI) already PASSed (`evaluation-1.md`) and is only re-checked here for regression.

### Phase 1: Spec Review — PASS
Issues: none.

- All 5 required items from `orchestrator-security-followup.md` are implemented and match
  `tasks.md` group 8 (8.1–8.5, all `[x]`): scheme/host/DNS-failure/address-range validation before any
  request; redirect safety; no upstream-body echo; test-only `resolveHost` override that never reaches
  production; tests for all denylist categories.
- `design.md`'s "Reusable seam #2" was updated to reflect the guard (verified via
  `git diff 1e748ed d108f12 -- design.md`) — the planning artifact matches the implemented behavior,
  with one small wording nit (see Non-blocking Suggestions): it says redirect targets are
  "re-validate[d]," but the actual mechanism is that Pekko's low-level client never follows 3xx at all
  (independently confirmed — no redirect-following classes exist in `pekko-http-core`/`pekko-http`
  1.1.0's jars), so there is no second validation pass to speak of. Same security outcome, different
  (and simpler) mechanism than the prose describes.
- No scope creep: diff is confined to `ApiRoutes.scala`, `ContentSourceSupport.scala`,
  `DataSourceService.scala`, and their test files, plus the openspec docs for this cycle.

### Phase 2: Code Review — PASS
Issues: none blocking.

Read `ContentSourceSupport.scala` in full (not diff-only) and independently verified each requirement:

1. **Validation guard is real and strictly ordered.** `fetchUrl` (line 145) calls `validateUrl` first;
   only on `Right(())` does it proceed to `Http(...).singleRequest` (line 156) — confirmed by reading
   the control flow, not trusting the docstring.
2. **Address-range coverage confirmed complete** (`isBlockedAddress`, lines 76–82, plus
   `isUniqueLocalIPv6`, lines 87–92): loopback, link-local (`169.254.0.0/16`/`fe80::/10` via
   `isLinkLocalAddress`), RFC1918 IPv4 (`10/8`, `172.16/12`, `192.168/16` via Java's
   `isSiteLocalAddress`), unique-local IPv6 `fc00::/7` (explicit top-7-bit check, since
   `isSiteLocalAddress` only covers the deprecated `fec0::/10` range), any-local, multicast — all
   independently re-verified with a standalone JVM probe (`InetAddress.getByName` on
   `::ffff:127.0.0.1`, decimal-integer `2130706433`, octal-looking `0177.0.0.1`, hex `0x7f000001`):
   IPv6-mapped-IPv4 correctly resolves to a flagged loopback address; the numeric-obfuscation
   formats either fail to parse or resolve to a *different, non-blocked* address (Java's own
   `InetAddress` parsing is stricter than libraries vulnerable to this class of bypass) — and because
   the guard checks the *resolved* `InetAddress` object, not the literal string, none of these classic
   SSRF string-obfuscation tricks bypass it.
3. **Scheme restriction confirmed**: only `http`/`https` (case-insensitive) accepted; scheme check
   happens before host resolution is even attempted (test asserts the resolver is never called for a
   rejected scheme).
4. **Redirect handling confirmed safe, not just claimed.** Verified independently (not just trusting
   the "isSuccess bug" narrative) that Pekko HTTP's low-level `Http().singleRequest` has no
   auto-redirect-following machinery at all (grepped `pekko-http-core_2.13-1.1.0.jar` /
   `pekko-http_2.13-1.1.0.jar` for redirect-following classes — none exist beyond the `StatusCodes`
   model itself). So a 3xx response is simply returned as-is; the code's explicit `code >= 200 && code
   < 300` check (replacing the old `isSuccess()`, which is also `true` for 3xx) then correctly rejects
   it as a generic non-success rather than treating the redirect stub body as fetched content. Live-
   tested this exact scenario end-to-end (see Phase 3) via a real redirect-to-metadata-IP request against
   a freshly-started server — correctly blocked with no address/body leaked.
5. **Error message confirmed generic** — `Left(s"Upstream returned HTTP $code")` (line 172), no
   `entity.data.utf8String`. Test asserts the literal injected secret string is absent from the error.
6. **`resolveHost` override scrutinized as a potential bypass vector — confirmed safe.**
   - Traced every call site: `ApiRoutes` constructor param `dataSourceUrlResolveHost` (default
     `ContentSourceSupport.defaultResolveHost`) → `DataSourceService(..., resolveHost)` → both
     `createTextUrl`/`refresh`'s `ContentSourceSupport.fetchUrl(url, resolveHost)` calls.
   - `Main.scala` (`grep`'d directly, lines 97–116) constructs `new ApiRoutes(...)` with 20 positional
     args ending at `corsAllowedOrigins` — it never supplies `dataSourceUrlResolveHost`, so production
     always gets `ContentSourceSupport.defaultResolveHost` (real DNS). Confirmed via direct read of
     `Main.scala`, not executor claim.
   - The override is not itself an exploitable bypass: it's a constructor-time dependency only 5 test
     files pass a non-default value for (`DataSourceServiceSpec`, `DataSourceRoutesSpec`); there is no
     HTTP-reachable path (no route, no request field) that lets an external caller supply or influence
     the resolver function. It's compile-time wiring, not runtime-configurable.
   - The test resolvers themselves are correctly scoped: both special-case only the literal string
     `"localhost"` (mapped to a fixed permitted public-style IP, purely to pass the *validation* gate —
     the actual TCP connection Pekko makes still resolves `"localhost"` via real system DNS to
     `127.0.0.1` to reach the local test server) and delegate every other host, including any literal
     IP a test supplies directly, to the real `defaultResolveHost`. Verified this design directly
     satisfies the concern: literal blocked-address tests (`127.0.0.1`, `169.254.169.254`, etc.) still
     go through real resolution and are still rejected even with the override installed
     (`DataSourceRoutesSpec` lines ~350+, `DataSourceServiceSpec` line ~306 comments and asserts this
     explicitly).
- **DRY/readable/modular**: guard logic lives once in `ContentSourceSupport`, shared by upload and URL
  paths, well-commented with root-cause rationale inline (matches the systematic-debugging law's
  evidence-gated style).
- **No dead code / no over-engineering.**

### Phase 3: UI Review — PASS
Issues: none blocking. One environmental gotcha discovered and corrected mid-review (see below) —
not a code defect, but material to how the verdict was reached.

**Critical process note**: `start-servers.sh` initially reported "backend already healthy... reusing"
against a backend process that had been running since 12:23:37 — **before** the fix commit `d108f12`
(12:52:51) even existed. Probing that stale server produced results consistent with the guard being
*absent* (154.254.169.254/127.0.0.1/RFC1918 requests appeared to proceed past validation, timing out
at 503 rather than being rejected with the expected validation error; a bad scheme produced a raw
500 rather than the expected clean rejection). Recognizing this as almost certainly a stale process
rather than a real regression, I killed it (PID 2361673) and re-ran `start-servers.sh`, which then did
a genuine fresh `sbt run` (new PID 2444330, started 13:00:14, well after the fix commit). All
re-verification below is against that fresh process — this is exactly the kind of trap
"verification-before-completion" exists to catch, and it would have been very easy to file a false
FAIL against a stale server.

Against the fresh server:

- **Blocked-address requests correctly rejected** via live `curl` against `POST /api/data-sources`
  (Bearer-token authenticated, real DB): `169.254.169.254` → 502
  `"URL host '169.254.169.254' resolves to a disallowed address"`; `127.0.0.1` → 502 (same pattern);
  `10.0.0.5` → 502 (same pattern); `file:///etc/passwd` → 502
  `"Unsupported URL scheme: file. Only http/https are allowed."`. No upstream body, no stack trace, no
  internal detail leaked in any case.
- **Happy path confirmed live**: a real public URL (`raw.githubusercontent.com/.../README.md`) → 201,
  `DataSource` created with `config.sourceUrl` set correctly.
- **UI flow exercised end-to-end** (Add Source → Text/Markdown → From URL →
  `http://169.254.169.254/computeMetadata/v1/` → Create source): surfaced `alert: "Failed to create
  text source."` inline, no blank screen, no unhandled exception. One console "error" entry is the
  browser's standard `Failed to load resource: 502` network log (not a JS exception) — same pattern as
  cycle 1's verified error-path convention. No data source was created for the rejected submission
  (confirmed via a follow-up `GET /api/data-sources` — no stray record).
- **No console errors** beyond the expected network-log entry for the blocked request.

### Regression check (cycle 1 items)
- Full backend suite: **1093/1093 passed** (up from 1072 in cycle 1 — +21 new SSRF tests), fresh run.
- Full frontend suite: **794/794 passed**, fresh run (no frontend changes this cycle, count matches
  cycle 1 exactly).
- `npm run lint` (zero-warnings) — clean.
- `npm run format:check` — clean.
- `npm run check:schemas` — clean, in sync.
- `npm run check:scala-quality` — clean (0 violations; soft-budget line-count warnings only,
  informational per the script's own exit-code policy, unchanged in kind from cycle 1).
- `npm run build` (frontend) — succeeds.
- ADT closure points, pipeline row-loading, route-dispatch safety, and `PayloadTooLarge`/413 were not
  touched by this diff and are covered by the full regression suite above — no regression.

### Overall: PASS

### Non-blocking Suggestions
- `design.md`'s "Reusable seam #2" prose says redirect targets are "re-validate[d] ... the same way" —
  slightly inaccurate; the actual (and simpler/more robust) mechanism is that Pekko's low-level client
  never follows redirects at all, so there's nothing to re-validate. Consider a one-line wording fix
  for accuracy, next time this doc is touched.
- DNS-rebinding TOCTOU is not addressed (and wasn't asked for): `validateUrl`'s resolution and the
  actual `Http().singleRequest` connection are two independent DNS lookups, so a fast-TTL DNS record
  could theoretically flip between validation and connection. This is a materially harder problem
  (full protection requires pinning the connection to the validated IP, which interacts with
  virtual-hosting/SNI) and wasn't part of the orchestrator's explicit ask. Worth a follow-up ticket if
  this connector's threat model needs to harden further, not a blocker for this cycle.
