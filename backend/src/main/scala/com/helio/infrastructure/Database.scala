package com.helio.infrastructure

import com.typesafe.config.Config
import org.flywaydb.core.Flyway
import slick.jdbc.JdbcBackend

object Database {

  /** Initialise the application (non-privileged) pool.
   *
   *  Runs Flyway migrations before opening the pool so the schema is always
   *  up to date before the application begins accepting requests. Reads from
   *  the `helio.db` config stanza.
   *
   *  The returned pool DOES NOT carry `BYPASSRLS`. All `withUserContext`
   *  calls route through this pool; RLS policies will be enforced normally. */
  def initApp(config: Config): JdbcBackend.Database = {
    val dbConfig = config.getConfig("helio.db")
    val url      = dbConfig.getString("url")
    val user     = if (dbConfig.hasPath("user")) dbConfig.getString("user") else ""
    val password = if (dbConfig.hasPath("password")) dbConfig.getString("password") else ""

    Flyway
      .configure()
      .dataSource(url, user, password)
      .locations("classpath:db/migration")
      .load()
      .migrate()

    JdbcBackend.Database.forConfig("helio.db", config)
  }

  /** Initialise the privileged pool for `withSystemContext` callers.
   *
   *  Does NOT run Flyway — `initApp` is always called first and Flyway is
   *  idempotent, but running it twice would add unnecessary startup latency.
   *  Reads from the `helio.db.privileged` config stanza; that stanza sets
   *  `connectionInitSql = "SET LOCAL ROLE helio_privileged"` so every
   *  connection in this pool immediately assumes the `BYPASSRLS` role.
   *
   *  This pool is the ONLY mechanism by which RLS is bypassed. The app pool
   *  returned by [[initApp]] has no path to `helio_privileged`. */
  def initPrivileged(config: Config): JdbcBackend.Database =
    JdbcBackend.Database.forConfig("helio.db.privileged", config)
}
