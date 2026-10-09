# HEL-1408: CSV ingest: treat blank cells ("") as null platform-wide (owner ruling)

## Description

origin_kind: followup
origin_ticket: HEL-1310

**Owner ruling (Matt, 2026-10-08, via AskUserQuestion): blank = null at ingest.** When CSV rows are read, an empty cell `""` becomes null, so every step sees null (SQL NULL semantics). The owner chose this over the narrower "null only inside aggregates".

Trigger: HEL-1310 found `count` and `count_distinct` count `""` as a value, so helio-news's "distinct failing tests" reads one too high when blanks are present.

## Design must cover (this is a broad behaviour change; enumerate before coding)

* Where CSV cells are parsed: the static/uploaded CSV source read path, REST/CSV previews, dataset sources if they share the reader, and the HEL-1257 streaming path if it exists by then. Decide whether whitespace-only cells also count as blank (state it).
* Every consumer whose results change: filter (`= ""`, is-empty/is-null operators), compute (string concat, length), cast, fillnull (now actually fills blanks, which is likely the point), aggregate (count/count_distinct; numeric aggregates already skip them), join keys, pivot, sort order of nulls vs "", Output rows/tables (render of null vs ""), history summaries, schema inference (does an all-blank column infer differently?).
* Existing materialized snapshots keep their stored `""` until the next run. State whether that's acceptable (likely yes) and whether any stored config compares to `""`.
* Typed sources (SQL/REST) are unaffected unless they share the path. Verify.

## Acceptance criteria

* Red-first: a CSV with blank cells → `count`/`count_distinct` exclude them, and `fillnull` fills them.
* A regression suite over the consumer list above, asserting the new semantics deliberately (not by accident).
* Release note for users: blanks are now null.

## Driver context (2026-10-08)

* helio-news is READ-ONLY; check whether its pipelines compare to "" or rely on blank-as-value.
* Release-note text goes in the PR body.
* Product-visible ambiguities not settled by the ruling are escalated to the owner.
