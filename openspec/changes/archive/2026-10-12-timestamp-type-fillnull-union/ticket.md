# HEL-1491: Type bugs that put numbers under a timestamp type: fillnull mean/median on timestamp columns; union keeps the parent's timestamp type over a numeric secondary field

## Description

This spinoff is per the owner's ruling on HEL-1314 (option A: ship the `+` timestamp→string inference, document the remaining paths, and file spinoffs).

HEL-1314 makes analyze infer `string` for `$ts + …` because timestamps are text at run time. Two ops can put a JSON number under a column typed `timestamp`. In those cases analyze says `string` while the run produces a number:

1. **fillnull with mean or median** on a timestamp-typed column holding epoch-valued strings writes a Double, while the schema stays `timestamp`. Decide whether mean and median should be rejected on timestamp columns, or should produce a timestamp.
2. **union:** when the secondary lane has a numeric field with the same name as a parent `timestamp` field, `inferUnion` keeps the parent's `timestamp` type, so numbers arrive under a timestamp projection. Decide whether the union should widen the type, warn, or reject.

Each is a type bug in its own op. Fix each with analyze-versus-apply parity tests that fail first. Evidence is in HEL-1314's archive: `timestamp-paths-evidence.md` (`openspec/changes/archive/2026-10-11-compute-datetime-functions/`) and `probe-timestamp-paths.txt` (`.concertino/runs/HEL-1314/evidence/`).

## Acceptance Criteria

- A decision is taken and implemented for fillnull mean/median on a timestamp-typed column (assumed product call, flagged OWNER REVIEW in the PR body).
- A decision is taken and implemented for a union whose secondary input has a same-named numeric field under a parent `timestamp` field (assumed product call, flagged OWNER REVIEW).
- Each fix is proven by an analyze-versus-apply parity test that is red on the pre-fix code and green after.
- `docs/compute-expression-grammar.md` "Known limitation: a timestamp-typed column that carries a number" is updated to match the shipped behaviour.

## Driver constraints (overnight queue)

- Product calls: take the recommended reversible option, list under "OWNER REVIEW: assumed product call(s)" at the top of the PR body; the auditor must return PARKED-FOR-OWNER and not merge.
- Tests red first; any new DB-backed spec uses `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` must appear in sbt runs; no inline FQNs.
- No migration expected (next free is V127).
