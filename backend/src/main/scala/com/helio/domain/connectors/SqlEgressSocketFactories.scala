package com.helio.domain.connectors

import com.helio.services.sources.ContentSourceSupport
import com.mysql.cj.conf.PropertySet
import com.mysql.cj.protocol.StandardSocketFactory

import java.io.IOException
import java.net.{InetAddress, InetSocketAddress, Socket, SocketAddress}
import javax.net.SocketFactory

/** Thrown by [[EgressValidatingSocket]] before any TCP connect. Deliberately an `IOException` but
 *  NOT a `SocketException`: mysql-connector-j's address loop swallows `SocketException` and tries
 *  the next resolved record, which would turn a refusal into a silent retry. The typed
 *  [[SqlEgressRefusedException]] rides as the cause so `SqlConnectorDriver.connect` can unwrap it
 *  from the driver's own wrapper (PSQLException / CommunicationsException). */
final class EgressConnectRefusedException(msg: String)
    extends IOException(msg, SqlEgressRefusedException(msg))

/** HEL-998: the connect-time predicate the factories consult. The factories are instantiated
 *  reflectively by the drivers (no-arg), so the per-call predicate travels on a thread-local set by
 *  `SqlConnectorDriver.connect` around the synchronous `DriverManager.getConnection`. Absent means
 *  the production denylist, so a connect that somehow bypassed `connect` still fails closed. */
object EgressConnectGuard {
  private val current = ThreadLocal.withInitial[Option[InetAddress => Boolean]](() => None)

  def isBlocked(addr: InetAddress): Boolean =
    current.get().fold(ContentSourceSupport.isBlockedAddress(addr))(_(addr))

  def withPredicate[T](predicate: InetAddress => Boolean)(body: => T): T = {
    val previous = current.get()
    current.set(Some(predicate))
    try body
    finally current.set(previous)
  }
}

/** A `Socket` that validates the `InetAddress` it is actually asked to connect to — never a
 *  hostname, never a re-resolution — and refuses before `super.connect` opens any TCP connection.
 *  An unresolved address (null `getAddress`) is refused: fail closed. */
final class EgressValidatingSocket extends Socket {
  override def connect(endpoint: SocketAddress, timeout: Int): Unit = {
    val address = endpoint match {
      case isa: InetSocketAddress => Option(isa.getAddress)
      case _                      => None
    }
    address match {
      case Some(a) if !EgressConnectGuard.isBlocked(a) => super.connect(endpoint, timeout)
      case Some(a) =>
        close()
        throw new EgressConnectRefusedException(s"Egress refused: connect to a blocked address (${a.getHostAddress}) is not permitted")
      case None =>
        close()
        throw new EgressConnectRefusedException("Egress refused: connect to an unresolved address is not permitted")
    }
  }
}

/** pgjdbc `socketFactory`: `PGStream` calls `createSocket()` then `connect(InetSocketAddress, timeout)`
 *  itself, so returning the validating socket covers the connect. The host/port overloads are
 *  unused by pgjdbc but still route through the validating connect. */
final class PgEgressSocketFactory extends SocketFactory {
  override def createSocket(): Socket = new EgressValidatingSocket

  override def createSocket(host: String, port: Int): Socket = {
    val s = new EgressValidatingSocket
    s.connect(new InetSocketAddress(host, port))
    s
  }

  override def createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket = {
    val s = new EgressValidatingSocket
    s.bind(new InetSocketAddress(localHost, localPort))
    s.connect(new InetSocketAddress(host, port))
    s
  }

  override def createSocket(host: InetAddress, port: Int): Socket = {
    val s = new EgressValidatingSocket
    s.connect(new InetSocketAddress(host, port))
    s
  }

  override def createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket = {
    val s = new EgressValidatingSocket
    s.bind(new InetSocketAddress(localAddress, localPort))
    s.connect(new InetSocketAddress(address, port))
    s
  }
}

/** mysql-connector-j `socketFactory`: keeps the driver's own resolution, address loop and TLS
 *  upgrade (`StandardSocketFactory`) and only substitutes the raw socket. */
final class MysqlEgressSocketFactory extends StandardSocketFactory {
  override protected def createSocket(props: PropertySet): Socket = new EgressValidatingSocket
}
