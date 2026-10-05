package com.helio.testsupport

import java.lang.reflect.{InvocationHandler, InvocationTargetException, Method, Proxy}
import java.sql.{Connection, PreparedStatement, Statement}
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource

/** HEL-1273 (C8): a `DataSource` -> `Connection` -> `Statement` proxy chain that counts every JDBC
 *  `execute*` call (the same pattern as L1's `OutputHistoryCostMeasurementSpec`). Wrap the OUTERMOST
 *  datasource a Slick `Database` is built on -- for a Hikari app pool that is the Hikari datasource
 *  itself, so the pool's own `connectionInitSql` (`SET ROLE ...`) runs on the raw connection and is
 *  never counted. Several pools can share one counter. */
object CountingDataSource {

  def wrap(target: DataSource, counter: AtomicInteger): DataSource = proxy(target, classOf[DataSource], counter)

  private def proxy[T](target: T, iface: Class[T], counter: AtomicInteger): T =
    Proxy.newProxyInstance(iface.getClassLoader, Array[Class[_]](iface), new InvocationHandler {
      override def invoke(p: Any, m: Method, args: Array[AnyRef]): AnyRef = {
        if (m.getName.startsWith("execute")) counter.incrementAndGet()
        val result =
          try m.invoke(target, Option(args).getOrElse(Array.empty): _*)
          catch { case e: InvocationTargetException => throw e.getCause }
        result match {
          case ps: PreparedStatement if m.getName == "prepareStatement" => proxy[PreparedStatement](ps, classOf[PreparedStatement], counter)
          case st: Statement if m.getName == "createStatement"          => proxy[Statement](st, classOf[Statement], counter)
          case c: Connection if m.getName == "getConnection"            => proxy[Connection](c, classOf[Connection], counter)
          case other                                                    => other
        }
      }
    }).asInstanceOf[T]
}
