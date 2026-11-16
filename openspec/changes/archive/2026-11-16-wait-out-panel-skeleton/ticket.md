# HEL-1633: e2e: wait out the loading skeleton before measuring grid items (hel1572 Compact-gutter flake and sweep)

## Description

origin_kind: followup
origin_ticket: HEL-1575

### Why

`e2e/hel1572-appearance-preferences.spec.ts:308` (Compact gutter) failed once in about 17 runs while HEL-1575's final
gate was checking. The trace shows the test measured the loading skeleton's `.react-grid-item`s, which went to zero
size when the real grid replaced them.

HEL-1575 widened that window: a cold load now calls `GET /api/dashboard-changes` before it fetches panels. hel1028 and
hel1457 hit the same pattern and were fixed in HEL-1575 by waiting for `getByLabel("Loading panels")` to reach count 0.

### What

* In hel1572, wait for `getByLabel("Loading panels")` to reach count 0 after both `/home` loads.
* Sweep every e2e spec that measures or counts `.react-grid-item` right after a load, and add the same wait where the
  skeleton can satisfy the locator.
* `e2e/hel1575-reload-after-edit.spec.ts` would also be sounder with the wait before its final count.

## Acceptance criteria

- [ ] hel1572 passes `--repeat-each 30` under load with zero failures.
- [ ] The sweep is recorded with a grep command and its result, and every hit is fixed or justified.

## Premise validation (orchestrator, 2026-11-16) — scope as restated

Verdict `minor-staleness` (full record: `.concertino/runs/HEL-1633/evidence/premise-validation.md`):
- "Loading panels" still exists (`PanelGridSkeleton.tsx:30`). Since HEL-1584 the skeleton sits in a `Crossfade`
  skeleton layer (`.crossfade__skeleton`) that stays mounted, aria-hidden and inert, while it fades out after loading
  ends; `getByLabel` still finds it then, so count 0 means the skeleton layer has unmounted.
- HEL-1584 (merged 2026-10-17, the day after this ticket) already changed hel1572's density locator to the live layer
  `.crossfade__layer:not(.crossfade__skeleton) .react-grid-item`. The Compact test loads `/dashboards` twice, not
  `/home`. AC1's repeat run is still owed and decides whether hel1572 needs more.
- HEL-1644 (hel1575 dashboard-tabs flakes) is a separate ticket and is not folded in.
