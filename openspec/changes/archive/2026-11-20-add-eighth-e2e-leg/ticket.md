# HEL-1793: CI e2e: legs on slow host CPUs still exceed 1200 s; choose an 8th leg or a larger/pinned runner class

## Description

HEL-1789 (PR #1194) split the six remaining heavy e2e specs and added a per-leg runner record to the `e2e` job. Each leg
now uploads `e2e-runner-shard-<n>`, which holds the CPU model, the vCPU count, memory, and a 1 Hz load and steal sample.

On its 5 counting PR runs the slowest leg was still 1321-1334 s, with the mean leg at 1011-1106 s. Every leg over
1200 s ran on an older host CPU (AMD EPYC 7763, Intel Xeon Platinum 8370C; leg factor about 1.4x). Steal was 0 % on
every leg, so the cause is a slower CPU, not contention. Splitting specs cannot fix this. The standard `ubuntu-24.04`
label does not let a job pick its host.

| CPU model (4 vCPU on every leg) | legs | leg factor | wall s |
| -- | -- | -- | -- |
| Intel Xeon 6975P-C | 20 | 0.90-1.02 | 876-1001 |
| AMD EPYC 9V45 | 2 | 0.98-1.07 | 957-993 |
| AMD EPYC 9V74 | 3 | 1.11-1.17 | 1059-1132 |
| Intel Xeon Platinum 8573C | 2 | 1.07, 1.34 | 999, 1224 |
| AMD EPYC 7763 | 6 | 1.36-1.48 | 1237-1334 |
| Intel Xeon Platinum 8370C | 2 | 1.42-1.46 | 1307-1333 |

Decision needed (owner): how to keep the slowest leg at or under 1200 s without raising `timeout-minutes`. Options: an
8th e2e leg; a larger or pinned runner class; cut per-leg cost another way.

**Owner ruling (2026-11-20, via the driver):** add an 8th e2e leg. Do not raise `timeout-minutes`; do not switch to a
paid/larger runner class.

## Acceptance Criteria

- The remedy is chosen by the owner (done: an 8th e2e leg) and implemented.
- The slowest and mean leg are reported on at least 5 counting CI runs, with each leg's CPU model from the runner record.
- The slowest leg is at or under 1200 s on those runs, or the remaining gap is stated with its cause.

## Agent notes

- Evidence and scripts: main checkout `.concertino/runs/HEL-1789/evidence/measurement/` (`after.md`, `before.md`,
  `cpu-table.txt`, `runnerrec-after.txt`, `capture.sh`, `measure.mjs`, `runnerrec.mjs`, `lib.mjs`, `total.mjs`).
  Method: `openspec/changes/archive/2026-11-20-split-remaining-heavy-e2e-specs/variance.md`.
- HEL-1789 measured PR runs: 44708860497, 44712167515, 44716239460, 44723866593, 44728460728.
- Suite grew from about 10,000 to about 12,000 summed test-seconds per run (HEL-1774 et al.).
- `e2e/hel1735-feature-hover.spec.ts` (HEL-1735) and `e2e/hel1791-compact-counter-stack-height.spec.ts` (HEL-1791) have
  no weight row yet: regenerate with `node scripts/e2e-shard.mjs weights --list ...` from counting main runs that
  include them (never hand-edit).
- Popover specs `hel1759-popover-keyboard-focus` and `hel1756-popover-viewport-fit` added +59 to +65 s to two main
  slowest legs; not split.
