package com.helio.testsupport

import com.helio.domain.model.UserId
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** HEL-1347: `data_sources.owner_id` and `image_uploads.owner_id` are real foreign keys to `users`, so a test
 *  that inserts a source or upload for an owner must first insert that owner. Idempotent per id. */
object UserSeeding {

  def seedUsers(db: JdbcBackend.Database, ids: UserId*): Unit =
    ids.foreach { id =>
      Await.result(
        db.run(sqlu"""INSERT INTO users (id, email) VALUES (${id.value}::uuid, ${s"${id.value}@seeded-owner.test"}) ON CONFLICT (id) DO NOTHING"""),
        10.seconds
      )
    }
}
