package com.helio.domain.engine

import com.helio.domain.model.{DataFieldType, DatasetFieldDeclaration}
import spray.json._

import scala.collection.mutable.ArrayBuffer

/** HEL-1124 design.md Decision 2: the pure, side-effect-free schema-edit planner for
 *  `PATCH /api/data-sources/:id/schema`. Kept entirely free of Slick/DBIO so Step A-D can be
 *  unit-tested directly, with no embedded Postgres — `DataSourceRepository.updateDatasetSchema`
 *  is the only caller, supplying the fresh-under-lock declaration/rows and persisting this
 *  object's `Right` output verbatim (never re-deriving it).
 */
object DatasetSchemaMigration {

  /** One caller-submitted field edit, already resolved to its DOMAIN shape (`fieldType` parsed,
   *  `required` defaulted, `default` flattened from the wire's `Option[Option[JsValue]]` idiom) --
   *  callers do that resolution (and reject an unparseable `type` string as structural) before
   *  ever reaching this object, so every `FieldEditSpec` here is internally well-formed. */
  final case class FieldEditSpec(
      name:         String,
      previousName: Option[String],
      fieldType:    DataFieldType,
      required:     Boolean,
      default:      Option[JsValue]
  )

  final case class FieldRejection(name: String, reason: String)

  sealed trait SchemaUpdateRejection
  object SchemaUpdateRejection {
    /** Malformed request -- 400. Never a data-integrity concern about existing rows. */
    final case class Structural(messages: Vector[String]) extends SchemaUpdateRejection
    /** At least one field's edit is incompatible with the dataset's existing rows -- 409,
     *  listing every rejected field (design.md Decision 2's "collect ALL rejected fields"). */
    final case class DataIntegrity(rejectedFields: Vector[FieldRejection]) extends SchemaUpdateRejection
  }

  final case class MigrationResult(
      newDeclaration: Vector[DatasetFieldDeclaration],
      migratedRows:   Vector[Vector[JsValue]],
      rowsMigrated:   Int
  )

  /** Step A: resolve field identity. Returns the old-name -> old-index map plus, on success, the
   *  per-new-field OLD index it maps to (`None` = added). Every failure here is `400`-shaped
   *  (design.md Decision 2 Step A) -- collected, not short-circuited on the first one, so a
   *  caller sees every structural problem in one response. */
  private def resolveIdentity(
      oldDeclaration: Vector[DatasetFieldDeclaration],
      edits:          Vector[FieldEditSpec]
  ): Either[Vector[String], Vector[Option[Int]]] = {
    val oldNameToIndex = oldDeclaration.zipWithIndex.map { case (f, i) => f.name -> i }.toMap
    val oldNames       = oldNameToIndex.keySet

    val errors = ArrayBuffer.empty[String]

    // Every previousName must name a real current field.
    edits.foreach { e =>
      e.previousName.foreach { pn =>
        if (!oldNames.contains(pn)) errors += s"previousName '$pn' does not match any current field"
      }
    }
    // No two payload fields may share the same previousName.
    edits.flatMap(_.previousName).groupBy(identity).foreach { case (pn, occurrences) =>
      if (occurrences.size > 1) errors += s"previousName '$pn' is targeted by more than one field"
    }
    // No two payload fields may share the same (new) name.
    edits.map(_.name).groupBy(identity).foreach { case (n, occurrences) =>
      if (occurrences.size > 1) errors += s"field name '$n' is used by more than one field in the request"
    }

    if (errors.nonEmpty) Left(errors.toVector)
    else {
      // Claimed old source per edit: previousName if given, else the (unrenamed) matching
      // current name, else None (a genuinely added field).
      val claimedSource: Vector[Option[String]] = edits.map(e => e.previousName.orElse(Some(e.name)).filter(oldNames.contains))
      // Two edits claiming the SAME old source is ambiguous -- reject (round-1 CR4 family).
      val dupClaims = claimedSource.flatten.groupBy(identity).collect { case (n, occ) if occ.size > 1 => n }
      if (dupClaims.nonEmpty) {
        Left(dupClaims.toVector.map(n => s"old field '$n' is claimed as the source of more than one new field"))
      } else {
        val matchedOldNames = claimedSource.flatten.toSet
        val droppedOldNames = oldNames -- matchedOldNames
        val newNames         = edits.map(_.name).toSet
        val collisions        = droppedOldNames.intersect(newNames)
        if (collisions.nonEmpty) {
          Left(collisions.toVector.sorted.map(n =>
            s"'$n' is both a rename target and the name of a field being dropped in this request -- resolve the collision in a separate request"
          ))
        } else {
          Right(claimedSource.map(_.map(oldNameToIndex)))
        }
      }
    }
  }

  /** Step C's single per-field algorithm (round-3 rewrite / round-4 "touched" fix). Returns
   *  either the field's rejection reason, or its final per-row candidate values. */
  private def planField(
      oldDeclaration: Vector[DatasetFieldDeclaration],
      existingRows:   Vector[Vector[JsValue]],
      edit:           FieldEditSpec,
      oldIndexOpt:    Option[Int]
  ): Either[FieldRejection, Vector[JsValue]] = {
    val oldFieldOpt = oldIndexOpt.map(oldDeclaration)
    val retyped     = oldFieldOpt.exists(_.fieldType != edit.fieldType)

    // Step 1: candidate value per row, retype-validated where applicable.
    val step1: Vector[JsValue] = oldIndexOpt match {
      case None => existingRows.map(_ => JsNull) // added field -- no old value to carry over
      case Some(i) =>
        existingRows.map(row => row.lift(i).getOrElse(JsNull))
    }

    val retypeFailureCount =
      if (!retyped) 0
      else step1.count(v => v != JsNull && DatasetRowValidator.validateValue(edit.fieldType, v).isLeft)

    if (retyped && retypeFailureCount > 0) {
      Left(FieldRejection(edit.name, s"$retypeFailureCount existing row(s) do not satisfy the new type"))
    } else {
      // Step 2: touched gate, then default/required.
      val added           = oldIndexOpt.isEmpty
      val requiredChanged = oldFieldOpt.exists(_.required != edit.required)
      val defaultChanged  = oldFieldOpt.exists(_.default != edit.default)
      val touched         = added || retyped || requiredChanged || defaultChanged

      val step2 =
        if (!touched) step1
        else step1.map(v => if (v == JsNull) edit.default.getOrElse(JsNull) else v)

      if (touched && edit.required && step2.contains(JsNull))
        Left(FieldRejection(edit.name, "field is required but a default is needed to backfill existing null/absent values"))
      else
        Right(step2)
    }
  }

  /** The full Step A-D plan. `oldDeclaration`/`existingRows` MUST already be the fresh,
   *  under-lock read (design.md Decision 4) -- this function itself has no I/O and re-reads
   *  nothing. */
  def plan(
      oldDeclaration: Vector[DatasetFieldDeclaration],
      existingRows:   Vector[Vector[JsValue]],
      edits:          Vector[FieldEditSpec],
      confirmDrop:    Boolean
  ): Either[SchemaUpdateRejection, MigrationResult] =
    resolveIdentity(oldDeclaration, edits) match {
      case Left(messages) => Left(SchemaUpdateRejection.Structural(messages))
      case Right(oldIndexOpts) =>
        val fieldResults = edits.zip(oldIndexOpts).map { case (edit, oldIdxOpt) =>
          planField(oldDeclaration, existingRows, edit, oldIdxOpt)
        }
        val matchedOldIndices = oldIndexOpts.flatten.toSet
        val droppedIndices    = oldDeclaration.indices.filterNot(matchedOldIndices.contains)
        val dropRejections =
          if (existingRows.isEmpty || confirmDrop) Vector.empty
          else droppedIndices.map(i => FieldRejection(oldDeclaration(i).name, "dropping a field with existing rows requires confirmDrop: true"))

        val fieldRejections = fieldResults.collect { case Left(r) => r }
        val allRejections   = fieldRejections ++ dropRejections

        if (allRejections.nonEmpty) Left(SchemaUpdateRejection.DataIntegrity(allRejections))
        else {
          val candidatesByField = fieldResults.collect { case Right(cs) => cs }
          val migratedRows = existingRows.indices.map { rowIdx =>
            candidatesByField.map(_.apply(rowIdx))
          }.toVector
          val newDeclaration = edits.map(e => DatasetFieldDeclaration(e.name, e.fieldType, e.required, e.default))
          val rowsMigrated   = computeRowsMigrated(oldDeclaration, edits, oldIndexOpts, existingRows.size)
          Right(MigrationResult(newDeclaration, migratedRows, rowsMigrated))
        }
    }

  /** design.md Decision 6: `0` iff the only difference from the old declaration is field
   *  name/`previousName` bookkeeping -- every new field maps to the OLD field at the SAME
   *  index, with the SAME type/required/default. Otherwise the full existing row count,
   *  regardless of whether any individual row's bytes actually changed. */
  private def computeRowsMigrated(
      oldDeclaration: Vector[DatasetFieldDeclaration],
      edits:          Vector[FieldEditSpec],
      oldIndexOpts:   Vector[Option[Int]],
      existingRowCount: Int
  ): Int = {
    val isPureRename =
      edits.size == oldDeclaration.size &&
        edits.indices.forall { j =>
          oldIndexOpts(j).contains(j) && {
            val oldField = oldDeclaration(j)
            val edit     = edits(j)
            oldField.fieldType == edit.fieldType && oldField.required == edit.required && oldField.default == edit.default
          }
        }
    if (isPureRename) 0 else existingRowCount
  }
}
