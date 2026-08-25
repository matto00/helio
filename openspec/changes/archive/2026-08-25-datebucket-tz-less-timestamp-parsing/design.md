## Context

`DateBucketStep.parseToUtcDate` (backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala)
accepts epoch / `Instant.parse` (requires trailing `Z`) / `OffsetDateTime.parse` (requires an
explicit offset) / bare `yyyy-MM-dd` `LocalDate`. A timezone-less ISO-8601 local-datetime string —
the shape CSV/spreadsheet exports and `datetime.isoformat()[:19]`-style code actually produce —
matches none of these, so `parseToUtcDate` returns `None` for every such row, and the step
silently succeeds with an all-null bucketing. This was decided as a product question (not a
unilateral engineering pick) via escalation to the product owner during Planning; both parts below
reflect that decision.

## Goals / Non-Goals

**Goals:**
- Parse timezone-less timestamps as UTC, fixing the reported all-null bucketing.
- Accept the two shapes actually seen in the wild: `T`-separated (`2026-03-14T22:08:39`) and
  space-separated (`2026-07-01 12:00:00`), each with or without fractional seconds.
- Add a zero-parse-rate failure guard so a *future* unparseable-input shape fails execution loudly
  instead of silently, without weakening the existing per-row null-on-partial-failure contract.

**Non-Goals:**
- No workspace/pipeline timezone-configuration concept — no existing hook for it anywhere in
  `PipelineExecutionContext`/`DateBucketConfig`; out of scope for a bug-fix-sized change (rejected
  option (b) at Planning escalation).
- No change to any other date/time parsing site (`SchemaInferenceEngine`'s tz-less recognition,
  `AlertEventRoutes`/`DemoData`'s unrelated `Instant.parse` usages) — reported below, not modified;
  a follow-up ticket is filed via the standard follow-up-triage procedure, not fixed inline.
- No pre-merge prod-data inventory of currently-affected pipelines (explicit product-owner
  decision: existing all-null buckets are wrong, not load-bearing; correcting them is the point).

## Decisions

1. **Accepted timezone-less shapes — enumerated deliberately, not just "append one parser":**
   Two independently-tried `DateTimeFormatter`s are added to the existing `orElse` chain, both
   producing a `LocalDateTime` interpreted as UTC (`.atZone(ZoneOffset.UTC).toLocalDate`):
   - `DateTimeFormatter.ISO_LOCAL_DATE_TIME` — `T`-separated, optional fractional seconds
     (`2026-03-14T22:08:39`, `2026-03-14T22:08:39.123`). Handles the ticket's own repro shape.
   - A custom pattern built via `DateTimeFormatterBuilder` — space-separated, `appendPattern("yyyy-MM-dd HH:mm[:ss]")`
     plus `.appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)` for a **variable-length**
     (0–9 digit) fractional-seconds component, not a fixed `.SSS`. **Correction from skeptic round
     1:** the originally-proposed literal `yyyy-MM-dd HH:mm[:ss][.SSS]` pattern requires *exactly*
     three fractional digits and was independently verified (by both the skeptic and re-checked
     here) to reject both `2026-07-01 12:00:00.1` (1 digit) and `2026-07-01 12:00:00.123456`
     (6 digits, the Postgres/pandas default) — which would silently reintroduce the exact all-null
     bug this change exists to fix, for the single most common real-world fractional-seconds width.
     The `appendFraction` builder form accepts 0–9 digits, covering `2026-07-01 12:00:00`,
     `2026-07-01 12:00`, `2026-07-01 12:00:00.1`, and `2026-07-01 12:00:00.123456` alike.
   Both are tried *after* `OffsetDateTime.parse`/`Instant.parse` (so any string that already
   carries an explicit offset/`Z` keeps taking that branch unchanged — zero behavior change for
   already-correct input) and *before* the bare-`LocalDate` fallback (so a bare `2026-03-14` still
   matches `LocalDate.parse`, not accidentally short-circuited by a `LocalDateTime` attempt).
   Rejected explicitly: no locale-specific formats (`MM/dd/yyyy HH:mm`), no `yyyy/MM/dd` variants —
   out of scope; only the two shapes named above and already-handled ones are accepted. A string
   that matches none of these five total forms still returns `None` → `null`, unchanged.

2. **Zero-parse-rate execution-failure guard, additive.** **Correction from skeptic round 1:** the
   originally-proposed `validationError` framing does not exist as an execution-failure mechanism —
   `validationError` is an *analyze-time-only* concept (`PipelineAnalyzeService`/
   `PipelineAnalyzeProtocol`), and `inferSplitText`/`inferCompute` only ever see the input
   **schema**, never row values, so they cannot know a per-row parse-success rate; their `Some(msg)`
   return also does not fail anything — it just passes the schema through. The zero-parse-rate
   condition is only knowable from actual rows at *execution* time. Instead, `DateBucketStep`
   reuses the failure mechanism it **already has** for a bad `granularity`: `evaluate` returns
   `Future.failed(new IllegalArgumentException(...))` before any row is returned. Concretely:
   `evaluate` computes the bucketed rows via `apply` as today, then counts (a) how many input rows
   have a non-blank value at `field`, and (b) how many of the *bucketed* rows have a non-null value
   at the resolved output column; when (a) > 0 and (b) == 0, `evaluate` returns
   `Future.failed(new IllegalArgumentException(...))` instead of the successful bucketed result.
   An empty input (zero rows, or every row's field value absent/null/blank) is not an error — there
   is nothing to bucket, so nothing was silently lost. A partially-parseable input (some rows parse,
   some don't) is unaffected — the existing per-row null-on-partial-failure contract (parity with
   `CastStep`) is preserved unchanged; only the *all*-unparseable-non-empty-input case is newly
   guarded, and it is guarded by failing the whole step (matching the bad-`granularity` precedent),
   not by any `validationError`/schema-only mechanism.

3. **Sibling date/time parsing inventory (reported, not fixed):**
   - `SchemaInferenceEngine.isTimestamp` (backend/src/main/scala/com/helio/domain/engine/
     SchemaInferenceEngine.scala:131-135) has the *same* T-separator-only gap for its
     `LocalDateTime.parse(s, DateTimeFormatter.ISO_LOCAL_DATE_TIME)` check — it does not recognize
     the space-separated form either, so a space-separated tz-less column is typed as `text`
     rather than `timestamp` at schema-inference time (a different, milder symptom than
     `datebucket`'s silent-null: the column just isn't offered as bucketable, rather than
     bucketing to null). Consistency gap, not touched here.
   - `AlertEventRoutes.scala` and `DemoData.scala` also call `Instant.parse`/similar, but both are
     internal-timestamp usages (alert event serialization, seed-data fixtures) rather than
     user-uploaded-data parsing — not the same class of problem, no action needed.
   - No parsing logic was found in `CastStep` itself — it has no `timestamp`-shaped string-parsing
     branch to reconcile with.
   A follow-up ticket for the `SchemaInferenceEngine` gap is filed via the standard
   follow-up-triage procedure during Delivery, per the product owner's instruction (report, don't
   fix, they'll file it) — not resolved as part of this change.

## Risks / Trade-offs

- **Behavior change for existing pipelines** (accepted, explicit product-owner decision): any
  pipeline whose `datebucket` input is currently tz-less will see its bucketed output values
  change from `null` to the correct bucket after this ships. This is the intended fix, not a
  regression, but it is a real value change for whatever prod dashboards currently render the
  wrong (all-null-collapsed) numbers — called out explicitly in the PR description for post-deploy
  spot-checking, per the product owner's instruction; no pre-merge inventory required.
  Also: a step that previously "succeeded" with degraded (all-null) output can now fail execution
  (`Future.failed(IllegalArgumentException)`, same surfacing as an unsupported `granularity` today)
  for a genuinely unparseable-shape input (the new guard) — this is the whole
  point of the guard, not an unintended side effect, but it does mean a pipeline run that was
  silently wrong before will now visibly fail if the new UTC-parsing fallback still can't parse
  its shape (e.g. an entirely different timestamp format).
- **UTC assumption may be wrong for some users' data** (accepted, explicit product-owner decision,
  option (a) over (b)/(c)): a tz-less timestamp is ambiguous by construction; UTC is the documented
  contract `parseToUtcDate`'s name/existing behavior already establishes, and is strictly additive
  (never changes an already-correctly-parsed row) — but a user whose CSV export was actually in,
  say, `America/Los_Angeles` local time will get UTC-bucketed dates that are off by their offset
  near day boundaries. Accepted as the pragmatic default absent any workspace-timezone concept.
