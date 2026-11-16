# HEL-1724: Flaky e2e on main: HEL-1583 phone dashboard (dark) 375px card gap measured at -380px

## Description

Main CI failed at fd7064f7d (run 43925410610, e2e shard 5) on `e2e/hel1583-mobile-dashboard.spec.ts:156`, "HEL-1583 phone dashboard (dark) › markdown text is within 28px of each edge at 375px; cards 12px from the edge; gaps 8-12px".

```
expect(gap).toBeGreaterThanOrEqual(8)   // line 187
Received: -379.76
```

The light variant of the same test passed in the same run. A gap of -380px means two measured cards overlap almost completely. One possible cause: the measurement includes cards from the loading skeleton while the real stack is crossfading in. This is the same family as HEL-1633. It is a hypothesis only and has not been checked.

## Acceptance criteria

- [ ] The root cause is found from a trace or probe. No retries and no larger timeouts.
- [ ] The test fails first under a forced repro, then passes 40/40 with `--repeat-each`.

## Agent notes

HEL-1633 added `waitForPanelGrid` (`e2e/support/panelGridReady.ts`), but it covers desktop widths only. A phone-stack equivalent may be what this needs.

## Driver constraints (from the fleet driver, verbatim-critical)

- Do not touch `e2e/hel1575-dashboard-tabs.spec.ts` (lane HEL-1644 owns it). Keep any shared e2e support diff small and call it out in the PR.
- Repeat runs use `--trace retain-on-failure`; Playwright workers 2, `nice -n 19`. No e2e flock lock exists.
- Never read/print any `.env` file; no env-dumping commands. No pkill/pgrep/killall. Quoted heredocs only.
