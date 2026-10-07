## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `27b860d165a3a331c6f3cf4342c01c90294f8189` against live-resolved base `a606a9833910e36ad544e6aff6e4b87049245559`.
The diff touches only `e2e/**` and `openspec/changes/guard-spec-live-isolation/**` (C1 holds: no product code,
no `playwright.config.ts`, no workflow).

Evidence directory (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1330/evidence/.concertino/runs/HEL-1330/eval-logs/`
(`eval-guards-repeat3.log`, `eval-views.txt`, `main-views.txt`, `eval-migrated.json`, `eval-migrated.log`, `eval-emails.txt`).

### Phase 1: Spec Review — FAIL

- AC1 (isolate -> seed -> `goto("/")` -> `evaluate`): PASS. `e2e/focus-presence-guard.spec.ts:149-156` registers, hands
  off the cookie, loads `/`, waits for the shell, then `isolateLivePage`. The seed follows, then `:233-237` runs
  `goto("/")` -> `ROUTE_READY_MARKERS["/"]` -> `evaluate(theme)` -> `goto(route)`. C3 holds: nothing touches
  `about:blank` before the next app `goto`. `state-surface-contrast-guard.spec.ts:546-550` adds an explicit isolate
  at the top of `newCell`. The seed order there is unchanged and the theme stays on `addInitScript`. design D2
  documents this deviation and it is sound, because that spec never has a live page before its first `goto`.
- AC2 (population unchanged): PASS, verified independently (see Phase 2).
- AC3 (`--repeat-each 10` at 2 workers under nice, plus green 4-leg CI): local part accepted (see Phase 2). I did not
  repeat the full 10x run. CI is the Delivery gate's job and cannot be measured here.
- AC4 (consolidate local `registerAndLogin` copies, README note): every one of the 32 base-tree copies is deleted
  (`git grep` at base lists 32; at HEAD none remain except hel503's thin `registerAndLoginWithDashboard` wrapper that
  D4 allows). The README section was added.
- Planning artifacts reflect final behavior: **FAIL**. design.md D4 says "`loginThenIsolate` is re-expressed on top
  of [`uiLogin`]". That was not done (see CR1). The stated reason ("would make `auth.ts` and `isolateLivePage.ts`
  import each other") is true only for one placement. It is avoidable, so the deviation is unjustified and leaves
  design.md out of sync with the code.
- Tasks: all checked; each matches the diff except the D4 point above.
- CONSTRAINTS C1-C4: honored (C2 detail below).

### Phase 2: Code Review — FAIL (one DRY item; everything else clean)

Gates (my own fresh runs, in `WORKTREE_PATH`):
- No changed file matches `frontend/**` or `backend/**`, so the configured gate set does not formally trigger. I ran
  the relevant ones anyway: `npm run lint` rc 0, `npm run format:check` clean, `npm run check:e2e-types` rc 0.
- Both guards: `nice -n 19 npx playwright test focus-presence-guard state-surface-contrast-guard --workers 2
  --repeat-each 3` gave **84 passed (6.7m), EXIT 0** (`eval-guards-repeat3.log`). This is 3x, not the executor's
  10x. It is fresh evidence that the reordered guards are green and stable across repeats.
- Population (D3): `sort -u` of every `[HEL-520 focus-presence guard] view` / `[HEL-866 guard] view` line in my run
  (138 lines = 46 x 3) is **identical** to main's 46 distinct lines (`diff` empty). The `elements probed ...` and
  `unresolvedFraction` lines also match main's exactly, once divided by the repeat count. Provenance of main's
  baseline does not rest on mtimes. Every file in `e2e-logs/` has the same mtime, so a relocation rewrote them and
  mtime ordering proves nothing. Instead, `main-baseline.log` cites `focus-presence-guard.spec.ts:153`,
  `state-surface-contrast-guard.spec.ts:768/861/951`. Those are the base files' `test(` lines. At HEAD the same
  tests sit at `:138`, `:761/854/944`. That is self-authenticating evidence the baseline ran against base code.
- 27 default-collected migrated specs, once, `--workers 2`, nice: **132 passed (5.0m), EXIT 0**. JSON stats:
  expected 132, skipped 0, unexpected 0, flaky 0. Every per-file collected count matches the executor's
  verification.md table exactly, and no file has 0 collected or all skipped (`eval-migrated.json`).
- Throwaway emails from my runs: 220 distinct, in `eval-emails.txt`. None is `matt@helio.dev`. Nothing deleted.

Per-file preservation (executor claim checked mechanically for all 32 files):
- I extracted each base local copy and compared it with HEAD's `AUTH` const. Prefix, domain (`example.com` vs
  `example.test`) and displayName (`<name> <label>`, or label-less for hel1023/1230/1260/1275) are preserved.
  `waitForShell` is set exactly where the copy waited for "Add dashboard" (hel1003, 1079, 1080, 510, 516, 519; the
  focus-presence wait is re-inlined). `isolate: true` is set exactly where the copy itself isolated. A per-file count
  of `isolateLivePage(page)`/`about:blank` confirms this: every base in-copy isolate became a flag (1080, 1085, 1087,
  1088, 1090, 1094, 1095, 1096, 1169, 1189, 1230, 503, 572, 588, 909), and every call-site isolate count is unchanged
  (1023, 1028, 1065, 1079, 1260, 1275, 516, 520reg, 773, 813, 813reg, 968).
- C2: across all `e2e/*.spec.ts`, the only added lines that are not imports, `AUTH` fields, comments or call-site
  args are the focus-presence reorder, the hel1023/1028 log lines re-emitted at call sites, hel1275's `/api/auth/me`
  check moved to its call site (same position, same `toBe(200)`), hel910's `registerUser`, and state-surface's
  isolate and `registerUser`. Per-file counts of `test(`/`skip`/`fixme`/`setTimeout`/`toBe`/`toHave`/`waitForTimeout`
  drop by exactly one where the copy's `expect(201)` or "Add dashboard" wait moved into the helper. They are
  unchanged where the copy had neither (1189, 503, 520reg, 773, 813, 813reg, 909). No timeout, retry, skip or
  threshold change.
- Type safety, security, error handling, dead code: clean. Unused imports were removed (lint confirms). The helper
  fails loud on a non-201 register.

Issue:
- **DRY / design divergence:** `e2e/support/auth.ts:66-72` (`uiLogin`) and `e2e/support/isolateLivePage.ts:26-35`
  (`loginThenIsolate`) contain the identical form-login sequence (`goto("/login")`, two `fill`s, `click`,
  `waitForURL("/")`). The ticket exists to collapse duplicated login code, and this leaves two copies in
  `support/`. The executor's cyclic-import reason is avoidable (see CR1).

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The Playwright runs
above already used the executor's live servers on 6762/9669 (`assert-phase.sh servers` printed PASS), with a headless
lane-private browser (default per-test contexts) and no shared MCP browser.

### Overall: FAIL

### Change Requests
1. Remove the duplicated UI-login sequence without creating an import cycle, so the code matches design.md D4.
   - Move `uiLogin` into `e2e/support/isolateLivePage.ts`. `auth.ts` already imports from that file, so no cycle is
     created.
   - Rewrite `loginThenIsolate` there as `await uiLogin(page, credentials); await isolateLivePage(page);`.
   - In `e2e/support/auth.ts`, import `uiLogin` from `./isolateLivePage` (and re-export it if keeping the
     `auth.ts` public surface is wanted), then delete the local definition at `auth.ts:66-72`.
   - Delete the "Deviation noted" bullet in verification.md §1.10, or reword it to describe the final placement.
   - No spec file changes. Re-run `npm run lint`, `format:check`, `check:e2e-types`, and one `--workers 2` pass of
     `hel1277-output-history-scrubber.spec.ts` + `hel1350-chart-compare-picker.spec.ts` (the two `loginThenIsolate`
     consumers) plus any one `registerAndLogin` consumer.

### Non-blocking Suggestions
- `e2e/hel1277-output-history-scrubber.spec.ts:59` and `e2e/hel1350-chart-compare-picker.spec.ts:34` each define a
  local `registerThenLogin`. These are register + `/api/auth/me` + `loginThenIsolate` copies that landed after
  HEL-1300 and fall outside the 32 `registerAndLogin`-named copies this ticket scoped. They are a natural follow-up
  for `registerUser` + `loginThenIsolate`. Note that 32 + these 2 = the ticket's original "~34".
- About 12 other files still define a local `uniqueEmail` (hel908-*, hel912, hel958, hel665, hel666, hel716,
  auth-cookie-migration). They are out of scope here, but the shared `uniqueEmail` now exists for them.
