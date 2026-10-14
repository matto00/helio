# HEL-1564: Late pipeline delete after a run's succeeded write has won: always answer success (owner ruling), not 404

## Description

**Owner ruling (2026-10-13, via AskUserQuestion):** once a run's own `succeeded` terminal write has won, a later delete of its pipeline must not change the answer. The caller gets success (`Right`) and `succeeded` is published, whatever the timing.

**Current behaviour** (found by HEL-1544, PR matto00/helio#1009; predates it): if the pipeline is deleted *after* the run's `succeeded` write commits, the result depends on timing:

* the delete lands before the Output list is read: `Right`, and `succeeded` is published;
* the delete lands after the list is read: the node guard sees the run as missing, and the answer is 404.

Both outcomes are currently pinned by HEL-1544's two new tests in `LateFinisherRunSpec`. HEL-1518 D7 only defines the case where the run *lost* its terminal write (404).

Labels: Follow-up. Priority: Low. Related: HEL-1518, HEL-1544.

## Acceptance Criteria

* Make the "write already won" path answer success in both orderings.
* Flip the 404-pinning test.
* Keep HEL-1518 D7, where a lost write gets 404, and keep first-terminal-write-wins.
* Decide and document what is written when the delete removed the Outputs, e.g. no snapshots for deleted nodes. That must not be a 404.
* Prove it red-first under forced orderings, as HEL-1544 did, not with sleeps.

Verify every claim here against the code before acting.

## Driver constraints (this run)

* Backend-only. No migration expected; if one is needed, take the next free version after HEL-1574's V134 and re-check before merge.
* Local caps: `nice -n 19`, at most 3-4 parallel workers, jest at most 3 workers; full `sbt testFull` run as foreground shards.
* Never pkill/pgrep/killall; stop servers only via `scripts/concertino/stop-servers.sh`.
