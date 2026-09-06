package com.helio.api.http

import com.helio.api._
import com.helio.domain.model.{AuthenticatedUser, ResourcePermission, Role, UserId}
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.services.sharing.ShareTokenValidator
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-590 task 6.4: an authenticated non-grantee presenting a VALID token gets `Viewer` access
 *  (never a 403), and an owner/editor grantee already resolved is never downgraded when a valid
 *  token also happens to be present (design.md D5's "never confined to the anonymous branch, and
 *  never downgrades" property). Exercises `AclDirective.authorizeResourceWithSharing` directly, at
 *  the same level `AclDirectiveSpec` already does, rather than through a full route stack. */
class ShareTokenAuthenticatedAccessSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols {

  private val ownerUserId  = "owner-user-id"
  private val editorUserId = "editor-user-id"
  private val strangerId   = "stranger-user-id"
  private val resourceId   = "resource-abc"
  private val resourceType = "dashboard"
  private val validToken   = "a-valid-share-token"

  private val ownerUser    = AuthenticatedUser(UserId(ownerUserId))
  private val editorUser   = AuthenticatedUser(UserId(editorUserId))
  private val strangerUser = AuthenticatedUser(UserId(strangerId))

  private def alwaysAuthorizesValidToken: ShareTokenValidator =
    (_: String, _: String, token: String) => Future.successful(token == validToken)

  private def permRepo(grantFor: Map[String, Role]): ResourcePermissionRepository =
    new ResourcePermissionRepository(null)(ExecutionContext.global) {
      override def findGrant(rt: String, rid: String, granteeId: UserId): Future[Option[ResourcePermission]] =
        Future.successful(grantFor.get(granteeId.value).map(role => ResourcePermission(rt, rid, Some(granteeId), role, Instant.now())))
      override def hasPublicViewerGrant(rt: String, rid: String): Future[Boolean] = Future.successful(false)
    }

  private def registry: ResourceTypeRegistry =
    new ResourceTypeRegistry(ResourceType("dashboard", _ => Future.successful(Some(ownerUserId))))

  "an authenticated non-grantee with a valid share token" should {
    "receives Viewer access, not 403" in {
      val directive = new AclDirective(permRepo(Map.empty), registry, Some(alwaysAuthorizesValidToken))
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(strangerUser), "Not found", Some(validToken)) {
        access => complete(StatusCodes.OK, access.toString)
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Viewer")
      }
    }

    "still receives 403 when the presented token is invalid" in {
      val directive = new AclDirective(permRepo(Map.empty), registry, Some(alwaysAuthorizesValidToken))
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(strangerUser), "Not found", Some("garbage")) {
        _ => complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }
  }

  "an owner presenting a valid token alongside their own session" should {
    "remains Owner, never downgraded to Viewer" in {
      val directive = new AclDirective(permRepo(Map.empty), registry, Some(alwaysAuthorizesValidToken))
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(ownerUser), "Not found", Some(validToken)) {
        access => complete(StatusCodes.OK, access.toString)
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Owner")
      }
    }
  }

  "an editor grantee presenting a valid token alongside their own session" should {
    "remains Editor, never downgraded to Viewer" in {
      val directive = new AclDirective(permRepo(Map(editorUserId -> Role.Editor)), registry, Some(alwaysAuthorizesValidToken))
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(editorUser), "Not found", Some(validToken)) {
        access => complete(StatusCodes.OK, access.toString)
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Editor")
      }
    }
  }
}
