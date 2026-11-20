# HEL-1789: CI e2e: remaining heavy specs and a leg-wide slowdown still push a leg past 1200 s

## Description

Follow-up to HEL-1778 (PR #1183), which split three heavy, variable e2e specs and regenerated the shard weights. On
its 5 counting CI attempts the slowest leg was 1046-1289 s, with 211-454 s of headroom under the 1500 s limit. Two of
the 5 went over 1200 s: 1289 s and 1233 s, both on leg 7.

What still pushes a leg over is two things.

**1. Some heavy specs were outside HEL-1778's scope.** These are still large and swing between runs:

- `hel1582-sweep-375`: about 358 s. It added 167 s and 153 s to the slowest leg of two main runs.
- `state-surface-contrast-guard`: about 276 s. It swings up to 50 %.
- `hel1582-mobile-pipeline`: about 343 s. It swings 35 % across the PR runs.
- `hel1684-draft-structural`: about 337 s. It swings 38 % across the PR runs.

Near misses:

- `hel1573-motion-primitives`: about 175 s. It added 53 s and 61 s on main.
- `hel1575-dashboard-tabs`: about 740 s in one file. It is stable, but it fills most of a leg by itself.

**2. Sometimes a whole leg slows down.** On some runs every file on one leg, whichever leg it is, runs about 1.2-1.4x
slow together. A weight table cannot absorb this, because it is not tied to any spec. Smaller files only spread the
effect across legs. The cause, such as runner speed or another job on the same machine, has not been looked into.

**Flake candidates** (unlisted, seen during HEL-1778):

- `hel1684-draft-structural.spec.ts:427`, "add step: Discard restores the saved pipeline with no request". A stray
  `GET .../steps/<id>/preview` was recorded after Discard. Seen on PR #1183 run 44599315768, attempt 1.
- `hel1668-schema-panel-copy.spec.ts:112`, "a panel opened below its trigger on the phone Preview tab ends above the
  bottom nav (768x1024)". Seen on main run 44533329820.

**Expected:** the slowest e2e leg stays at or under 1200 s on normal runs without raising `timeout-minutes`.

## Acceptance Criteria

- For each heavy spec above, find out why it varies, then split it or cut its cost, keeping every test and assertion.
- Investigate the leg-wide slowdown from CI data, or state that it cannot be seen from the artifacts.
- Show the slowest and mean leg on at least 5 counting CI runs.

## Driver context (from the dispatch brief; claims to verify)

- The ticket's Agent notes point at `.concertino/scratch/HEL-1778/`, which was swept before this run. Surviving
  sources: `openspec/changes/archive/2026-11-19-split-heavy-e2e-specs/variance.md`, `.concertino/runs/HEL-1778/evidence/`,
  the PR #1183 body, and `scripts/e2e-shard.mjs`. Measurement scripts are rebuilt in `.concertino/scratch/HEL-1789/`.
- HEL-1774 (a867001d7) added six `e2e/hel1774-modal-scroll-*.spec.ts` files that carry the default weight (verified:
  no rows in `e2e/shard-weights.tsv`). Regenerate the table from CI timings with
  `node scripts/e2e-shard.mjs weights --list ...`, never by hand.
- HEL-1790 (PR #1191, in delivery) changes `e2e/hel1675-shared-hover.spec.ts` and adds `e2e/support/hel1790Rest.ts`
  and `e2e/hel1790-hover-probe.spec.ts`: never edit those files; merge main once it lands so the weights include them.
  HEL-1788 may add an e2e spec.
- The flake candidates are context only: not fixed here unless a split touches them; nothing filed, only reported.
- CI measurement: no whole-run or `--failed` reruns. A leg rerun is `gh run rerun --job <id>`, one job per call, named
  in the PR. Empty-commit pushes to this branch are an acceptable way to get measurement runs.
- No product code, no migration.
