# Verification — HEL-1330

Servers: this worktree's own (`start-servers.sh`, DEV_PORT 6762, BACKEND_PORT 9669). All Playwright runs:
`DEV_PORT=6762 BACKEND_PORT=9669 nice -n 19 npx playwright test ... --workers 2`, headless, default per-test
contexts (no shared MCP browser, no /tmp cookie jar). Logs (gitignored, kept in the worktree):
`.concertino/runs/HEL-1330/e2e-logs/` (`main-baseline.log`, `branch-single.log`, `branch-repeat10.log`,
`migrated.log`, `migrated.json`, `throwaway-emails.txt`).

## 1.1 / 1.7 Population: main vs branch (D3)

Main's guard summary lines were captured (task 1.1) at base, before any spec edit
(`main-baseline.log`, 28 passed). The branch run is `branch-single.log` (28 passed). The `[HEL-520 focus-presence
guard] view ...` and `[HEL-866 guard] view / elements probed / cell ...` lines (82 lines each) were sorted (two workers
interleave them) and diffed:

```
$ diff main-lines.txt branch-lines.txt && echo IDENTICAL
IDENTICAL
```

Across the 10 repeats (`branch-repeat10.log`), the set of distinct `view` lines equals main's (`diff` empty). Main's
per-view lines (identical on branch):

```
[HEL-520 focus-presence guard] view "/(dark)": 19 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "/(light)": 19 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "pipeline-detail(dark)": 24 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "pipeline-detail(light)": 24 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "/settings(dark)": 34 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "/settings(light)": 34 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "source-detail(dark)": 25 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "source-detail(light)": 25 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "/sources(dark)": 21 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "/sources(light)": 21 focusable element(s) measured (uncapped)
[HEL-866 guard] view "actions-menu" (dark): 5 visible interactive element(s), sampled 5
[HEL-866 guard] view "actions-menu" (light): 5 visible interactive element(s), sampled 5
[HEL-866 guard] view "/chat" (dark): 1 visible interactive element(s), sampled 1
[HEL-866 guard] view "/chat" (light): 1 visible interactive element(s), sampled 1
[HEL-866 guard] view "/chat:sidebar-rail" (dark): 1 visible interactive element(s), sampled 1
[HEL-866 guard] view "/chat:sidebar-rail" (light): 1 visible interactive element(s), sampled 1
[HEL-866 guard] view "chrome" (dark): 12 visible interactive element(s), sampled 12
[HEL-866 guard] view "chrome" (light): 12 visible interactive element(s), sampled 12
[HEL-866 guard] view "command-palette" (dark): 15 visible interactive element(s), sampled 15
[HEL-866 guard] view "command-palette" (light): 15 visible interactive element(s), sampled 15
[HEL-866 guard] view "/connectors" (dark): 1 visible interactive element(s), sampled 1
[HEL-866 guard] view "/connectors" (light): 1 visible interactive element(s), sampled 1
[HEL-866 guard] view "/connectors:sidebar-rail" (dark): 0 visible interactive element(s), sampled 0
[HEL-866 guard] view "/connectors:sidebar-rail" (light): 0 visible interactive element(s), sampled 0
[HEL-866 guard] view "/" (dark): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "/" (light): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "modal:add-source" (dark): 13 visible interactive element(s), sampled 13
[HEL-866 guard] view "modal:add-source" (light): 13 visible interactive element(s), sampled 13
[HEL-866 guard] view "/pipelines" (dark): 10 visible interactive element(s), sampled 10
[HEL-866 guard] view "/pipelines/:id" (dark): 18 visible interactive element(s), sampled 18
[HEL-866 guard] view "/pipelines/:id" (light): 18 visible interactive element(s), sampled 18
[HEL-866 guard] view "/pipelines/:id:sidebar-rail" (dark): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "/pipelines/:id:sidebar-rail" (light): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "/pipelines" (light): 10 visible interactive element(s), sampled 10
[HEL-866 guard] view "/pipelines:sidebar-rail" (dark): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "/pipelines:sidebar-rail" (light): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "/settings" (dark): 25 visible interactive element(s), sampled 24
[HEL-866 guard] view "/settings" (light): 25 visible interactive element(s), sampled 24
[HEL-866 guard] view "/settings:sidebar-rail" (dark): 0 visible interactive element(s), sampled 0
[HEL-866 guard] view "/settings:sidebar-rail" (light): 0 visible interactive element(s), sampled 0
[HEL-866 guard] view "/:sidebar-rail" (dark): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "/:sidebar-rail" (light): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "/sources" (dark): 8 visible interactive element(s), sampled 8
[HEL-866 guard] view "/sources" (light): 8 visible interactive element(s), sampled 8
[HEL-866 guard] view "/sources:sidebar-rail" (dark): 3 visible interactive element(s), sampled 3
[HEL-866 guard] view "/sources:sidebar-rail" (light): 3 visible interactive element(s), sampled 3
```

No count differed, so no ESCALATION was needed.

## 1.8 Repeat-each 10, 2 workers, nice -n 19

```
nice -n 19 npx playwright test e2e/focus-presence-guard.spec.ts e2e/state-surface-contrast-guard.spec.ts --workers 2 --repeat-each 10 --reporter=list
  280 passed (21.7m)
EXIT 0
```

Log: `.concertino/runs/HEL-1330/e2e-logs/branch-repeat10.log` (0 failures, 0 flaky).

## 1.9 Every default-collected migrated spec once, `--workers 2`

Command: the 27 default-collected migrated specs, `--reporter=json,list`; `132 passed (4.8m)`, `EXIT 0`,
stats `expected 132, skipped 0, unexpected 0, flaky 0`. Per file (collected / passed / skipped / failed, from
`migrated.json`; none has 0 collected or all skipped):

| file | collected | passed | skipped | failed |
| ---- | --------- | ------ | ------- | ------ |
| hel1003-actions-menu-keyboard-reach.spec.ts | 4 | 4 | 0 | 0 |
| hel1023-breakpoint-layout-derivation.spec.ts | 5 | 5 | 0 | 0 |
| hel1028-layout-undo-redo-visual-revert.spec.ts | 13 | 13 | 0 | 0 |
| hel1065-pin-toggle-css-fixes.spec.ts | 5 | 5 | 0 | 0 |
| hel1079-dataset-management-ui-live.spec.ts | 5 | 5 | 0 | 0 |
| hel1080-dataset-row-grid-live.spec.ts | 4 | 4 | 0 | 0 |
| hel1085-form-field-renderers-keyboard.spec.ts | 1 | 1 | 0 | 0 |
| hel1087-form-submit-path.spec.ts | 4 | 4 | 0 | 0 |
| hel1088-compact-counter-chrome.spec.ts | 1 | 1 | 0 | 0 |
| hel1090-form-panel-assembled-a11y.spec.ts | 5 | 5 | 0 | 0 |
| hel1094-sse-fan-out-panel-refresh.spec.ts | 1 | 1 | 0 | 0 |
| hel1095-optimistic-pending-writing-panel-a11y.spec.ts | 4 | 4 | 0 | 0 |
| hel1096-run-to-update-affordance.spec.ts | 2 | 2 | 0 | 0 |
| hel1169-network-vs-rejection-reconcile-a11y.spec.ts | 4 | 4 | 0 | 0 |
| hel1189-output-panel-controls-live.spec.ts | 2 | 2 | 0 | 0 |
| hel1230-drag-then-create-persists.spec.ts | 1 | 1 | 0 | 0 |
| hel1260-orphan-owner-repair.spec.ts | 4 | 4 | 0 | 0 |
| hel1275-metric-delta-sparkline.spec.ts | 2 | 2 | 0 | 0 |
| hel503-palette-global-resource-search.spec.ts | 6 | 6 | 0 | 0 |
| hel510-keyboard-shortcuts.spec.ts | 7 | 7 | 0 | 0 |
| hel516-palette-quick-create.spec.ts | 10 | 10 | 0 | 0 |
| hel519-recent-navigation.spec.ts | 8 | 8 | 0 | 0 |
| hel572-chart-click-drilldown.spec.ts | 3 | 3 | 0 | 0 |
| hel588-cross-filter-panels.spec.ts | 4 | 4 | 0 | 0 |
| hel773-top-anchored-mobile-nav-sheet.spec.ts | 11 | 11 | 0 | 0 |
| hel813-mobile-touch-target-floor.spec.ts | 14 | 14 | 0 | 0 |
| hel910-pipeline-to-dashboard-flow.spec.ts | 2 | 2 | 0 | 0 |

The two guards are covered by 1.7/1.8 above (28 passed once, 280 passed at repeat 10). No failure occurred, so no
base-checkout re-run was needed.

### Not run, by design (D6(c)): "not run: quarantined/regression-only"

`playwright.config.ts` `testIgnore` (C1: no config edit) excludes these; each is verified by `npm run check:e2e-types`
(passes) plus the per-file diff being only the mechanical migration:

- `hel909-output-picker-panel-sheet.spec.ts` (quarantined): local copy replaced by `registerAndLogin` with
  `{prefix: hel909, domain: example.com, isolate: true}`; adds `expect(201)` (inside shared `registerUser`; allowed by C2).
- `hel968-multi-root-editor-flow.spec.ts` (quarantined): same shape, `{prefix: hel968, domain: example.com}`, no isolate
  (its call-site `isolateLivePage` kept as-is); adds the helper's email log line.
- `hel520-focus-presence-guard.regression.spec.ts` (`*.regression.spec.ts`, env-gated): `{prefix: hel520reg,
  displayName: "HEL-520 Regression"}`; adds `expect(201)`.
- `hel813-mobile-touch-target-floor.regression.spec.ts` (`*.regression.spec.ts`, env-gated, mutates tracked source when run):
  `{prefix: hel813reg, domain: example.com, displayName: "HEL-813 Regression"}`; adds `expect(201)`.

## 1.5 Per-file mapping (D4) and the C2 check

Each former local copy is deleted; each file declares `const AUTH = {prefix, displayName, domain?, ...flags}` and
calls the shared `registerAndLogin(page, request, { ...AUTH, label })`. Flags are exactly what the former copy did
(`isolate` only where the copy itself isolated; `waitForShell` only where it waited; `domain` verbatim):

| file | prefix | domain | waitForShell | isolate | other |
| ---- | ------ | ------ | ------------ | ------- | ----- |
| hel1003 | hel1003 | .test | yes | no | |
| hel1023 | hel1023 (label-less, "HEL-1023 e2e") | .test | no | no (call-site isolate kept) | logEmail:false; its own `[HEL-1023 e2e] ... registered:` line re-emitted at the call site |
| hel1028 | hel1028 | .test | no | no (call-site isolate kept) | logEmail:false; own `[HEL-1028 e2e] ... registered:` line re-emitted at all 4 call sites |
| hel1065 | hel1065 | .com | no | no | |
| hel1079 | hel1079 | .test | yes | no (call-site isolate kept) | |
| hel1080 | hel1080 | .test | yes | yes | wait then isolate |
| hel1085, 1087, 1088, 1090, 1095, 1169 | own | .test | no | yes | |
| hel1094, 1096 | own (nested in describe) | .com | no | yes | |
| hel1189, 572, 588, 909 | own | .com | no | yes | |
| hel1230 | hel1230 (label-less, "HEL-1230") | .test | no | yes | |
| hel1260 | hel1260 (label-less) | .test | no | no | logEmail:false (call sites log); returns `{email}` |
| hel1275 | hel1275 (label-less) | .test | no | no (call-site isolate kept) | `/api/auth/me` id fetch moved to the call site, same position |
| hel503 | hel503 | .test | no | yes | thin local `registerAndLoginWithDashboard` = shared `registerAndLogin({isolate:true})` + dashboard seed only |
| hel510, hel516, hel519 | own | .test | yes | no (hel516 call-site isolates kept) | |
| hel520 regression | hel520reg | .test | no | no | |
| hel773 | hel773 | .com | no | no | |
| hel813, hel813 regression | hel813 / hel813reg | .com | no | no (call-site isolates kept) | |
| hel968 | hel968 | .com | no | no (call-site isolate kept) | |
| hel910 | hel910 | .com | n/a | n/a | register-only: `registerUser(page.request, ...)` |
| focus-presence-guard, state-surface-contrast-guard | hel520 / hel866 | .test | n/a | explicit `isolateLivePage` | `registerUser` only; local cookie handoff kept |

Not touched (out of scope, define no `registerAndLogin` function): hel516:296's inline register and the other files'
inline `uniqueEmail` use.

C2 check used on `git diff -U0 -- e2e/*.spec.ts`: (a) every removed line matching
`expect(|toBe|toHave|timeout|retries|skip|fixme|waitFor` was inside a deleted local copy: 28 `waitForURL("/")` (now
`uiLogin`), 19 `expect(res.status()).toBe(201)` (now in `registerUser`), 7 "Add dashboard" waits (6 now
`waitForShell`, 1 re-inlined in focus-presence), the hel1275 `/api/auth/me` 200 check (re-added at the call site);
(b) every added non-import, non-`AUTH`, non-call-site line was reviewed (comment text, the hel1275 `me` check, the
hel1023/1028 log lines); (c) no `test.skip/fixme`, timeout or retry token appears among added lines. Strictness
additions only: `expect(201)` where the copy lacked it (hel1003, 1079, 1080, 1189, 510, 516, 519, 520reg, 773, 813,
813reg, 909) and the helper's email log line where missing.

## D1 / D2 guard ordering

- `focus-presence-guard.spec.ts`: register -> cookie handoff -> `goto("/")` -> "Add dashboard" wait ->
  `isolateLivePage` -> API seed (dashboard, source, pipeline; payloads unchanged) -> `goto("/")` -> seeded-dashboard
  marker wait -> theme `evaluate` (on an app origin) -> `goto(route)`. C3 holds.
- `state-surface-contrast-guard.spec.ts`: explicit `isolateLivePage(page)` at the top of `newCell` (before
  `newCDPSession`), seed order unchanged, theme stays on `addInitScript` (documented deviation from the literal
  `evaluate` step: no live app page exists before its first `goto`).

## 1.10 Static gates

- `npm run lint` rc 0 (`--max-warnings=0`); `npm run format:check`: "All matched files use Prettier code style!";
  `npm run check:e2e-types`: clean (tsc exit 0).
- Throwaway emails: 444 distinct addresses recorded in `.concertino/runs/HEL-1330/e2e-logs/throwaway-emails.txt`.
  Nothing deleted; the `matt@helio.dev` account was not touched.
- `uiLogin` lives in `e2e/support/isolateLivePage.ts`; `loginThenIsolate` is `uiLogin` + `isolateLivePage` and `auth.ts` imports `uiLogin` from there (no import cycle, no duplicated login sequence), as D4 specifies.
- CI under 4-leg sharding is the Delivery gate's responsibility (D6(d)); not measurable locally.
