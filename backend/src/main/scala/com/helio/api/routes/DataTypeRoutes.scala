package com.helio.api.routes

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.domain.ExpressionEvaluator
import com.helio.infrastructure.DataTypeRepository

import java.time.Instant
import scala.concurrent.ExecutionContextExecutor

final class DataTypeRoutes(
    dataTypeRepo: DataTypeRepository,
    aclDirective: AclDirective,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  private val acl = aclDirective

  val routes: Route =
    pathPrefix("types") {
      concat(
        pathEndOrSingleSlash {
          get {
            onSuccess(dataTypeRepo.findAll(user.id)) { types =>
              complete(DataTypesResponse(items = types.map(DataTypeResponse.fromDomain)))
            }
          }
        },
        path(Segment / "validate-expression") { typeId =>
          get {
            parameter("expr") { expr =>
              val id = DataTypeId(typeId)
              onSuccess(dataTypeRepo.findById(id)) {
                case None =>
                  complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                case Some(dt) =>
                  val fieldNames = dt.fields.map(_.name).toSet
                  ExpressionEvaluator.validate(expr, fieldNames) match {
                    case Right(_) =>
                      complete(ValidateExpressionResponse(valid = true, message = None))
                    case Left(msg) =>
                      complete(ValidateExpressionResponse(valid = false, message = Some(msg)))
                  }
              }
            }
          }
        },
        path(Segment) { typeId =>
          val id = DataTypeId(typeId)
          concat(
            get {
              onSuccess(dataTypeRepo.findById(id)) {
                case Some(dt) => complete(DataTypeResponse.fromDomain(dt))
                case None     => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
              }
            },
            patch {
              acl.authorizeResource(typeId, user, "data-type", "DataType not found") {
                entity(as[UpdateDataTypeRequest]) { request =>
                  onSuccess(dataTypeRepo.findById(id)) {
                    case None => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                    case Some(existing) =>
                      // Validate any incoming computed fields
                      val incomingComputedFields: Vector[ComputedFieldPayload] =
                        request.computedFields.getOrElse(Vector.empty)

                      // Check expression length
                      val tooLong = incomingComputedFields.find(_.expression.length > RequestValidation.MaxExpressionLength)
                      if (tooLong.isDefined) {
                        val cf = tooLong.get
                        complete(
                          StatusCodes.BadRequest,
                          ErrorResponse(s"Expression for field '${cf.name}' exceeds maximum length of ${RequestValidation.MaxExpressionLength} characters")
                        )
                      } else {
                        // Validate expressions against the merged field names
                        val updatedRegularFields = request.fields
                          .map(_.map(p => DataField(p.name, p.displayName, p.dataType, p.nullable)))
                          .getOrElse(existing.fields)
                        val fieldNames = updatedRegularFields.map(_.name).toSet

                        val exprError = incomingComputedFields.foldLeft(Option.empty[String]) {
                          case (Some(err), _) => Some(err)
                          case (None, cf) =>
                            ExpressionEvaluator.validate(cf.expression, fieldNames) match {
                              case Left(msg) => Some(s"Invalid expression for computed field '${cf.name}': $msg")
                              case Right(_)  => None
                            }
                        }

                        exprError match {
                          case Some(msg) =>
                            complete(StatusCodes.BadRequest, ErrorResponse(msg))
                          case None =>
                            val now = Instant.now()
                            val updatedComputedFields = request.computedFields
                              .map(_.map(p => ComputedField(p.name, p.displayName, p.expression, p.dataType)))
                              .getOrElse(existing.computedFields)
                            val updated = existing.copy(
                              name           = request.name.getOrElse(existing.name),
                              fields         = updatedRegularFields,
                              computedFields = updatedComputedFields,
                              updatedAt      = now
                            )
                            onSuccess(dataTypeRepo.update(updated)) {
                              case Some(dt) => complete(DataTypeResponse.fromDomain(dt))
                              case None     => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                            }
                        }
                      }
                  }
                }
              }
            },
            delete {
              acl.authorizeResource(typeId, user, "data-type", "DataType not found") {
                onSuccess(dataTypeRepo.findById(id)) {
                  case None => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                  case Some(_) =>
                    onSuccess(dataTypeRepo.isBoundToAnyPanel(id)) {
                      case true =>
                        complete(
                          StatusCodes.Conflict,
                          ErrorResponse("Cannot delete DataType: one or more panels are bound to it")
                        )
                      case false =>
                        onSuccess(dataTypeRepo.delete(id)) { _ =>
                          complete(StatusCodes.NoContent)
                        }
                    }
                }
              }
            }
          )
        }
      )
    }
}
