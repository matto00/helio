## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round 2 fix 1 (D2 regex/bracket-strip)** — re-read `design.md` D2 fresh, then
independently (re-derived, not trusted) built the exact function body shown there
against a live local Postgres 18 instance (`psql -U matt -d helio -h localhost`,
`SELECT version()` → `PostgreSQL 18.4`) and ran all six documented cases myself:

```
input                                    | result
2024-01-01T10:15                        | 2024-01-01 10:15:00-08
2024-01-01T10:15+01:00                  | 2024-01-01 01:15:00-08
2024-01-01T10:15:30+01:00[Europe/Paris] | 2024-01-01 01:15:30-08
01/31/2026                              | 2026-01-31 00:00:00-08
2024-01-01                              | 2024-01-01 00:00:00-08
garbage                                 | NULL
```

Matches design.md's claimed output exactly. Also confirmed the stated justification
for the `regexp_replace` bracket-strip is real, not asserted: an unstripped cast of
`'2024-01-01T10:15:30+01:00[Europe/Paris]'::timestamptz` does throw
(`ERROR: invalid input syntax`). I also independently confirmed the Java-side claim
(`ISO_LOCAL_TIME`/`ISO_LOCAL_DATE_TIME`/`ISO_DATE_TIME` builder semantics: seconds
optional via `optionalStart()`, bracket zone-id only reachable after an offset) is
consistent with `TimestampParsing.scala:15-19`'s four formats, which I re-read fresh
from the worktree. **This fix is real and accurately described.**

**Round 2 fix 2 (D4 handleSort/handleFilterChange split)** — re-read the ACTUAL
current `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` (not the
design doc's paraphrase). Confirmed at the exact cited lines:
- `handleSort` (507–525): line 508 `toggleSort(key)` unconditional, line 509
  `if (key === UNSORTED_SENTINEL || !canWrite) return;` gates everything after
  (the debounced `persistColumnSort` call at line 523).
- `handleFilterChange` (532–544): line 533 `setFilters(next)` unconditional, line
  534 `if (!canWrite) return;` gates the debounced `persistColumnFilters` call at
  line 542.

This exactly matches D4's "unconditional first half / `canWrite`-gated second half"
description, at the line numbers cited. tasks.md 4.2 correctly requires both an
owner test (callback + PATCH) and a viewer test (callback only, no PATCH). I also
traced `useSortedRows.ts`'s real `toggleSort` reducer to check whether
`handleSort`'s `key === UNSORTED_SENTINEL` branch is reachable with the design's
proposed reordering (moving the asc/desc math before the early return) — it is not:
`toggleSort` never sets `state.key` back to the sentinel from a real column click,
so this is dead/defensive code both before and after the proposed rewrite, not a
behavior change. **This fix is real and accurately described.**

**New finding — a third, independently-verified soundness defect in D2's
`safe_timestamptz`, not raised or fixed by either prior round:**

D2's own stated purpose for `safe_timestamptz` is: "an un-guarded `::numeric`/
`::timestamptz` cast throws and 500s the WHOLE query on one bad row... `safe_*`
converts that row's sort key to `NULL` instead." `specs/output-routes-api/spec.md`
makes this a binding requirement: "A numeric/timestamp cast failure on an
individual row's value... **SHALL** sort that row's key as `NULL` (last) rather
than fail the request," with an explicit scenario (line 56-59) for the numeric
case.

The regex guard validates only digit **shape**, never calendar **validity**. Any
value that is digit-shaped like one of the four recognized formats but represents
an invalid calendar date/time (out-of-range month/day/hour) matches the regex, so
the `CASE` branch attempts the cast — and the cast itself throws, propagating an
uncaught exception rather than returning `NULL`. Reproduced against the same live
Postgres 18 instance, using the exact function body from design.md verbatim:

```sql
CREATE FUNCTION safe_timestamptz_test2(val text) RETURNS timestamptz AS $$
  SELECT CASE WHEN val ~ ('^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?'
                        || '(Z|[+-]\d{2}:?\d{2})?(\[[^\]]+\])?)?|\d{2}/\d{2}/\d{4})$')
    THEN regexp_replace(val, '\[[^\]]+\]$', '')::timestamptz ELSE NULL END
$$ LANGUAGE sql IMMUTABLE;

SELECT safe_timestamptz_test2('2024-02-30');
-- ERROR:  date/time field value out of range: "2024-02-30"
--         CONTEXT:  SQL function "safe_timestamptz_test2" statement 1

SELECT safe_timestamptz_test2('2024-13-45');
-- ERROR:  date/time field value out of range: "2024-13-45"

SELECT safe_timestamptz_test2('9999-99-99');
-- ERROR:  date/time field value out of range: "9999-99-99"
--         HINT:  Perhaps you need a different "DateStyle" setting.
```

None of these return `NULL` — each **throws**, which (since this expression runs
inline in `ORDER BY` over the whole filtered Output before `OFFSET`/`LIMIT`) would
500 the entire `GET /api/outputs/:id/rows` request for every future sort on that
column, for as long as that one bad row exists. This is precisely the failure mode
D2 exists to prevent, for exactly the case D2 itself names as realistic ("bad
upstream data, a type-narrowing edit after data was already written") — a
mistyped or corrupted date value is a completely ordinary real-world occurrence,
not a contrived adversarial input. `safe_numeric` does not share this defect — I
independently stress-tested it (`1e400`, negative exponents, etc.) and Postgres
`numeric` has no fixed range/precision ceiling that a plausible JSON-numeric value
would hit, so no cast-throws-on-shape-match case exists there. The defect is
specific to `safe_timestamptz`'s reliance on shape-only regex validation for a
type (calendar dates) whose validity constraints depend on the interaction of
multiple captured groups (day count depends on month; month/day/hour/minute all
have hard range ceilings a shape regex cannot express without re-deriving a
correct calendar validator inside a regex, which the current one does not
attempt).

I also checked whether Postgres's newer `pg_input_is_valid()` (soft-error type
validation, no exception on invalid input) would be a clean fix, since it runs on
the exact Postgres 18 instance the design doc verified against:

```sql
SELECT pg_input_is_valid('2024-13-45', 'timestamptz');   -- f
SELECT pg_input_is_valid('2024-01-01T10:15', 'timestamptz');  -- t
```

This does correctly distinguish the two cases without throwing — but
`pg_input_is_valid` was introduced in **PostgreSQL 17**, and this repo's CI runs
**PostgreSQL 16** (`.github/workflows/ci.yml:304`: `image: postgres:16`), so it is
not available in the project's actual target/CI environment as-is; I'm flagging
this only so the eventual fix isn't chosen assuming Postgres 18-only functions are
safe to rely on here — a `V111` migration needs to run correctly under CI's
Postgres 16, and the design doc's own live-verification environment (local
Postgres 18) is not what CI enforces this against. The core defect (shape-regex
can't express calendar validity) is version-independent and needs a different
fix regardless — e.g. a `plpgsql`/`EXCEPTION`-based function after all (revisiting
D2's stated subtransaction-cost objection against a correctness gap that would
otherwise 500 real user requests), or additional regex range-narrowing plus an
accepted, explicitly-documented residual gap for the few remaining invalid
combinations a regex can't rule out (e.g. Feb 30 vs. Feb 31) — but *something*
has to close this, because as specified today the ticket's own spec.md
requirement is violated by its own reference implementation.

I did not find this defect asserted or fixed by round 1 or round 2's skeptic
reports — this is a new soundness issue raised for the first time at this round.

I cleaned up all test functions I created in the shared local dev database
(`DROP FUNCTION` for `safe_timestamptz_test`, `safe_timestamptz_test2`,
`safe_timestamptz_test3`, `safe_numeric_test`) after use, per `MISTAKES.md`'s
shared-dev-DB residue concern.

**Other checks performed, no issues found:**
- `DataFieldType`/`FieldTypeCategory` (`model.scala:664-759`) reuse claims in D2/D3
  are accurate — `Structured`/`Content` categorization exists exactly as described,
  not fabricated for this design.
- `NodeSnapshotRepository.listRowsPaged` (`NodeSnapshotRepository.scala:125-159`)
  really is the existing count-query + data-query shape D5 describes extending —
  confirmed by reading the real method body.
- Ticket ACs all trace to a design decision (D1-D9) and a tasks.md item; no
  placeholder/TBD language found in proposal.md/design.md/tasks.md/spec.md.
- D6's security approach (bound parameters for column/value, closed-set Scala
  validation for direction) is consistent with the existing ACL-gate-unchanged
  claim, and tasks.md 2.3/3.3 require the red-first hostile-column-name and
  ACL-bypass tests the Iron Laws demand.

### Verdict: REFUTE

### Change Requests

1. **`safe_timestamptz` (design.md D2, `V111__safe_cast_functions.sql` per
   tasks.md 1.1) must not throw on a calendar-invalid-but-digit-shaped value.**
   As specified, `SELECT safe_timestamptz('2024-02-30')` (or `'2024-13-45'`,
   `'9999-99-99'`, or an out-of-range hour/minute like `'2024-01-01T25:99'`)
   throws instead of returning `NULL`, directly contradicting D2's own stated
   purpose and `specs/output-routes-api/spec.md`'s explicit requirement ("A
   numeric/timestamp cast failure on an individual row's value... SHALL sort that
   row's key as NULL (last) rather than fail the request"). Since this expression
   runs in `ORDER BY` over the whole Output before pagination, a single such row
   anywhere in an Output would 500 every future sorted-by-that-column request
   against it. Fix the function (or accept and document a narrower, explicitly
   scoped residual gap with the coordinator's sign-off) before this is
   implementation-ready. Note that `pg_input_is_valid()` — a clean built-in fix —
   requires Postgres 17+, and this repo's CI pins `postgres:16`
   (`.github/workflows/ci.yml:304`), so that specific mitigation is not usable
   as-is without also addressing the CI Postgres version; whatever fix is chosen
   must work under Postgres 16.
2. Once (1) is resolved, add a calendar-invalid (not merely non-numeric-shaped)
   malformed-timestamp case to task 1.1's required six-case verification set and
   to the spec.md malformed-value scenario, since the current six cases (and the
   spec's one malformed-value scenario, which is numeric-only) would not have
   caught this defect.

### Non-blocking notes

- None beyond the change requests above — the rest of the twice-revised document
  is well-grounded against real code and, on D2's timestamp-format-coverage
  question specifically (excluding the new calendar-validity gap), independently
  reproducible.
