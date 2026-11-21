# CI impact (HEL-1649)

Measured locally, Playwright `dev` project, 2 workers, `nice -n 19`, one lane-private backend. Cell = one theme x route x
width. Raw logs: `evidence/`.

| File                                                   | Cells | Wall time (2 workers) | Sum of cell times |
| ------------------------------------------------------ | ----- | --------------------- | ----------------- |
| `state-surface-contrast-guard-narrow-1100-768.spec.ts` | 12    | 55 s                  | ~100 s            |
| `state-surface-contrast-guard-narrow-390.spec.ts`      | 8     | 35 s                  | ~66 s             |
| (one file, before the width split, same 20 cells)      | 20    | 86 s                  | ~167 s            |
| existing `-routes-dense` / `-routes-light` / `-overlays-chrome` | 8 / 8 / 4 | 43 s / 25 s / 44 s | n/a        |

Per cell: 6.6 s (`/connectors`) to 10.7 s (`/home` @1100, `pipeline-detail`), 7-8 s typical.

- The single 20-cell file ran 86 s locally against 43 s for the heaviest existing part (CI weight 117 s), so it was
  split by width (design.md Risks): the two halves are 55 s and 35 s, comparable to the existing parts.
- Scaling by the dense part's local-to-CI ratio (43 s local, 117 s weighted) puts the halves at roughly 150 s and 95 s
  in CI, about 245 s of added shard time in total. The new files carry no `shard-weights.tsv` row, so
  `node scripts/e2e-shard.mjs plan` prints them as `defaulted` at the 62 s median: legs 3 and 5 take one each
  (`plan` output: leg 3 `...-narrow-1100-768` 62 s, leg 5 `...-narrow-390` 62 s; every leg stays at 1691-1696 s weighted).
  The median under-weights both (about 150 s and 95 s estimated), so those two legs can run roughly 90 s and 35 s
  longer than the plan says. Not hand-edited: `e2e/shard-weights.tsv` is regenerated only from CI artifacts
  (e2e/README.md; HEL-1645). Re-measure on this PR's CI legs and take the real numbers at the next weights pass.
- Net added shard time is about 4 minutes of one worker spread over two legs; the ticket's 11-15 of 18 minute budget is a
  CI measurement this local run cannot make, so the PR's CI legs are the arbiter.
