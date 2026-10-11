# HEL-1314: compute step: date/time arithmetic (timestamp differences)

## Description

Found while designing the CI Health dashboard in helio-news: queue time = started_at - created_at in seconds. Computed in Python today.

Evidence (as filed; see premise-validation.md for current state): `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala:30-31` grammar: arithmetic plus `concat/substring/lower/upper/length` only; no date/time functions or timestamp subtraction. (Stale citation: HEL-1404 split the engine; numeric functions, coalesce and unary minus have since landed. Still no date/time functions.)

What: Add date/time functions to the expression evaluator, e.g. `seconds_between(a, b)`, `date_trunc`, `add_days`, with apply/infer type parity.

## Acceptance criteria

- [ ] `seconds_between(end, start)` returns the correct number for ISO timestamps; null/unparseable input yields null (tests).
- [ ] Inferred output column types match applied types.
- [ ] Documented in the compute step editor/help and MCP proposal validation.

## Owner rulings

Resolved 2026-10-11 via the Planning escalation (escalation.answered, channel=chat, owner accepted every recommendation):

1. **Function set (ticket-three):** `seconds_between(end, start)`, `date_trunc(unit, ts)`, `add_days(ts, n)`. No `-` overloading on timestamps.
2. **Units (trunc-calendar-ok):** `date_trunc` accepts second/minute/hour/day/week (ISO Monday)/month/quarter/year; `add_days` adds exact 86400-second days (whole or fractional); no month/year addition.
3. **Result type (float-unrounded):** `seconds_between` infers `float`, returns exact seconds including fractions, no rounding.
4. **Time zones (utc-iso):** UTC throughout; offset-bearing inputs converted to UTC; tz-less inputs read as UTC; a bare date is midnight UTC. `date_trunc`/`add_days` emit an ISO-8601 UTC instant string (`2026-07-01T00:00:00Z`), analyze type `timestamp`.
5. **Null/unparseable (null-per-row-datebucket-shapes):** a null argument yields null; an unparseable value yields null for that row (never fails the run); accepted input shapes are exactly the datebucket step's (ISO instant/offset, T- or space-separated tz-less, bare yyyy-MM-dd, numeric epoch seconds/ms). An unknown `date_trunc` unit given as a string literal is a parse-time error.
6. **now() (no-now):** not added.

Driver direction (same resume): build ONE shared string-to-Instant parser so cast, datebucket and compute agree on what a timestamp is, with red-first tests on each input shape. Fold stale `SourceService.applyComputedFields` comment references into this change where the touched files carry them.
