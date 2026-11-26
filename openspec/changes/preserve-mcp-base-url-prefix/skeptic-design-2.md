## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 014317f538d3ec10f0394407f2c36d7e8e4fb7d4 (main plus the untracked change dir; HEL-1160 c939f3781 is an ancestor).

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/mcp-base-url-prefix/HEL-1161`.
- **What I read.** ticket.md, proposal.md, design.md, tasks.md, specs/mcp-request-path-safety/spec.md and skeptic-design-1.md. Against those I read the live `helio-mcp/src/httpClient.ts`, `config.ts`, `httpConfig.ts`, `oauth/familyClient.ts`, `oauth/patCheck.ts`, `requestPathGuard.test.ts`, `httpClient.originGuard.test.ts`, `tools/write.ts:205-212` and `index.ts:38-50`.
- **Decision 1 (builder), including round 2's pre-resolution character check, run on a probe.**
  - Probe: `/home/matt/Development/helio/.concertino/scratch/HEL-1161/skeptic2-builder-probe.mjs`. The WHATWG parser is deterministic, so a single run gives a stable reading.
  - Bases tested: `https://helio.test`, `https://h/helio`, `https://h/helio/`, `localhost:8080` and `https://h/?q=1`. Each was run against 19 paths.
  - Root base: the HEL-1160 vectors `//evil.example/x`, `/\evil.example/x` and `/\t/evil.example/x` are all rejected (proto-rel, then bad char, then bad char). This means round-1 CR1 is resolved.
  - Prefixed base, with and without a trailing slash (identical results): every path that should be refused is refused. That covers `/api/../../tokens`, `/../x`, `/%2e%2e/x`, `/.%2e/x`, `/../helio2/x`, `/api/%2e%2e/%2e%2e/x` and `/https://evil.example/x`, plus the backslash, control and space vectors. `/api/x` with `{a:1}` gives `https://h/helio/api/x?a=1`.
  - The builder's own base check rejects `localhost:8080` and `https://h/?q=1` as bases.
  - `/api/mcp-refresh-families/abc/rotate` stays under the prefix.
- **RED claims in task 1.1 checked against main's behaviour.** Main's `buildUrl` sends:
  - `/api/x y` to `https://helio.test/api/x%20y`;
  - `/api/x\u0000` to `https://helio.test/api/x` (trailing C0 is stripped).

  So the space/control RED vector is real. Main's FamilyClient with base `https://h/helio/` produces `https://h/helio//api/mcp-refresh-families`, so that RED is real too. `loadHttpConfig` on main only runs `new URL()`, so `localhost:8080`, `ftp://h` and `https://h/?q=1` pass it (RED), while `helio.test/api` throws (correctly labelled GUARD). `loadConfig` does no validation at all, and `"  "` yields a blank base (RED). Round-1 CR2 is resolved.
- **Decision 5 matchers, prototyped and run against the real scanned source set.** Probe: `/home/matt/Development/helio/.concertino/scratch/HEL-1161/skeptic2-guard-probe.mjs`.
  - (a1) flags only `oauth/patCheck.ts:23`, which is correct.
  - (a2) flags only `oauth/familyClient.ts:98`, which is correct.
  - (a3), implemented with "string literal" meaning a `"`/`'` literal, also flags `tools/write.ts:210`. See CR1.
  - The `fetch(` sites in the scanned set are exactly `httpClient.ts:179`, `oauth/familyClient.ts:98` and `oauth/patCheck.ts:23`.
  - No `xfetch(`-style identifiers exist, so a `\bfetch\(` allow-list floor of 3 is accurate.
- **Callers and regressions.**
  - The URL builders are fed from `httpApp.ts:163,215`, `oauth/routes.ts:108` and `oauth/provider.ts:112` (all `config.apiBaseUrl`), and from `index.ts:43` (`loadConfig`).
  - `index.ts` catches a `loadConfig` throw and calls `process.exit(1)`, so "server SHALL NOT start" holds.
  - No test constructs a client with an empty or scheme-less base. The `baseUrl: ""` hit in `connectorHandlers.test.ts:158` is a connector field, not the client base.
  - No helioApi literal path contains a space, a `\` or a `?` (grep).
  - `familyClient.test.ts` already spies on `globalThis.fetch`, so the planned FamilyClient tests are writable.
- **Scope.** HEL-1162 (Retry-After) and HEL-1163 (timeouts) are untouched. No backend, frontend, schema or migration change is planned. Excluding `scripts/` and `e2e/` is now stated explicitly.
- **Round-1 non-blocking notes** are all addressed: blank-base trimming is decided, the builder now checks the base's search and hash, and path escapes are tested on the builder rather than through FamilyClient.

### Verdict: REFUTE

### Change Requests

1. **Rule (a3) and its `write.ts` negative misdescribe the real code. As written, the widened guard is red on legitimate source (design.md Decision 5, the (a3) bullet and the "negatives that MUST NOT match" list; tasks.md 1.2/2.5).**
   - **The real code.** `helio-mcp/src/tools/write.ts:209-211` is:
     ```
     "...declared schema (PATCH " +
     "/api/data-sources/:id/schema) — any field of the CURRENT schema omitted from `fields` is " +
     `DROPPED. Each field's \`type\` MUST be one of the ${CANONICAL_COLUMN_TYPES_LIST} ` +
     ```
   - **What the design misses.** The design quotes only the first `+`, which sits between two string literals. The `/api` literal is also the left operand of a second `+`, and that `+`'s right operand is a template literal containing an interpolation.
   - **Why (a3) flags it.** (a3) flags "a `+` whose one operand is a string literal starting `/api` and whose other operand is NOT a string literal". A template literal is not a string literal: TS parses a template with substitutions as a TemplateExpression. My prototype flags this site.
   - **What goes wrong.** Task 2.5 ("guard green with the real sites") will be red on unchanged legitimate code. The executor then has to narrow the rule alone, which is the round-1 CR3 failure mode again. The negative fixture as quoted would also not exercise this shape.
   - **Required:**
     - State the (a3) operand rule exactly. Recommended: flag only when the other operand is an identifier, member access, call or parenthesised non-literal; treat a string or template literal (with or without `${}`) as a literal and do not flag it. An alternative is to restrict (a3) to `fetch(` arguments.
     - Replace the `write.ts` negative fixture with the real three-line shape: string `+` `"/api/..."` `+` template-with-interpolation.
     - Add a positive fixture that keeps the narrowed rule non-vacuous, for example `"/api/x/" + id`.

### Non-blocking notes

- **A colon in the first segment.** Stripping the single leading `/` and resolving means a path whose first segment contains `:` (for example `/a:b/x`) parses as a scheme and is refused with `origin null`. This is safe, and every in-repo path starts `/api/`, but the refusal message will be odd. Resolving `"./" + stripped` keeps the same containment and avoids the scheme parse. This is the implementer's choice.
- **Name the cross-origin vector in task 1.1's no-sync-throw bullet.** Use `/\evil.example/x` or `/https://evil.example/x`. The two behave differently on main:
  - `/https://evil.example/x` is sent same-origin on main, so it is red because a request goes out, not because of a synchronous throw;
  - `/\evil.example/x` is red because main throws synchronously.

  Either is red, but naming one keeps the "stated reason" honest.
- **The existing guard's header comment** (`requestPathGuard.test.ts:1-4`) and its `MIN_SITES` comment should be updated to describe checks (a) and (b) once they are added.
