package com.helio.services.pipelines.draftpreview

import org.slf4j.LoggerFactory

/** HEL-1630 design.md D5: env-sourced configuration of the draft-preview endpoint, read once by [[DraftPreviewConfig.fromEnv]]
 *  and injected (a spec passes its own values). The rate limit has its own bucket, separate from the general `/api` one, and is
 *  per instance like every other limiter here. */
final case class DraftPreviewConfig(
    requestsPerWindow: Int,
    maxInFlight: Int,
    maxInFlightPerPrincipal: Int,
    /** How long a response entity may stay unmaterialized before its in-flight permit is released (client reset the connection). */
    materializeGraceMillis: Long = DraftPreviewConfig.DefaultMaterializeGraceMillis
)

object DraftPreviewConfig {
  private val log = LoggerFactory.getLogger(getClass)

  val DefaultRequestsPerWindow: Int       = 120
  val DefaultMaterializeGraceMillis: Long = 5000L
  val DefaultMaxInFlightPerPrincipal: Int = 2

  /** design.md D7: `min(8, floor(192 MB / peak))`, where 192 MB is 25 % of the production heap (`-XX:MaxRAMPercentage=75.0` in the
   *  `Dockerfile` over `--memory=1Gi` in `infra/deploy-backend.sh`) and `peak` is the MAXIMUM over the worst request shapes (chain, comb,
   *  lane-held, select-held, fresh-chain, doubling-5/6, and the four fan-out shapes) that `DraftPreviewHeapSpec` measures (evidence: `heap-measurement.txt`); it fails if this constant stops matching
   *  the formula or the maximum passes 96 MB. The bound is enforced and measured, not proven for every request the caps allow
   *  (owner rulings C6, C7): the draft walk finishes leaf children first, frames are released once unneeded (`retainOnly`),
   *  `DraftPreviewLimits.MaxLiveCells` fails the node that would pass the live-cell budget (text priced by length), and a
   *  `compute`/`stringops`/`splittext`/`extractheadings`/`chunkbytokencount`/`convertformat` node (and a `cast` to string, and a `pivot`'s column names) emits under a
   *  text budget (owner rulings C7, C8, C9). The kinds that only share or relabel existing text are priced once their frame lands.
   *  Arithmetic: 768 MB prod heap x 25 % = 192 MB; measured maximum 74.5 MB over eleven shapes; floor(192 / 74.5) = 2. Bodies still being
   *  read are bounded separately: `maxReading = 4 x maxInFlight`, each at most 4 MiB. */
  val DefaultMaxInFlight: Int = 2

  def fromEnv(): DraftPreviewConfig = fromLookup(sys.env.get)

  def fromLookup(env: String => Option[String]): DraftPreviewConfig =
    DraftPreviewConfig(
      requestsPerWindow = positive(env, "DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW", DefaultRequestsPerWindow),
      maxInFlight = positive(env, "DRAFT_PREVIEW_MAX_IN_FLIGHT", DefaultMaxInFlight),
      maxInFlightPerPrincipal = DefaultMaxInFlightPerPrincipal
    )

  private def positive(env: String => Option[String], name: String, default: Int): Int =
    env(name) match {
      case None => default
      case Some(raw) =>
        raw.trim.toIntOption.filter(_ >= 1).getOrElse {
          log.warn("{} is not an integer >= 1; using {}", name, Int.box(default))
          default
        }
    }
}
