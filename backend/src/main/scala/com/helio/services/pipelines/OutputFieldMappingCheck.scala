package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.OutputKind
import com.helio.domain.panels.OutputBindingSpec
import spray.json._

/** The pure Output config check shared by single-call pipeline creation, proposal analyze and the patch-set `output`
 *  create (HEL-1639 D2): config-only validation, then slot-name validity, then column-existence-at-the-node. Extracted
 *  from `PipelineServiceSupport` unchanged so every caller reports the same error for the same mistake. */
private[services] object OutputFieldMappingCheck {

  def validate(kind: OutputKind, config: JsObject, schema: Vector[SchemaField]): Either[ServiceError, Unit] = {
    val spec = OutputBindingSpec.All.find(_.outputKind == kind).getOrElse(
      throw new IllegalStateException(s"PipelineService: no OutputBindingSpec for kind $kind -- OutputBindingSpec.All is missing a case")
    )
    // HEL-1273/HEL-1313: the config-only checks are `PipelineCreatePreflight.validateOutputConfig` (run first,
    // unconditionally, before the no-fieldMapping early return).
    PipelineCreatePreflight.validateOutputConfig(kind, config).flatMap { _ =>
      config.fields.get("fieldMapping").collect { case o: JsObject => o } match {
        case None => Right(())
        case Some(mappingObj) =>
          val mapping = mappingObj.fields.collect { case (k, JsString(v)) => k -> v }
          OutputBindingSpec.validateFieldMapping(spec, mapping) match {
            case Left(msg) => Left(ServiceError.BadRequest(msg))
            case Right(()) =>
              OutputBindingSpec.validateFieldMappingColumnsExist(mapping, schema) match {
                case Left(msg) => Left(ServiceError.BadRequest(msg))
                case Right(()) => Right(())
              }
          }
      }
    }
  }

}
