-- HEL-1027 design.md D2 -- two exception-safe cast helpers used by
-- `NodeSnapshotRepository`'s server-side sort ORDER BY expression, so a single malformed value in
-- an otherwise correctly-typed column sorts as NULL (last) instead of 500ing the whole request.
--
-- `safe_numeric` stays a plain `LANGUAGE sql` function with no exception handling: digit-shape
-- validity IS full numeric validity for Postgres's `numeric` type (confirmed against pathological
-- inputs -- `1e400`, a 70-digit integer -- on a live Postgres 18 instance; see design.md D2's
-- round-1/round-3 notes), so no subtransaction cost is needed or paid.
--
-- `safe_timestamptz` cannot make the same claim: a value that is digit-shaped like one of this
-- codebase's four recognized timestamp formats (`ISO_DATE_TIME`, `ISO_LOCAL_DATE_TIME`,
-- `ISO_LOCAL_DATE`, `MM/dd/yyyy` -- see `TimestampParsing.scala`) can still be calendar-invalid
-- (`2024-02-30`), which a regex can never catch by shape alone -- Postgres's own `::timestamptz`
-- parser throws for those. `pg_input_is_valid()` would avoid the exception-handling cost but
-- requires Postgres 17+, unavailable under this repo's actual `sbt test` environment
-- (`embedded-postgres` pinned to 14.10.1, `backend/build.sbt`) -- so this function is
-- `LANGUAGE plpgsql` with an `EXCEPTION WHEN OTHERS THEN RETURN NULL` guard instead, accepting a
-- per-row subtransaction cost only when sorting/filtering by a timestamp column specifically (see
-- design.md D2/D9 for the full cost analysis).

CREATE FUNCTION safe_numeric(val text) RETURNS numeric AS $$
  SELECT CASE WHEN val ~ '^-?\d+(\.\d+)?([eE][+-]?\d+)?$' THEN val::numeric ELSE NULL END
$$ LANGUAGE sql IMMUTABLE;

-- `STABLE`, not `IMMUTABLE`: a zone-less input's (e.g. `2024-01-01T10:15`) resolved instant
-- depends on the session's `TimeZone` setting, which `IMMUTABLE` disallows depending on.
CREATE FUNCTION safe_timestamptz(val text) RETURNS timestamptz AS $$
BEGIN
  IF val !~ ('^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?'
          || '(Z|[+-]\d{2}:?\d{2})?(\[[^\]]+\])?)?|\d{2}/\d{2}/\d{4})$') THEN
    RETURN NULL;
  END IF;
  -- Postgres's `::timestamptz` input parser rejects a trailing `[Zone/Id]` suffix (valid to
  -- Java's `ISO_DATE_TIME` but not to Postgres) -- strip it before casting.
  RETURN regexp_replace(val, '\[[^\]]+\]$', '')::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
