# Release note (HEL-1408)

**Blank CSV cells are now null, not empty text.** A blank, whitespace-only or quoted-empty CSV cell is null at ingest, short rows pad with null, and blank or whitespace-only lines are skipped (so row counts drop by the number of blank lines). Cells that contain text are never trimmed. Schema inference and the source preview are unchanged: a blank still previews as an empty cell and an all-blank column is still a nullable `string`.

Changed results (existing pipelines will see these on their next run):
- `count` and `count_distinct` exclude blanks, in aggregate, pivot and groupby. The Output summary count excludes blanks. Sum, avg, min, max and median are unchanged.
- A blank group key or pivot column value is a null group. For pivot, a blank pivot-column value gets no `values_` column.
- `fillnull` constant fills blanks, `forwardFill` carries values across them, and `mode` ignores them.
- Casting a blank to string or date gives null.
- Compute `concat`, `+`, `length` and `upper` of a blank give null. stringops `concat` still treats a blank as empty.
- Sort and window ordering put blanks last in both directions.
- Join and lookup keys: null matches null, including nulls from the other source.
- Dedupe treats a blank as a null key.
- Assert: `notNull` fails on blanks, `unique` ignores them, and `regex` fails a blank even if the pattern matches `""`. `rowCountMin` and `rowCountMax`, and alert row-count baselines, see the lower counts, so previous and rolling alert baselines show a one-time step on the first run after deploy.
- Upsert into a dataset: a blank in a required column is rejected as `required`, takes the field's declared default if there is one, and is accepted in an optional numeric column.
- Output schema inference: a date-like column with blanks now infers as `timestamp` instead of `string`.
- The snapshot distinct-values and column-filter dropdown no longer list blanks. Table cells render `—` for a blank. Server sort `NULLS LAST` moves blanks from first to last when ascending.
- The groupby step (non-authorable) `count` excludes blanks. Assistant workspace grounding: `nullRate` rises, and distinct values and join overlap exclude blanks.

Compatibility:
- `= ""`, `!= ""`, an omitted filter value and `contains ""` keep meaning "blank": `= ""` matches null, `!= ""` excludes it, and `contains ""` still keeps every row. Use `is null` / `is not null` for explicit null tests.
- AI and text steps (`analyzewithai`, `generatetext`, `convertformat`) treat a null input as empty text. An absent field still fails `field-missing`. This also applies to JSON-sourced nulls.
- Use `fillnull` to replace blanks. `compute` has no `coalesce` yet (follow-up).

Charts and cross-filter: an aggregated chart still labels the blank group `null`. Clicking it selects "blank", and "Filter dashboard" then matches blank (null or `""`) rows on sibling panels. The selection header reads `team: ` (empty) until a `(blank)` label ships. This applies to every source kind, not only CSV. The public and PAT `/rows` endpoint's `eq ""` now also matches null. On non-CSV sources holding both null and `""`, each of those bars' Inspect lists both. In the rare case of nulls plus a literal `"null"` string in one group, the selection is blank and the literal-`"null"` rows are not selected. A metric panel's client `count` now excludes null cells, so it agrees with the server headline.

Existing snapshots keep their stored `""` until the pipeline's next run. Owner rulings Q1-Q8 were all applied at the recommendation: Q1 whitespace-only is null, Q2 blank lines are skipped, Q3 filter compat, Q4 AI-step null as empty, Q5 compute propagates null, Q6 render `—`, Q7 the `"null"` category label, Q8 timestamp inference.
