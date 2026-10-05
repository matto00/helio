package com.helio.testkit

import org.apache.pekko.http.scaladsl.testkit.{RouteTestTimeout, ScalatestRouteTest}
import org.scalatest.Suite

import scala.concurrent.duration._

/** The one way a backend spec obtains Pekko's route testkit (HEL-1228). Mix this in instead of
 *  `ScalatestRouteTest`; `RouteTestBaseGuardSpec` fails the suite if a spec bypasses it.
 *
 *  It exists to replace the testkit's 1-second default `RouteTestTimeout`. A request that applies
 *  and runs a pipeline against embedded Postgres took ~0.55s for the first request of a class
 *  (~0.11s after) at HEL-1228, and races 1s on a cold or CPU-contended runner, failing with
 *  "Request was neither completed nor rejected within 1 second" while the code is correct.
 *
 *  15 seconds is a fixed (deliberately NOT dilated) bound, ~27x the measured worst first-request
 *  latency (549ms). A passing request returns as soon as its response is ready, so the generous bound
 *  costs nothing on green; it only delays how long a genuinely hung request takes to fail.
 *
 *  This timeout bounds HARNESS latency only. It is not a performance check: a spec that asserts
 *  latency measures it itself (`System.nanoTime`) with its own explicit bound and never reads
 *  this value. A spec that needs a different harness bound overrides `routeTestTimeout`. */
trait HelioRouteTest extends ScalatestRouteTest { this: Suite =>
  implicit def routeTestTimeout: RouteTestTimeout = RouteTestTimeout(HelioRouteTest.HarnessTimeout)
}

object HelioRouteTest {
  val HarnessTimeout: FiniteDuration = 15.seconds
}
