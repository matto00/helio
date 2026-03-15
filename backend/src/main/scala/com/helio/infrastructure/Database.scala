package com.helio.infrastructure

import com.typesafe.config.Config
import org.flywaydb.core.Flyway
import slick.jdbc.JdbcBackend

object Database {
  def init(config: Config): JdbcBackend.Database = {
    val dbConfig = config.getConfig("helio.db")
    val url      = dbConfig.getString("url")

    Flyway
      .configure()
      .dataSource(url, null, null)
      .locations("classpath:db/migration")
      .load()
      .migrate()

    slick.jdbc.JdbcBackend.Database.forConfig("helio.db", config)
  }
}
