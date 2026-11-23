# HEL-1823: Client draft regex: tighten anchored stage-2 bound (charge per unpaired surrogate) to remove the 20-43 ms accepted-risk shape

## Description

origin_kind: followup
origin_ticket: HEL-1807 (PR matto00/helio#1231, merged as bc861cf3c). The owner chose a standalone ticket.

HEL-1807 charges a fully `^`-anchored `extractRegex` pattern one match attempt per cell. One shape is recorded as
accepted risk under HEL-1697's owner ruling C2 (a slowdown under 50 ms per draft is accepted):

* **The shape:** frames sized exactly at `REGEX_WORK_BUDGET` with a wide character class, over two-byte cells that each
  contain exactly one unpaired surrogate.
* **Cost:** 161 of 248 calibration rows in group H run 20-50 ms, worst 36 ms warm and 42.7 ms cold. Before HEL-1807
  such frames went to the server at about 0 ms.

The anchored stage-2 decision bound in `regexInputCost.ts` doubles the whole cell's charge when it contains a lone
surrogate.

## Do

* Charge one extra unit per unpaired surrogate instead of doubling the whole cell. Or apply whatever calibrated rule the
  measurements support.
* Re-run HEL-1807's calibration (`calibrate-anchored.mjs`, groups A-H, in
  `openspec/changes/archive/2026-11-21-anchored-regex-cost-refinement/`).
* Keep everything else unchanged: `REGEX_WORK_BUDGET` stays at 4.00e6, the parity corpus is unchanged, and no pattern
  costs more than it did before HEL-1807.

## Acceptance criteria

- [ ] A test that fails first: the group-H worst shape is declined to the server, or measured under 20 ms.
- [ ] Every other HEL-1697 and HEL-1807 calibration shape decides the same way.
- [ ] The e2e long-task check still passes.
