# Live probe transcript — HEL-858 task 2.1/2.2

Provenance only (design D6): this record does NOT prove fixture adequacy. Adequacy is
asserted in code by task 3.9's test itself, against exactly this file.

## Fetch command

```
curl -s "https://api.sleeper.app/projections/nfl/2026?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&order_by=pts_ppr" \
  -o sleeper_mixed.json
```

- HTTP status: 200
- Timestamp (UTC): 2026-08-28T19:05:50Z
- Full response size: 2,921,972 bytes, 3114 elements
- Response order observed: descending by `pts_ppr`, positions interleaved (QB/RB/WR/TE mixed),
  matching the ticket's described symptom (Josh-Allen-style QB rows sort ahead of receiving backs
  and receivers).

## Slice taken

First 15 elements of the response, written verbatim (no hand-editing) to
`backend/src/test/resources/hel858/sleeper-mixed-projections-slice.json`.

- SHA-256 (as captured): `f010bc53b4779ce7f3bf8a5da1b41bc19ec6d7f3d0b27cad191ed63dcc861e1c`
- SHA-256 (after `prettier --write`, run by the pre-commit hook — whitespace-only
  reformatting, no structural change): `c9c6fc1b7dfc7928a78d5445e8beee1341ac4814e446f5d58499a3c490a6d16c`

## Manual adequacy spot-check (informational; the real assertion lives in task 3.9's test)

Positions and presence of the `stats.rec` family for the 15 sliced elements, in order:

```
QB False False False   <- element 0: lacks stats.rec/rec_yd/rec_td entirely
RB True  True  True    <- element 1: carries the full rec_* family
QB False False False
RB True  True  True
QB False False False
WR True  True  True
WR True  True  True
QB False False False
QB False False False
QB False False False
QB False False False
QB False False False
QB False False False
QB False False False
QB False False False
```

Element 0 (a QB row) lacks `stats.rec`, `stats.rec_yd`, `stats.rec_td` entirely; element 1 (an RB
row) carries all three. This is exactly the ordering-dependence defect described in the ticket:
pre-fix, `mergeObjects` merges only at the top level and keeps object 0's `stats` subtree wholesale,
so the RB/WR `rec*` fields never reach the merged schema despite being present later in the array.
