package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.CreatePipelineRequest
import com.helio.domain.model._
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-1505 item 7: the production wiring end to end -- a real `DataSourceService` WITH the real `connectorRepo`
 *  (so its HEL-1497 cleanup runs), the real `InlineSourceCleanup` and the real `PatchSetUndoService` -- undoing a
 *  pipeline create whose inline root was a bare-url REST source. Rows are read straight from Postgres. */
class PatchSetUndoCombinedConnectorWiringSpec extends PatchSetInlineSourceFixture {

  override protected def wireConnectorRepoIntoDataSourceService: Boolean = true

  private final case class Created(applicationId: String, source: RestSource, connector: Connector)

  private def applyBareUrlRest(): Created = {
    val (appId, pipelineId) = applyCreate(CreatePipelineRequest(s"combined-${UUID.randomUUID()}", Vector(bareUrlRestRoot())))
    val source = await(dataSourceRepo.findByIdOwned(DataSourceId(rootSourceIds(pipelineId).head), user)).get.asInstanceOf[RestSource]
    val connector = await(connectorRepo.findByIdOwned(ConnectorId(source.config.connectorId), user)).get
    Created(appId, source, connector)
  }

  private def connectorRows(c: Connector): Int = {
    import slick.jdbc.PostgresProfile.api._
    val id = c.id.value
    await(db.run(sql"SELECT count(*) FROM connectors WHERE id = $id::uuid".as[Int])).head
  }

  private def credentialRows(c: Connector): Int = {
    import slick.jdbc.PostgresProfile.api._
    val id = c.credentialId.get.value
    await(db.run(sql"SELECT count(*) FROM connector_credentials WHERE id = $id::uuid".as[Int])).head
  }

  private def results(outcome: JsObject): Vector[String] = inlineSources(outcome).map(_.fields("result").convertTo[String])

  "undoing a bare-url REST inline root (production wiring)" should {

    "remove the source, its Auto Connector and the credential row (plain)" in {
      val created = applyBareUrlRest()
      created.connector.name should startWith("Auto: ")
      connectorRows(created.connector) shouldBe 1
      credentialRows(created.connector) shouldBe 1

      results(undoOutcome(created.applicationId)) shouldBe Vector("removed")

      sourceCount(created.source.id.value) shouldBe 0
      connectorRows(created.connector) shouldBe 0
      credentialRows(created.connector) shouldBe 0
    }

    "keep an adopted (renamed) Connector and its credential while removing the source" in {
      val created = applyBareUrlRest()
      await(connectorRepo.update(created.connector.id, "My Stripe", created.connector.baseUrl, created.connector.config, Instant.now(), user)).isDefined shouldBe true

      results(undoOutcome(created.applicationId)) shouldBe Vector("removed")

      sourceCount(created.source.id.value) shouldBe 0
      connectorRows(created.connector) shouldBe 1
      credentialRows(created.connector) shouldBe 1
    }

    "still remove the Connector and credential when only the source was renamed" in {
      val created = applyBareUrlRest()
      await(dataSourceRepo.update(created.source.copy(name = s"renamed-${UUID.randomUUID()}"), user)).isDefined shouldBe true

      results(undoOutcome(created.applicationId)) shouldBe Vector("removed")

      sourceCount(created.source.id.value) shouldBe 0
      connectorRows(created.connector) shouldBe 0
      credentialRows(created.connector) shouldBe 0
    }

    "keep a shared Connector until its last source is deleted" in {
      val created = applyBareUrlRest()
      val now     = Instant.now()
      val second = await(dataSourceRepo.insert(
        RestSource(DataSourceId(UUID.randomUUID().toString), s"second-${UUID.randomUUID()}", user.id, now, now, created.source.config), user
      ))

      results(undoOutcome(created.applicationId)) shouldBe Vector("removed")

      sourceCount(created.source.id.value) shouldBe 0
      connectorRows(created.connector) shouldBe 1
      credentialRows(created.connector) shouldBe 1

      await(dataSourceService.delete(second.id, user)) shouldBe Right(())
      connectorRows(created.connector) shouldBe 0
      credentialRows(created.connector) shouldBe 0
    }
  }
}
