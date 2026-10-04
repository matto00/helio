package com.helio.services.sources

import org.apache.pekko.actor.{ActorSystem => ClassicSystem, ExtendedActorSystem, Extension, ExtensionId, ExtensionIdProvider}
import org.apache.pekko.http.scaladsl.settings.{ClientConnectionSettings, ConnectionPoolSettings}

import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.duration._

/** HEL-1254: per-ActorSystem cache of pinned [[ConnectionPoolSettings]], keyed by the validated
 *  [[InetAddress]] — never the hostname.
 *
 *  Pekko HTTP keys its host-connection pools on the settings object, and a
 *  `ClientTransport.withCustomResolver` transport compares by lambda reference, so freshly built
 *  settings never match an existing pool: every request got a brand-new pool and TCP connection.
 *  Returning the same settings instance per address lets Pekko reuse the pool.
 *
 *  Pinning hazard: a pool's transport connects only to the address it was built for. Keying by
 *  address means a cache hit can only ever route a request to an address that was validated for
 *  that request; keying by hostname would send a request validated to B over a pool pinned to A
 *  (the DNS-rebinding hole HEL-215/879 closed). Validation is never cached — callers run
 *  `validateAndResolve` first and look up with its result.
 *
 *  Bounded: distinct addresses are caller-influenced, so the cache is cleared on overflow. A miss
 *  only costs a new pool, never correctness; an evicted pool is orphaned until Pekko's own idle
 *  timeout (30s) shuts it down. */
final class PinnedPoolSettingsCache(system: ClassicSystem) extends Extension {
  import PinnedPoolSettingsCache._

  private val cache = new ConcurrentHashMap[InetAddress, ConnectionPoolSettings]()

  def settingsFor(address: InetAddress): ConnectionPoolSettings = {
    if (cache.size() >= MaxEntries) cache.clear()
    cache.computeIfAbsent(address, a => build(system, a))
  }
}

object PinnedPoolSettingsCache extends ExtensionId[PinnedPoolSettingsCache] with ExtensionIdProvider {
  val MaxEntries = 256

  // Pekko requires maxOpenRequests to be a power of two. Defaults (4 / 32) would newly reject a
  // burst of concurrent fetches to one API that per-request pools never limited.
  private val MaxConnections = 16
  private val MaxOpenRequests = 256

  // Below common server keep-alive defaults (Node/Apache ~5s): a reused idle connection the server
  // already closed fails a non-idempotent request (REST POST), which Pekko does not retry.
  private val KeepAliveTimeout = 4.seconds

  override def lookup: ExtensionId[_ <: Extension] = PinnedPoolSettingsCache

  override def createExtension(system: ExtendedActorSystem): PinnedPoolSettingsCache =
    new PinnedPoolSettingsCache(system)

  private def build(system: ClassicSystem, address: InetAddress): ConnectionPoolSettings =
    ConnectionPoolSettings(system)
      .withConnectionSettings(
        ClientConnectionSettings(system)
          .withConnectingTimeout(10.seconds)
          .withIdleTimeout(30.seconds)
      )
      .withMaxConnections(MaxConnections)
      .withMaxOpenRequests(MaxOpenRequests)
      .withKeepAliveTimeout(KeepAliveTimeout)
      .withTransport(ContentSourceSupport.pinnedTransport(address))
}
