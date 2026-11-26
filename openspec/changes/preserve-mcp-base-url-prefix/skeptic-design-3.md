## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `014317f538d3ec10f0394407f2c36d7e8e4fb7d4` (branch `bug/mcp-base-url-prefix/HEL-1161`; HEL-1160 `c939f3781` is an ancestor). The planning artifacts are untracked in the change directory. Scratch prototypes: `/home/matt/Development/helio/.concertino/scratch/HEL-1161/skeptic-design-3/proto.cjs` (Decision 5 matcher) and `url.cjs` (builder and URL probes).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/mcp-base-url-prefix/HEL-1161`. I read the lane constraints and followed them.
- **I read the live code myself:** `httpClient.ts` (buildUrl, send, postMultipart, default fetchImpl), `oauth/familyClient.ts`, `oauth/patCheck.ts`, `config.ts`, `httpConfig.ts:73-82`, `httpClient.originGuard.test.ts`, `requestPathGuard.test.ts` and `tools/write.ts:204-214`. The design's Context section matches the code:
  - root-relative resolution;
  - string concatenation in FamilyClient and patCheck;
  - `loadConfig` does no validation;
  - `loadHttpConfig` only runs `new URL()`;
  - the build call is synchronous in `send` and `postMultipart`;
  - the HEL-1160 tests assert a synchronous throw.
- **Decision 5 applied to the real source set (61 files, using the guard's own exclusion logic).** I wrote an AST prototype of rules a1, a2 and a3 and check b. It finds:
  - a1: only `oauth/patCheck.ts` `` `${apiBaseUrl}/api/tokens` ``;
  - a2: only `oauth/familyClient.ts` `` `${this.apiBaseUrl}${path}` ``;
  - a3: no real sites. `write.ts:209-211` is not flagged: the second `+` has a template operand, and the first `+` has two string literals;
  - b: exactly 3 `fetch(` calls (`httpClient.ts:179`, `familyClient.ts:98`, `patCheck.ts:23`).

  So on main the guard is red on exactly the two intended pre-fix sites and nothing else. Once both sites call `buildRequestUrl(`, a1 and a2 have zero real matches, and check b passes with exactly 3 allow-listed sites.
- **Fixture non-vacuity:** all five positives match: pos1 via a2, pos2 and pos3 via a1, pos4 and pos5 via a3. Both negatives (the real three-line `write.ts` shape and `` `/api/x/${pathSegment(id)}` ``) do not match. A naive regex implementation of a1 and a3 gives the same result on the real source.
- **Existing guard:** it counts 63 sites today (`MIN_SITES` 63 holds). The planted `` `${prefix}/api/x/${id}` `` mutation is caught only by the new rule a1, so the mutation is not redundant.
- **Builder behaviour (`url.cjs`)**, using the design's algorithm with the bare-stripped resolution:
  - Prefix is preserved for both `https://h/helio` and `https://h/helio/`.
  - Every task 1.1 containment vector is refused: `/api/../../tokens`, `/../x`, `/%2e%2e/x`, `/.%2e/x`, `/../helio2/x`.
  - `/\evil.example/x` and `/\t/evil.example/x` are refused under both root and prefixed bases.
  - `/https://evil.example/x` is refused by the origin check.
  - A `localhost:8080` base is refused.
- **Red claims on main** (same probe, main's `new URL(path, base + "/")`):
  - `/https://evil.example/x`, `/api/x y`, `/api/x\u0000` and the dot-segment vectors are sent on main.
  - A `localhost:8080` base throws `Invalid URL` synchronously.
  - FamilyClient and checkPat with a trailing-slash base produce `//api` on main.
  - `loadHttpConfig` accepts `localhost:8080`, `ftp://h` and `https://h/?q=1` on main, and rejects `helio.test/api` (the GUARD label is correct).
  - All of these match the RED-FIRST and GUARD labels in tasks.md.
- **Coverage:** every ticket AC and both owner scope additions map to a task: prefix → 1.1/2.1; config → 1.1/2.4; no synchronous throw → 1.1/2.2; guard widening → 1.2/2.5/3.1; FamilyClient → 1.2/2.3; origin and `..` under a prefix → 1.1/2.1. Nothing reaches into HEL-1162 or HEL-1163.

### Verdict: REFUTE

### Change Requests

1. **Remove (or reconcile) design.md Decision 5's "Builder note" permitting `"./" + stripped` resolution. It contradicts tasks.md 1.1 and the spec.**
   - **The design text:** Decision 5 ends with "resolving `"./" + stripped` instead of the bare stripped path is allowed ... containment is checked the same way either way".
   - **What I measured:** the two forms give different outcomes.
     - Under the `"./"` form, `/https://evil.example/x` resolves to `https://helio.test/https://evil.example/x`, and with base `https://h/helio` to `https://h/helio/https://evil.example/x`.
     - Both are same-origin and inside the prefix, so they are **sent**.
     - The same holds for `/http:evil.example/x` and `/javascript:alert(1)`.
     - Under the bare form, the origin check refuses all three.
   - **Why it matters:**
     - tasks.md 1.1 (no-sync-throw bullet) requires `/https://evil.example/x` to reject with `HelioRequestUrlError` with zero requests.
     - The spec scenario "Origin change is refused" uses "a path starting `/https://`" as its example.
     - An executor who takes the permitted `"./"` option ends up with a red test and an unsatisfiable spec example after implementation. They would have to rewrite the test or the spec alone, which is the same failure mode as rounds 1 and 2.
     - Under `"./"`, no non-`//` path can change origin, so the origin check becomes unreachable.
   - **Required.** Either:
     - (a) **recommended:** delete the Builder note and state that the builder resolves the bare stripped path. A first segment containing `:` (for example `/a:b/x`) is then refused as an origin change, which is acceptable because every in-repo path starts `/api/`. Or:
     - (b) keep `"./"`, and change tasks.md 1.1 and the spec's "Origin change is refused" scenario to say that `/https://...` is sent same-origin under the prefix, and that the origin check is defence in depth with no reachable vector.

### Non-blocking notes

- **Check (b) should match the literal `fetch(` (no whitespace), or use the AST.** A `\bfetch\s*\(` regex also matches three comments in `context.ts` (lines 153, 193, 388: "fetch (..."), which would make the guard red on legitimate code. It is worth one sentence in Decision 5.
- **Rule a3, read strictly, misses a left-associative chain** such as `"https://h" + "/api/x/" + id`. The outer `+` has a binary left operand, not a string literal. This is a false negative and not required by the ticket; check (b)'s allow-list bounds the surface anyway.
- A path fragment (`/api/x#f`) is accepted and the fragment is not sent by fetch. This is harmless and matches today's behaviour.
