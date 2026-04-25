package com.helio.api

import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.{AuthenticatedUser, ResourcePermission, Role, UserId}
import com.helio.infrastructure.ResourcePermissionRepository
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.Future

class AclDirectiveSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols {

  private val ownerUserId  = "owner-user-id"
  private val editorUserId = "editor-user-id"
  private val viewerUserId = "viewer-user-id"
  private val guestUserId  = "guest-user-id"
  private val otherUserId  = "other-user-id"
  private val resourceId   = "resource-123"
  private val resourceType = "dashboard"

  private val ownerUser    = AuthenticatedUser(UserId(ownerUserId))
  private val editorUser   = AuthenticatedUser(UserId(editorUserId))
  private val viewerUser   = AuthenticatedUser(UserId(viewerUserId))
  private val guestUser    = AuthenticatedUser(UserId(guestUserId))
  private val nonOwnerUser = AuthenticatedUser(UserId(otherUserId))

  // ── Permission repo stub factory ─────────────────────────────────────────────

  private def makePermRepo(
      grantFor: Map[String, Role] = Map.empty,
      hasPublicGrant: Boolean     = false
  ): ResourcePermissionRepository =
    new ResourcePermissionRepository(null)(scala.concurrent.ExecutionContext.global) {
      override def findGrant(rt: String, rid: String, granteeId: UserId): Future[Option[ResourcePermission]] =
        Future.successful(grantFor.get(granteeId.value).map { role =>
          ResourcePermission(rt, rid, Some(granteeId), role, Instant.now())
        })

      override def hasPublicViewerGrant(rt: String, rid: String): Future[Boolean] =
        Future.successful(hasPublicGrant)

      override def insert(permission: ResourcePermission): Future[ResourcePermission] =
        Future.failed(new UnsupportedOperationException("not needed in unit tests"))

      override def delete(rt: String, rid: String, granteeId: UserId): Future[Boolean] =
        Future.failed(new UnsupportedOperationException("not needed in unit tests"))

      override def findByResource(rt: String, rid: String): Future[Vector[ResourcePermission]] =
        Future.failed(new UnsupportedOperationException("not needed in unit tests"))
    }

  private val noGrantsRepo: ResourcePermissionRepository = makePermRepo()

  private def ownerResolver(id: String): Future[Option[String]]   = Future.successful(Some(ownerUserId))
  private def missingResolver(id: String): Future[Option[String]] = Future.successful(None)

  // ── authorizeResource tests ──────────────────────────────────────────────────

  "AclDirective.authorizeResource" should {

    "pass through to inner route when caller owns the resource" in {
      val directive = new AclDirective(noGrantsRepo)
      val route = directive.authorizeResource(resourceId, ownerUser, ownerResolver, "Not found") {
        complete(StatusCodes.OK, "allowed")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("allowed")
      }
    }

    "return 403 Forbidden when caller does not own the resource" in {
      val directive = new AclDirective(noGrantsRepo)
      val route = directive.authorizeResource(resourceId, nonOwnerUser, ownerResolver, "Not found") {
        complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }

    "return 404 Not Found when resource does not exist" in {
      val directive = new AclDirective(noGrantsRepo)
      val route = directive.authorizeResource(resourceId, ownerUser, missingResolver, "Not found") {
        complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Not found")
      }
    }

    "use custom notFoundMessage in 404 response" in {
      val directive = new AclDirective(noGrantsRepo)
      val route = directive.authorizeResource(resourceId, ownerUser, missingResolver, "Dashboard not found") {
        complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "return 403 when resolver returns a different owner than any user ID" in {
      val resolverWithOtherOwner: String => Future[Option[String]] =
        _ => Future.successful(Some(otherUserId))
      val directive = new AclDirective(noGrantsRepo)
      val route = directive.authorizeResource(resourceId, ownerUser, resolverWithOtherOwner, "Not found") {
        complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }
  }

  // ── authorizeResourceWithSharing tests ───────────────────────────────────────

  "AclDirective.authorizeResourceWithSharing" should {

    "provide Owner access when the authenticated user is the resource owner" in {
      val directive = new AclDirective(noGrantsRepo)
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(ownerUser), ownerResolver) {
        access => complete(StatusCodes.OK, access.toString)
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Owner")
      }
    }

    "provide Editor access when the authenticated user has an editor grant" in {
      val directive = new AclDirective(makePermRepo(grantFor = Map(editorUserId -> Role.Editor)))
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(editorUser), ownerResolver) {
        access => complete(StatusCodes.OK, access.toString)
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Editor")
      }
    }

    "provide Viewer access when the authenticated user has a viewer grant" in {
      val directive = new AclDirective(makePermRepo(grantFor = Map(viewerUserId -> Role.Viewer)))
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(viewerUser), ownerResolver) {
        access => complete(StatusCodes.OK, access.toString)
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Viewer")
      }
    }

    "return 403 when the authenticated user has no grant" in {
      val directive = new AclDirective(noGrantsRepo)
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(guestUser), ownerResolver) {
        _ => complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }

    "provide Viewer access for unauthenticated request on a public resource" in {
      val directive = new AclDirective(makePermRepo(hasPublicGrant = true))
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, None, ownerResolver) {
        access => complete(StatusCodes.OK, access.toString)
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Viewer")
      }
    }

    "return 404 for unauthenticated request on a non-public resource" in {
      val directive = new AclDirective(makePermRepo(hasPublicGrant = false))
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, None, ownerResolver, "Dashboard not found") {
        _ => complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "return 404 when the resource does not exist" in {
      val directive = new AclDirective(noGrantsRepo)
      val route = directive.authorizeResourceWithSharing(resourceType, resourceId, Some(ownerUser), missingResolver, "Dashboard not found") {
        _ => complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }
  }
}
