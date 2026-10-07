package com.helio.domain.history

/** HEL-1285: the shared bound between alert baselines and history thinning. A `rolling_avg` alert
 *  baseline reads at most [[MaxRollingN]] recorded runs before the triggering run, so history thinning
 *  never deletes an Output's newest [[ProtectedNewestPoints]] points (those `n` runs plus the triggering
 *  run's own point). Fixed constants, deliberately not configuration: the alert validator and the
 *  thinner derive from this one value so they cannot drift. */
object HistoryBaselineLimits {

  /** Largest `n` an alert `rolling_avg` baseline accepts. */
  val MaxRollingN: Int = 100

  /** Newest history points per Output that thinning never deletes (the tier max-age purge still can). */
  val ProtectedNewestPoints: Int = MaxRollingN + 1
}
