## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD a606a9833910e36ad544e6aff6e4b87049245559 (worktree at base; change dir untracked, no code edits yet).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/guard-spec-live-isolation/HEL-1330`.
- **Orchestrator premise: state-surface-contrast seeds before any app page loads. CONFIRMED.**
  `e2e/state-surface-contrast-guard.spec.ts:557-626` `newCell` creates the CDP session, then `registerUser`
  (:565), dashboard, source, pipeline and step POSTs, API login (:607), `addCookies`, `addInitScript(theme)`
  (:622), and only then its first `page.goto("/")` (:623). All three test bodies (:772, :865, :955) call `newCell`
  first. The file has no `beforeEach`, and nothing loads an app page before `newCell`. No API seeding happens after
  :616. D2's "no reorder" is correct.
- **focus-presence on main matches the ticket's #774 shape. CONFIRMED.** `focus-presence-guard.spec.ts:45-58`:
  register, then `addCookies`, then `goto("/")`, then the "Add dashboard" wait. Lines :167-191 POST
  dashboard/source/pipeline while `/` is live. :236 `page.evaluate(localStorage.setItem)` runs on that live page, and
  :238 `goto(route)` follows.
- **D1 order is sound against C3.** isolate → seed → `goto("/")` → wait for the dashboard name → `evaluate` → `goto(route)`.
  The `evaluate` runs on an app origin. I also checked whether the extra `goto("/")` could shift the population.
  Recents render only in the command palette (`RecentVisitsRouteObserver.tsx`, `CommandPalette.tsx`), which is
  closed during the sweep. Onboarding auto-activation needs `dashboards.items.length === 0`
  (`useOnboardingHost.ts:63-64`), and dismissal is persisted only once all three steps complete. No panel is seeded,
  so no dismissal is written. The measured `goto(route)` is a fresh document on both main and branch. I expect no
  drift, and D3's escalation path covers any residual drift.
- **D3 line references are accurate:** focus-presence :340-342, state-surface :381, :645, :702, :731.
- **Count of 32 local copies. CONFIRMED** by grep (list in the scratchpad). There is no shared `registerAndLogin`.
  `e2e/support/` has only `isolateLivePage.ts`, which contains `isolateLivePage` and `loginThenIsolate`.
- **Ticket AC coverage:**
  - The ordering AC is covered by D1/D2.
  - The population AC is covered by D3 and tasks 1.1/1.7.
  - The `--repeat-each 10` AC at 2 workers under `nice -n 19` is covered by D6(a) and task 1.8.
  - The 4-leg CI AC is covered by D6(c). `ci.yml:432` has a 4-shard matrix.
  - The consolidation AC is covered by D4 and tasks 1.2-1.5.
  - The README AC is covered by D5 and task 1.6.
- **Placeholders and contradictions:** I found no TODO or TBD. The proposal, design and tasks are consistent.
  `skip_specs` is justified because the change is test-harness only.
- **Verification plan vs. the live collection rules: this is where the plan fails.** See CR1.
  - `playwright.config.ts` `testIgnore` excludes `**/*.regression.spec.ts`. It also quarantines
    `hel909-output-picker-panel-sheet.spec.ts` and `hel968-multi-root-editor-flow.spec.ts`. Per the comment in
    `playwright.regression.config.ts`, `testIgnore` filters explicit file arguments too.
  - `playwright.regression.config.ts` clears only the regression entry. The two quarantined files therefore cannot be
    run under any existing config without a config edit, and C1 forbids config edits.
  - Both regression harnesses also self-skip without an env flag: `HEL520_REGRESSION` (:43) and `HEL813_REGRESSION`
    (:30). The hel813 harness mutates real component source on disk.
  - Four of the 32 files to be migrated are among these: `hel520-focus-presence-guard.regression.spec.ts`,
    `hel813-mobile-touch-target-floor.regression.spec.ts`, `hel909-…` and `hel968-…`.
- **Helper-signature fidelity vs. the live copies. Gaps found, see CR2.**
  - Email domains differ: `@example.com` in hel1065, 1094, 1096, 1189, 572, 588, 773, 813 (both), 909, 910 and 968;
    `@example.test` elsewhere.
  - Existing log lines differ: hel1023 and hel1028 print `[HEL-10xx e2e] throwaway user registered: …`, and hel1260
    logs at its call sites.
  - Seven files have the "Add dashboard" wait, not the "hel510, focus-presence" that design says: also hel1003,
    hel519, hel1079, hel1080 and hel516.
  - hel1080 waits and *then* isolates (:28-30). D4's `isolate` option cannot express that order.
  - D4's helper `registerAndLogin` is UI-form login. focus-presence logs in by cookie injection.

### Verdict: REFUTE

### Change Requests

1. **Make task 1.9 / D6(b) achievable and failable for the 4 files the default config never collects.** As written,
   "every migrated spec once" either collects zero tests or skips everything for these files. Either outcome reads as
   green, which is evidence-shaped non-evidence. Revise D6(b)/1.9 to:
   - (a) Require `verification.md` to record each migrated file's **collected/passed test count**. A zero-collected
     or all-skipped file must never count as a pass.
   - (b) State explicitly how the two quarantined files (`hel909-…`, `hel968-…`) are verified given C1. For example:
     typecheck (`check:e2e-types`) plus a diff showing only the mechanical migration, labelled "not run: quarantined
     by testIgnore". Do not run them through an ad-hoc config.
   - (c) State whether the two `*.regression.spec.ts` harnesses are run at all. If they are, use
     `playwright.regression.config.ts` with `HEL520_REGRESSION=1` or `HEL813_REGRESSION=1`, in this worktree only.
     Before and after, assert `git status` shows no stray source mutation, because hel813 rewrites component files.
     If they are not run, use the same typecheck-plus-diff labelling as (b).
2. **Close the D4 helper-fidelity ambiguities so the "preserved verbatim" promise can actually be met:**
   - (a) Add an email-domain parameter to `uniqueEmail`/`registerUser`, or state that domains are normalized. Twelve
     files use `@example.com` and the rest use `@example.test`. A fixed domain would silently change those emails.
   - (b) State what happens to the existing per-file log lines in hel1023, hel1028 and hel1260. Options: keep the
     file's line, replace it with the helper's line, or suppress one of the two. Avoid double-logging.
   - (c) Correct the variant list. Seven files have the "Add dashboard" post-login wait. hel1080 needs the order
     wait → isolate, so name how it is expressed (for example `isolate: false` plus a call-site wait and then
     `isolateLivePage`).
   - (d) For focus-presence, state explicitly that it uses the shared `registerUser` only and keeps its local
     cookie-injection handoff, as D2 already states for state-surface. The shared UI-login `registerAndLogin` would
     add an `auth.login` audit row on `/settings`, the same 24-vs-25 mechanism recorded at
     `state-surface-contrast-guard.spec.ts:603-606`, and would perturb the population.

### Non-blocking notes

- D3's scratch-checkout wording is garbled. Task 1.1 runs before any edit while the worktree is still at base, so
  capturing main's lines in 1.1 is enough. Say that and drop the scratch-checkout alternative.
- hel516:296 has an inline register that is not a `registerAndLogin` function. Say whether it is in scope. Leaving it
  is fine.
- D2's `isolateLivePage` at the top of `newCell` is a no-op on a fresh page. Put it before `newCDPSession` so the
  session attaches after the blank navigation. That is harmless either way, but cleaner.
