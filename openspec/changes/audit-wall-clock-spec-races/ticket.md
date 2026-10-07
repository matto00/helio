# HEL-1341: Audit backend specs for wall-clock-window races; then a 3-fork CI trial

## Description

origin_kind: followup
origin_ticket: HEL-1323

HEL-1323 (8cff543b) fixed ConnectorCompletionServiceSpec's 50 ms real-time expiry race by injecting a Clock.
That spec's flake was why HEL-1287 dropped CI to 2 forks per leg. HEL-1287's profile counted 23 fixed sleeps in
backend specs. Others may share the same pattern: a short real-time window that a slow DB round trip can overrun
under contention.

## Acceptance Criteria

* Inventory the specs that rely on real-time windows or fixed sleeps. For each, record the window size, the work done
  inside it, and whether contention can exceed it.
* Fix the affected ones with injected clocks or state waits. Never lengthen a window. Prove each fix with a probe or
  mutation.
* Then trial `HEL924_TEST_GROUP_CONCURRENCY=3` on CI over 5 or more runs, and report the flake rate and leg time.
  Making 3 forks the default is a separate decision; record it on this ticket.

## Comments (driver notes)

* 2026-10-06: `DatasetWriteSubmitLatencySpec` is handled by HEL-1344; leave it out of this audit.
* 2026-10-07: HEL-1344 (a6360956) resolved `DatasetWriteSubmitLatencySpec`; its timing now runs only behind
  `HELIO_MEASURE=1`. Remove it from the inventory. Add `DatasetWriteAutoRunEndToEndSpec` instead: one local full run
  measured 544 ms against a >= 1000 ms wall-clock assertion (seen in HEL-1291).

## Driver constraints for this run

* Never lengthen a window. 3 forks is NOT made the default here; the default is escalated to the owner.
* The trial runs on a separate branch/draft PR, never in the reviewed Part 1 diff. HEL-1339 also edits `ci.yml`.
* Do not touch `playwright.config.ts` or `.gitignore` (HEL-1353/HEL-1354 are running).
* Local: `nice -n 19 sbt testFull` with `HEL924_TEST_GROUP_CONCURRENCY=2` (at most 2 workers), Bash timeout 600000.
  Contention repros use at most 3-4 workers total; burners are killed only by their recorded PID. Never pkill,
  pgrep or killall. Never bypass hooks. Never write under `~`. Keep full logs of any failing run.
