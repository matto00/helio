# HEL-1689: Flaky e2e: hel516-palette-quick-create.spec.ts:239 times out opening the command palette (5 recent CI failures incl. main)

## Description

`e2e/hel516-palette-quick-create.spec.ts:239` ("section order determinism › section order is identical across
independent fresh page loads") fails intermittently with `Test timeout of 30000ms exceeded`, at `openPalette`
(spec.ts:30, called from :250).

Recent failures (as filed): main push CI on ffac180f4 (e2e (4)); main push run 39540076554; HEL-1632's PR runs
39517434455 and 39504418263; dependabot vite-8.3.4 PR run 39507556457. It isn't tied to any one change. Owner
ruled: file it and bring it into the queue.

Triage:

1. Reproduce with `--repeat-each` under CPU throttle, under the e2e lock.
2. Root-cause it (systematic-debugging): does the palette's open shortcut race page readiness, or does a fresh
   load sometimes miss the keybinding?
3. Fix the test to wait on a ready state, or fix the app if the palette really fails to open. No retries and no
   bigger timeouts.

## Acceptance Criteria

- The test is shown failing first, then passes 40/40 under throttle.
- CI is green on main.

## Premise validation (orchestrator, Setup)

See `.concertino/runs/HEL-1689/evidence/premise-validation.md`. Summary:

- Only 39540076554 (= the ffac180f4 main push) and 39507556457 failed on this test. The two HEL-1632 PR runs failed
  on other specs (hel1656 :221, hel1632 :259, hel1631 :177).
- The CI trace (39540076554, playwright-report-shard-4) refutes both hypotheses in triage step 2: every iteration's
  first Control+k opened the palette (poll resolved in ~0.5 s). The test does 5 x (API register + UI login, which
  lands on /home since HEL-1578, + goto /dashboards + shell wait) at ~5.5-6.5 s each on CI. The 5th `openPalette`
  started at 29.27 s and was killed by the 30 s test timeout. On main push CI this test has taken 22-28 s at every
  commit back to 49021293b. It is a budget overrun, not a palette that fails to open.
