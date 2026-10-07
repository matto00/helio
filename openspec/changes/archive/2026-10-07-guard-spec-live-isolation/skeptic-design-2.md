## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD a606a9833910e36ad544e6aff6e4b87049245559. The worktree is at base, the change dir is untracked, and no code has been edited yet.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/guard-spec-live-isolation/HEL-1330`.
- **Copy count is still 32.** I grepped `e2e/` for a `function registerAndLogin` / `registerAndLogin(WithDashboard)` definition: 32 files.
- **CR1 (verification plan) is addressed.**
  - D6(b) and task 1.9 now require collected/passed/skipped counts for each file, and say that zero collected or all skipped never counts as a pass.
  - D6(c) names the two quarantined files and the two `*.regression.spec.ts` harnesses as "not run, by design". Each is verified by `check:e2e-types` plus a per-file mechanical diff and is labelled in `verification.md` and in the PR. I confirmed that `check:e2e-types` exists (`package.json:38`, `tsc --noEmit -p e2e/tsconfig.json`).
  - I re-confirmed that `playwright.config.ts:32-42` still has `testIgnore` covering `**/*.regression.spec.ts` and the quarantine list. Taking the not-run option is consistent with C1, since no config edit is needed.
- **CR2(a), email domain, is addressed.** D4 adds `uniqueEmail(prefix, label?, domain = "example.test")`. My live grep matches the corrected list of `@example.com` files:
  - hel1065, 1094, 1096, 1189, 572, 588, 773, both hel813 files, 909, 910 and 968.
  - Every other copy uses `@example.test`, including focus-presence (`hel520-`) and state-surface (`hel866-`).
- **Email prefixes and display names are preserved verbatim.** I checked password and displayName on every copy:
  - The password is `correcthorsebattery1` everywhere.
  - Display names vary by file (`HEL-520 Regression ${label}`, `"HEL-1023 e2e"`, `"HEL-1230"`, and so on). D4 passes `displayName` through unchanged.
  - Three copies build their email without a label: hel1023, hel1260 and hel1275 (`hel1023-${Date.now()}-…`). The optional `label?` covers them. See note 1.
- **CR2(b), logging, is addressed.** hel1023 and hel1028 contain `[HEL-10xx e2e] throwaway user registered:`. hel1260 logs at its call site. Under D4 these three pass `logEmail: false` and keep their own line, so nothing is logged twice. The copies with no log line at all gain the helper's line: hel1003, 510, 519, 1275 and focus-presence. C2 explicitly allows that.
- **CR2(c), variants and ordering, is addressed.**
  - My live dump shows the "Add dashboard" wait in exactly the seven files D4 lists: focus-presence, hel1003, 1079, 1080, 510, 516 and 519.
  - hel1080 is the only file that waits and then isolates (lines 28-30 of the dump). That order is the fixed internal order in D4: register → `uiLogin` → wait → isolate.
  - Every other copy with `isolate` does not wait. So the flags express each file exactly.
  - Other variants are handled at the call site: hel1230/hel1260 return the email, hel1275 returns the `/api/auth/me` id, hel503 seeds a dashboard, and hel910 is register-only on `page.request`.
- **CR2(d), guard logins, is addressed.** D4 has focus-presence and state-surface call only `registerUser` and keep their local cookie handoff. I checked the live code:
  - focus-presence (:45-58) hands off the registration cookie without logging in.
  - state-surface (:616-621) logs in over the API and then hands off the cookie.
  - Keeping both handoffs as they are leaves each file's `/settings` audit-row population unchanged.
- **D1 is still sound against the live cell** (`focus-presence-guard.spec.ts:161-238`).
  - Inserting isolate after the "Add dashboard" wait and before the three POSTs (:169-191) is correct.
  - The new `goto("/")` plus the dashboard-name wait comes before the `evaluate` at :236, so the `evaluate` runs on an app origin (C3 holds).
  - The CDP session is attached at :157 and survives same-target navigation.
- **D3:** Task 1.1 now captures main's lines before any edit, and the scratch-checkout wording is gone. The line references are still accurate: focus-presence :341, state-surface :381, :645, :702, :731.
- **Round-1 non-blocking notes:** all three are applied.
  - hel516:296 is declared out of scope.
  - In D2, the isolate now comes before `newCDPSession`.
  - The D3 wording is fixed.
- **AC coverage is unchanged from round 1:** ordering (D1/D2), population (D3, tasks 1.1/1.7), repeat-each 10 (D6a, 1.8), 4-leg CI (D6d), consolidation (D4, 1.2-1.5) and README (D5, 1.6; `e2e/README.md` exists). I found no TODO or TBD placeholders and no contradiction between the proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes

1. `uniqueEmail` with no label must produce `prefix-<ts>-<rand>`, not `prefix--<ts>-<rand>`, to keep the hel1023, hel1260 and hel1275 emails verbatim. The executor should state this in the helper or in its JSDoc.
2. D4 says "Every former local copy is deleted" but also keeps hel503's dashboard seed in "a thin local wrapper". That is fine, but the wrapper should call the shared `registerAndLogin({ isolate: true })` and contain only the seed. It must not be a renamed copy of the register and login logic.
3. Adding `expect(201)` to the regression harnesses and the quarantined files is allowed by C2. Mention it in their D6(c) diff labels so a reviewer does not read it as a body change.
