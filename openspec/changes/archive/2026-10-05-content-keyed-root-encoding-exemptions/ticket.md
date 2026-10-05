# HEL-1282: check-node-root-encoding exemptions are keyed by line number; key them on line content

## Description

origin_kind: followup
origin_ticket: HEL-1271

`scripts/check-node-root-encoding.mjs` (and its selftest) exempts known-safe sites in `NodeSnapshotRepository.scala` by line number. Any edit above those lines shifts them and breaks CI's `check:node-root-encoding`. This has happened three times: HEL-1027, HEL-1188 and HEL-1271, where the exemptions moved from :113/:161/:185 to :130/:178/:202. HEL-918 L6 (HEL-1276) will edit the same file again.

## Acceptance Criteria

* Key exemptions on the exempted line's content (for example a normalised-text match, or an inline marker comment the checker recognises) instead of its line number, so an unrelated edit to the file cannot break the check.
* The check still fails on a NEW unexempted hit. Prove this with a red mutation that adds one.
* The selftest covers both cases: lines shifting (stays green) and a new site (goes red).

## Driver brief (additional proof requirements)

* (a) A line-shift mutation (insert lines above the exempt sites) stays green.
* (b) A NEW unexempted hit goes red.
* (c) Removing an exemption turns its site red.
* The selftest covers all three.
* A whole-file scan on main finds the same hits before and after the change.
* The design explains how the new keying cannot silently exempt a NEW unsafe line that resembles an exempt one.
* Owned files: `scripts/check-node-root-encoding*` and their selftests. No backend logic change, no migration. If markers are used, only NodeSnapshotRepository.scala comments may change, minimally.
