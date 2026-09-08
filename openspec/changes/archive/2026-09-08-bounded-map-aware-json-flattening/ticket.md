# HEL-1015: JSON flattening treats a map with data-dependent keys as a fixed struct, producing an unbounded schema that changes shape per fetch

## Description

`JsonFlattener` flattens every nested object into dotted paths. That is correct for a **struct** — a fixed set of known
field names like `settings.wins` / `settings.losses`. It is wrong for a **map**: an object whose keys are *data*, not
schema. Each key becomes its own inferred column, so the column set is unbounded and changes every time the data does.

Measured on the live Sleeper API: a REST source over `/v1/league/<id>/matchups/1` (12 rows) inferred **190 columns**,
183 of them under the `players_points` prefix, keyed by opaque NFL player id. The `inferredSchema` payload alone is
66.8 KB.

Why it is a defect and not just noise:

1. **The schema is unstable across fetches.** Those keys are roster contents. A scheduled daily refresh changes the
   source's column set; anything bound to one of those columns silently stops resolving, with no warning that the
   column vanished because the data changed rather than the API.
2. **It contradicts an invariant the codebase already states.** `JsonFlattener`'s header warns that inference "could
   advertise a dotted column that the materialised row never carried". The map case makes that hazard the *normal*
   outcome.
3. **It consumes the agent context budget** — ~60 KB of a 200 KB budget for columns no agent can use (HEL-865).
4. **Same field, two incompatible types.** On `/transactions/1`, `drops` infers as BOTH `string` (nullable) and
   `drops.8154` / `drops.MIN` as `integer`, because `drops` is `null` in some rows and a map in others.

## Acceptance criteria

- [ ] A source over a map-keyed JSON field does not emit one column per key, or emits a bounded set with the truncation
      reported through the existing mechanism.
- [ ] A field that is `null` in some rows and an object in others resolves to exactly one declared type — never both a
      scalar and a flattened prefix.
- [ ] Struct flattening still works: `settings.wins` / `metadata.team_name` continue to resolve (verified, not assumed
      — these are load-bearing for the Sleeper boards on prod).
- [ ] **Mutation-proven, red arm confirmed reachable first**: a fixture with a map-keyed field shows the pre-fix column
      explosion and the post-fix bounded schema.
- [ ] The heuristic that distinguishes map from struct is stated in `design.md` and exercised by fixtures on both sides
      of the boundary, including a near-miss.

## Notes

- Related: HEL-599 (introduced this behaviour), HEL-868 (nullability from absence), HEL-869 (no sample cap), HEL-865
  (context budget), HEL-891 (row-0 inference).
- Deferral filed: **HEL-1030** covers remediating already-persisted schemas. Ruled out of scope for this ticket.

## Orchestrator Planning-phase probe — REAL DATA, all claims CONFIRMED

Payloads fetched from the LIVE public Sleeper API (league `1136106202002915328`) on 2026-09-08 and staged in the
worktree at `.hel1015-realdata/{matchups.json,tx.json}` plus a projections sample. These are real API responses, not
hand-built fixtures — a map with data-dependent keys is exactly the shape a hand-built fixture will not contain,
because whoever writes it already knows the keys (the HEL-904 lesson).

Measured key-stability, the signal the heuristic turns on — **mean per-row coverage of the union key set**:

| field | staged file | shape | union keys | mean coverage | intersection |
| -- | -- | -- | -- | -- | -- |
| `adds` | `tx.json` | MAP | 22 | **0.045** | **0** |
| `drops` | `tx.json` | MAP | 16 | **0.062** | **0** |
| `players_points` | `matchups.json` | MAP | 173 | **0.083** | **0** |
| synthetic variant payload | fixture | STRUCT | 41 | **0.122** | **1** |
| `stats` | `projections-sample-200.json` | STRUCT, near-miss | 52 | **0.580** | **16** |
| `settings` | `tx.json` | STRUCT | 3 | **0.682** | **1** |
| `metadata` | `tx.json` | STRUCT | 1 | **1.000** | **1** |
| `player` | `projections-sample-200.json` | STRUCT | 14 | **1.000** | **14** |

Every row is reproducible from the staged payloads. `stats` is the genuine near-miss — only 31% of its keys appear in
every row — and is load-bearing for the prod Sleeper boards, so it MUST classify as a struct. The synthetic variant
payload is the case COVERAGE ALONE gets wrong (0.122 is below the 0.25 threshold), which is why the heuristic is
compound: every real map has an intersection of exactly 0, while every struct shares at least one key across all rows.

Collision mechanism traced to `SchemaInferenceEngine.scala:111-138`: `JsNull` is a leaf at path `drops` and never
participates in the widening join, so `drops` infers `StringType`/nullable from the 19 null rows while `drops.<id>`
paths are emitted independently from the 17 object rows. Both survive — exactly as reported.

Dev DB is clean: 0 affected rows of 1,666 sources, both signatures scanned. The 66.8 KB figure is prod-only evidence
(dev's largest persisted schema is 1,537 bytes).
