# Routes — Alerts

Alert rule and alert event HTTP routes.

Holds: `AlertEventRoutes`, `AlertRuleRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/alerts/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).

## Baseline semantics under history thinning (HEL-1285)

Alert conditions with a `baseline` read the Output's `output_snapshot_history`, which the retention pass
thins by age (one point per 5 minutes within 24 hours, per hour to 7 days, per day beyond). Thinning never
deletes an Output's newest 101 points (`rolling_avg` accepts `n` of at most 100, plus the triggering run's
own point), so:

- `baseline: "previous"` is the run recorded immediately before the triggering run.
- `baseline: "rolling_avg"` with `n` averages exactly the `n` runs recorded immediately before the triggering
  run (the triggering run excluded).

Both hold whether or not a retention pass has run since those points were written. The one exception is the
pipeline owner's tier maximum age (free 30 days, beta 90, owner 365 by default): a point older than the cap is
deleted regardless and can never contribute. The Output compare read API's window baselines (`1d`/`7d`/`30d`)
are different: they select the nearest surviving point at or before the target, which may be up to one thinning
bucket width earlier than the exact target.
