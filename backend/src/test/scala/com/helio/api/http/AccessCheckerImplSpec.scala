package com.helio.api.http

import com.helio.domain.model.{AuthenticatedUser, ResourcePermission, ResourceAccess, Role, UserId}
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.services.ServiceError
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1002: `requireOwnerOnly` / `requireAccess` answer "real but no grant" with exactly the
 *  `NotFound` an absent resource gets; only a grantee (who already sees the resource) is `Forbidden`. */
class AccessCheckerImplSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val owner    = AuthenticatedUser(UserId("owner"))
  private val stranger = AuthenticatedUser(UserId("stranger"))
  private val viewer   = AuthenticatedUser(UserId("viewer"))
  private val editor   = AuthenticatedUser(UserId("editor"))

  private val permRepo = new ResourcePermissionRepository(null) {
    private val grants = Map("viewer" -> Role.Viewer, "editor" -> Role.Editor)
    override def findGrant(rt: String, rid: String, granteeId: UserId): Future[Option[ResourcePermission]] =
      Future.successful(grants.get(granteeId.value).map(r => ResourcePermission(rt, rid, Some(granteeId), r, Instant.now())))
    override def hasPublicViewerGrant(rt: String, rid: String): Future[Boolean] = Future.successful(false)
  }

  /** Same grants as [[permRepo]] but the resource has a public viewer grant (the anonymous-read path). */
  private val publicPermRepo = new ResourcePermissionRepository(null) {
    override def hasPublicViewerGrant(rt: String, rid: String): Future[Boolean] = Future.successful(true)
  }

  private def checker(ownerOf: Option[String]) =
    new AccessCheckerImpl(permRepo, new ResourceTypeRegistry(ResourceType("dashboard", _ => Future.successful(ownerOf))))

  private def publicChecker(ownerOf: Option[String]) =
    new AccessCheckerImpl(publicPermRepo, new ResourceTypeRegistry(ResourceType("dashboard", _ => Future.successful(ownerOf))))

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val msg     = "Dashboard not found"
  private val absent  = checker(None)
  private val present = checker(Some("owner"))

  "requireOwnerOnly" should {
    "give a no-grant caller exactly the absent-resource NotFound" in {
      val foreign = await(present.requireOwnerOnly("dashboard", "d1", stranger, msg))
      foreign shouldBe Left(ServiceError.NotFound(msg))
      foreign shouldBe await(absent.requireOwnerOnly("dashboard", "d1", stranger, msg))
    }
    "keep Forbidden for a grantee, who already sees the resource" in {
      await(present.requireOwnerOnly("dashboard", "d1", viewer, msg)) shouldBe Left(ServiceError.Forbidden())
      await(present.requireOwnerOnly("dashboard", "d1", editor, msg)) shouldBe Left(ServiceError.Forbidden())
    }
    "admit the owner" in {
      await(present.requireOwnerOnly("dashboard", "d1", owner, msg)) shouldBe Right(ResourceAccess.Owner)
    }
  }

  "requireAccess" should {
    "give a no-grant authenticated caller exactly the absent-resource NotFound" in {
      val foreign = await(present.requireAccess("dashboard", "d1", Some(stranger), msg))
      foreign shouldBe Left(ServiceError.NotFound(msg))
      foreign shouldBe await(absent.requireAccess("dashboard", "d1", Some(stranger), msg))
    }
    "return the grant tier for grantees and Owner for the owner" in {
      await(present.requireAccess("dashboard", "d1", Some(viewer), msg)) shouldBe Right(ResourceAccess.Viewer)
      await(present.requireAccess("dashboard", "d1", Some(editor), msg)) shouldBe Right(ResourceAccess.Editor)
      await(present.requireAccess("dashboard", "d1", Some(owner), msg)) shouldBe Right(ResourceAccess.Owner)
    }
  }

  // HEL-1488 site 4: the anonymous (`userOpt = None`) arm. A public viewer grant yields exactly Viewer
  // (never Editor: anonymous access is read-only); no public grant yields exactly the absent-resource NotFound.
  "requireAccess for an anonymous caller" should {
    "return exactly Viewer when the resource has a public viewer grant" in {
      await(publicChecker(Some("owner")).requireAccess("dashboard", "d1", None, msg)) shouldBe Right(ResourceAccess.Viewer)
    }
    "return exactly the absent-resource NotFound when it has no public viewer grant" in {
      await(present.requireAccess("dashboard", "d1", None, msg)) shouldBe Left(ServiceError.NotFound(msg))
      await(present.requireAccess("dashboard", "d1", None, msg)) shouldBe await(absent.requireAccess("dashboard", "d1", None, msg))
    }
  }
}
