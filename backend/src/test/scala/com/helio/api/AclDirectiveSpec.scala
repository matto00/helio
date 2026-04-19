package com.helio.api

import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.{AuthenticatedUser, UserId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.Future

class AclDirectiveSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols {

  private val ownerUserId  = "owner-user-id"
  private val otherUserId  = "other-user-id"
  private val resourceId   = "resource-123"
  private val ownerUser    = AuthenticatedUser(UserId(ownerUserId))
  private val nonOwnerUser = AuthenticatedUser(UserId(otherUserId))

  private val directive = new AclDirective()

  private def ownerResolver(id: String): Future[Option[String]]     = Future.successful(Some(ownerUserId))
  private def nonOwnerResolver(id: String): Future[Option[String]]  = Future.successful(Some(otherUserId))
  private def missingResolver(id: String): Future[Option[String]]   = Future.successful(None)

  "AclDirective" should {

    "pass through to inner route when caller owns the resource" in {
      val route = directive.authorizeResource(resourceId, ownerUser, ownerResolver, "Not found") {
        complete(StatusCodes.OK, "allowed")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("allowed")
      }
    }

    "return 403 Forbidden when caller does not own the resource" in {
      val route = directive.authorizeResource(resourceId, nonOwnerUser, ownerResolver, "Not found") {
        complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }

    "return 404 Not Found when resource does not exist" in {
      val route = directive.authorizeResource(resourceId, ownerUser, missingResolver, "Not found") {
        complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Not found")
      }
    }

    "use custom notFoundMessage in 404 response" in {
      val route = directive.authorizeResource(resourceId, ownerUser, missingResolver, "Dashboard not found") {
        complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "return 403 when resolver returns a different owner than any user ID" in {
      val route = directive.authorizeResource(resourceId, ownerUser, nonOwnerResolver, "Not found") {
        complete(StatusCodes.OK, "should not reach here")
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }
  }
}
