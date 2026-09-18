package com.helio.domain.panels

import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.model.{DataFieldType, DatasetFieldDeclaration}
import spray.json._

/** HEL-1084 design.md D1 (b)-(e) — the one consistency rule enforced by both the write API
 *  (`PanelService.rejectInconsistentForm`) and mirrored in the builder's client-side check
 *  (`state/formConfigValidation.ts`'s `computeFormIssues`). Rule (a) — the bound source must be
 *  `dataset`-kind — is checked by the caller before this is reached (it needs the resolved
 *  `DataSource`, not just the declaration), so this object only ever sees a genuine dataset
 *  declaration. */
object FormSchemaConsistency {

  /** Checks `config`'s fields against `declaration`, the bound dataset's live declared schema.
   *  `Right(())` when every field names a declared field, fits its declared type's control, and
   *  carries valid typed `options`/`initialValue`; `Left(message)` on the FIRST violation found,
   *  each message naming the offending field/value per design.md D1. */
  def check(config: FormPanelConfig, declaration: Vector[DatasetFieldDeclaration]): Either[String, Unit] = {
    val byName = declaration.map(f => f.name -> f).toMap

    config.fields.collectFirst {
      case field if !byName.contains(field.sourceField) =>
        s"field '${field.sourceField}' is not declared by the bound dataset"
    }.orElse {
      config.fields.collectFirst(Function.unlift { field =>
        val declared = byName(field.sourceField)
        checkControlFitness(field, declared)
          .orElse(checkOptions(field, declared))
          .orElse(checkInitialValue(field, declared))
      })
    } match {
      case Some(err) => Left(err)
      case None      => Right(())
    }
  }

  private def checkControlFitness(field: FormFieldSpec, declared: DatasetFieldDeclaration): Option[String] = {
    val fitting = FormFieldSpec.FittingControls(declared.fieldType)
    if (fitting.contains(field.control)) None
    else Some(s"field '${field.sourceField}': control '${field.control}' does not fit its declared type — fitting controls: ${fitting.mkString(", ")}")
  }

  private def checkOptions(field: FormFieldSpec, declared: DatasetFieldDeclaration): Option[String] =
    field.options.flatMap {
      case JsArray(values) if values.nonEmpty =>
        values.collectFirst(Function.unlift { v =>
          DatasetRowValidator.validateValue(declared.fieldType, v) match {
            case Left(_) => Some(s"field '${field.sourceField}': option ${v.compactPrint} is not a valid ${DataFieldType.asString(declared.fieldType)} value")
            case Right(()) => None
          }
        })
      case JsArray(_) =>
        Some(s"field '${field.sourceField}': options must be a non-empty array")
      case _ =>
        Some(s"field '${field.sourceField}': options must be a non-empty array")
    }

  private def checkInitialValue(field: FormFieldSpec, declared: DatasetFieldDeclaration): Option[String] =
    field.initialValue.filterNot(_ == JsNull).flatMap { v =>
      DatasetRowValidator.validateValue(declared.fieldType, v) match {
        case Left(_)   => Some(s"field '${field.sourceField}': initialValue is not a valid ${DataFieldType.asString(declared.fieldType)} value")
        case Right(()) => None
      }
    }
}
