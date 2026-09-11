package com.helio.domain.engine

import com.helio.domain.engine.DatasetSchemaMigration.{FieldEditSpec, SchemaUpdateRejection}
import com.helio.domain.model.{DataFieldType, DatasetFieldDeclaration}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1124 tasks.md section 4: exhaustive per-case coverage of design.md Decision 2's
 *  Step A-D algorithm, exercised directly against the pure planner (no DB) -- fast, and the
 *  natural home for exhaustively enumerating allowed/rejected/structural cases. Persistence-level
 *  behavior (actual row writes, concurrency, RLS) is covered separately in
 *  `DataSourceRepositorySpec`/`RlsOwnerTablesSpec`.
 */
class DatasetSchemaMigrationSpec extends AnyWordSpec with Matchers {

  private def field(name: String, t: DataFieldType, required: Boolean = false, default: Option[JsValue] = None): DatasetFieldDeclaration =
    DatasetFieldDeclaration(name, t, required, default)

  private def edit(
      name: String,
      t: DataFieldType,
      previousName: Option[String] = None,
      required: Boolean = false,
      default: Option[JsValue] = None
  ): FieldEditSpec = FieldEditSpec(name, previousName, t, required, default)

  private def plan(
      old: Vector[DatasetFieldDeclaration],
      rows: Vector[Vector[JsValue]],
      edits: Vector[FieldEditSpec],
      confirmDrop: Boolean = false
  ) = DatasetSchemaMigration.plan(old, rows, edits, confirmDrop)

  // ── 4.1 Add optional field ──────────────────────────────────────────────
  "adding an optional field" should {
    "succeed on an empty dataset" in {
      val old = Vector(field("a", DataFieldType.StringType))
      val result = plan(old, Vector.empty, Vector(edit("a", DataFieldType.StringType), edit("b", DataFieldType.StringType)))
      result shouldBe a[Right[_, _]]
      result.toOption.get.rowsMigrated shouldBe 0
    }

    "insert JsNull at the trailing position on a non-empty dataset" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x")))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType), edit("b", DataFieldType.StringType)))
      val m = result.toOption.get
      m.migratedRows shouldBe Vector(Vector(JsString("x"), JsNull))
      m.rowsMigrated shouldBe 1
    }

    "insert JsNull at a non-trailing position, leaving every other field readable at its shifted position" in {
      val old  = Vector(field("a", DataFieldType.StringType), field("c", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x"), JsString("z")))
      val result = plan(
        old, rows,
        Vector(edit("a", DataFieldType.StringType), edit("b", DataFieldType.StringType), edit("c", DataFieldType.StringType))
      )
      result.toOption.get.migratedRows shouldBe Vector(Vector(JsString("x"), JsNull, JsString("z")))
    }
  }

  // ── 4.2 Add required field ──────────────────────────────────────────────
  "adding a required field" should {
    "succeed on an empty dataset with no default" in {
      val result = plan(Vector.empty, Vector.empty, Vector(edit("a", DataFieldType.StringType, required = true)))
      result shouldBe a[Right[_, _]]
    }

    "succeed on a non-empty dataset when a default is supplied, backfilling every row" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x")))
      val result = plan(
        old, rows,
        Vector(edit("a", DataFieldType.StringType), edit("b", DataFieldType.IntegerType, required = true, default = Some(JsNumber(0))))
      )
      val m = result.toOption.get
      m.migratedRows shouldBe Vector(Vector(JsString("x"), JsNumber(0)))
      m.rowsMigrated shouldBe 1
    }

    "reject with 409-shaped DataIntegrity when no default is supplied on a non-empty dataset" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x")))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType), edit("b", DataFieldType.IntegerType, required = true)))
      result match {
        case Left(SchemaUpdateRejection.DataIntegrity(rejections)) => rejections.map(_.name) should contain("b")
        case other => fail(s"expected DataIntegrity rejection, got $other")
      }
    }
  }

  // ── 4.2b Tighten a kept field's required false->true ────────────────────
  "tightening a kept field to required" should {
    "succeed with no row modified when every existing value is already non-null" in {
      val old  = Vector(field("a", DataFieldType.StringType, required = false))
      val rows = Vector(Vector(JsString("x")), Vector(JsString("y")))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType, required = true)))
      val m = result.toOption.get
      m.migratedRows shouldBe rows
      m.rowsMigrated shouldBe 2
    }

    "backfill only the null rows when a default is supplied" in {
      val old  = Vector(field("a", DataFieldType.StringType, required = false))
      val rows = Vector(Vector(JsString("x")), Vector(JsNull))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType, required = true, default = Some(JsString("d")))))
      result.toOption.get.migratedRows shouldBe Vector(Vector(JsString("x")), Vector(JsString("d")))
    }

    "reject (409, not 500) when some rows are null and no default is supplied" in {
      val old  = Vector(field("a", DataFieldType.StringType, required = false))
      val rows = Vector(Vector(JsString("x")), Vector(JsNull))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType, required = true)))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get shouldBe a[SchemaUpdateRejection.DataIntegrity]
    }
  }

  // ── 4.2c Retype AND tighten to required in one request ──────────────────
  "retyping and tightening the same field to required together" should {
    "report the retype failure, never reaching the required check" in {
      val old  = Vector(field("a", DataFieldType.StringType, required = false))
      val rows = Vector(Vector(JsString("not-a-number")))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.IntegerType, required = true)))
      result match {
        case Left(SchemaUpdateRejection.DataIntegrity(Vector(r))) =>
          r.name shouldBe "a"
          r.reason should include("do not satisfy the new type")
        case other => fail(s"expected a single DataIntegrity rejection, got $other")
      }
    }

    "reject naming the required reason when retype succeeds but a resulting null has no default" in {
      val old  = Vector(field("a", DataFieldType.StringType, required = false))
      val rows = Vector(Vector(JsNull))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType, required = true)))
      result match {
        case Left(SchemaUpdateRejection.DataIntegrity(Vector(r))) => r.reason should include("required")
        case other => fail(s"expected a single DataIntegrity rejection, got $other")
      }
    }

    "succeed when retype succeeds and a default backfills every resulting null" in {
      val old  = Vector(field("a", DataFieldType.StringType, required = false))
      val rows = Vector(Vector(JsNull))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType, required = true, default = Some(JsString("d")))))
      result.toOption.get.migratedRows shouldBe Vector(Vector(JsString("d")))
    }
  }

  // ── 4.2d Kept required field whose default is removed ───────────────────
  "removing a kept required field's default" should {
    "reject (409) when some existing rows are null/absent for it" in {
      val old  = Vector(field("a", DataFieldType.StringType, required = true, default = Some(JsString("d"))))
      val rows = Vector(Vector(JsNull))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType, required = true, default = None)))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get shouldBe a[SchemaUpdateRejection.DataIntegrity]
    }
  }

  // ── 4.2e round-4 "touched" gate ──────────────────────────────────────────
  "an untouched field in a rename-only or retype-only edit" should {
    "never backfill its resubmitted, unchanged default into a pre-existing null" in {
      val old = Vector(
        field("a", DataFieldType.StringType),
        field("untouched", DataFieldType.StringType, required = false, default = Some(JsString("d")))
      )
      val rows = Vector(Vector(JsString("x"), JsNull))
      // rename "a" -> "renamed"; "untouched" resubmitted with its EXACT same required/default.
      val result = plan(
        old, rows,
        Vector(
          edit("renamed", DataFieldType.StringType, previousName = Some("a")),
          edit("untouched", DataFieldType.StringType, required = false, default = Some(JsString("d")))
        )
      )
      result.toOption.get.migratedRows shouldBe Vector(Vector(JsString("x"), JsNull))
    }

    "still apply backfill/rejection when the field genuinely IS touched (contrast case)" in {
      val old = Vector(field("a", DataFieldType.StringType, required = false, default = Some(JsString("d"))))
      val rows = Vector(Vector(JsNull))
      // required flips false->true: genuinely touched, backfill applies.
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType, required = true, default = Some(JsString("d")))))
      result.toOption.get.migratedRows shouldBe Vector(Vector(JsString("d")))
    }
  }

  // ── 4.3 Rename ───────────────────────────────────────────────────────────
  "renaming a field" should {
    "leave row data unchanged and report rowsMigrated: 0" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x")))
      val result = plan(old, rows, Vector(edit("renamed", DataFieldType.StringType, previousName = Some("a"))))
      val m = result.toOption.get
      m.migratedRows shouldBe rows
      m.rowsMigrated shouldBe 0
      m.newDeclaration.map(_.name) shouldBe Vector("renamed")
    }
  }

  // ── 4.4 Retype ───────────────────────────────────────────────────────────
  "retyping a field" should {
    "succeed, carrying values over unchanged, when every value already satisfies the new type" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("hello")))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringBodyType)))
      result.toOption.get.migratedRows shouldBe rows
    }

    "reject (409) naming the field and incompatible-row count when a value does not satisfy the new type" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("not-a-bool")), Vector(JsString("also-not")))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.BooleanType)))
      result match {
        case Left(SchemaUpdateRejection.DataIntegrity(Vector(r))) =>
          r.name shouldBe "a"
          r.reason should include("2")
        case other => fail(s"expected a single DataIntegrity rejection, got $other")
      }
    }

    "exempt null/absent values from the type check" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsNull))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.BooleanType)))
      result shouldBe a[Right[_, _]]
    }
  }

  // ── 4.5/4.6 Drop ─────────────────────────────────────────────────────────
  "dropping a field" should {
    "reject (409) on a non-empty dataset without confirmDrop, even when every value is null" in {
      val old  = Vector(field("a", DataFieldType.StringType), field("b", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x"), JsNull))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType)), confirmDrop = false)
      result match {
        case Left(SchemaUpdateRejection.DataIntegrity(Vector(r))) => r.name shouldBe "b"
        case other => fail(s"expected a single DataIntegrity rejection, got $other")
      }
    }

    "succeed with confirmDrop: true, removing the column from every row" in {
      val old  = Vector(field("a", DataFieldType.StringType), field("b", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x"), JsString("y")))
      val result = plan(old, rows, Vector(edit("a", DataFieldType.StringType)), confirmDrop = true)
      val m = result.toOption.get
      m.migratedRows shouldBe Vector(Vector(JsString("x")))
      m.rowsMigrated shouldBe 1
    }

    "require no confirmation on an empty dataset" in {
      val old = Vector(field("a", DataFieldType.StringType), field("b", DataFieldType.StringType))
      val result = plan(old, Vector.empty, Vector(edit("a", DataFieldType.StringType)), confirmDrop = false)
      result shouldBe a[Right[_, _]]
    }
  }

  // ── 4.7 Reorder ──────────────────────────────────────────────────────────
  "reordering fields" should {
    "rewrite row values to the new order and report the full row count" in {
      val old  = Vector(field("a", DataFieldType.StringType), field("b", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("av"), JsString("bv")))
      val result = plan(old, rows, Vector(edit("b", DataFieldType.StringType), edit("a", DataFieldType.StringType)))
      val m = result.toOption.get
      m.migratedRows shouldBe Vector(Vector(JsString("bv"), JsString("av")))
      m.rowsMigrated shouldBe 1
    }
  }

  // ── 4.9 Multi-field rejection ────────────────────────────────────────────
  "a multi-field edit with one rejected field" should {
    "reject the whole request, listing every rejected field" in {
      val old  = Vector(field("a", DataFieldType.StringType), field("b", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x"), JsString("y")))
      val result = plan(
        old, rows,
        Vector(edit("a", DataFieldType.StringType), edit("c", DataFieldType.StringType)), // adds c, drops b
        confirmDrop = false
      )
      result match {
        case Left(SchemaUpdateRejection.DataIntegrity(rejections)) => rejections.map(_.name) should contain("b")
        case other => fail(s"expected DataIntegrity rejection, got $other")
      }
    }
  }

  // ── 4.10 Structural rejections ───────────────────────────────────────────
  "structurally malformed requests" should {
    "reject when previousName names no current field" in {
      val old = Vector(field("a", DataFieldType.StringType))
      val result = plan(old, Vector.empty, Vector(edit("x", DataFieldType.StringType, previousName = Some("nope"))))
      result.left.toOption.get shouldBe a[SchemaUpdateRejection.Structural]
    }

    "reject when two payload fields share the same previousName" in {
      val old = Vector(field("a", DataFieldType.StringType))
      val result = plan(
        old, Vector.empty,
        Vector(edit("x", DataFieldType.StringType, previousName = Some("a")), edit("y", DataFieldType.StringType, previousName = Some("a")))
      )
      result.left.toOption.get shouldBe a[SchemaUpdateRejection.Structural]
    }

    "reject when two payload fields share the same name" in {
      val old = Vector(field("a", DataFieldType.StringType), field("b", DataFieldType.StringType))
      val result = plan(
        old, Vector.empty,
        Vector(edit("x", DataFieldType.StringType, previousName = Some("a")), edit("x", DataFieldType.StringType, previousName = Some("b")))
      )
      result.left.toOption.get shouldBe a[SchemaUpdateRejection.Structural]
    }

    "reject unconditionally when a rename target collides with a field being dropped" in {
      val old = Vector(field("a", DataFieldType.StringType), field("b", DataFieldType.StringType))
      // rename a -> b, while b itself is dropped (not present in the new declaration).
      val result = plan(old, Vector.empty, Vector(edit("b", DataFieldType.StringType, previousName = Some("a"))))
      result.left.toOption.get shouldBe a[SchemaUpdateRejection.Structural]
    }

    "allow a chained rename (A->X, B->A) since the resulting old->new mapping stays an injection" in {
      val old = Vector(field("a", DataFieldType.StringType), field("b", DataFieldType.StringType))
      val result = plan(
        old, Vector.empty,
        Vector(edit("x", DataFieldType.StringType, previousName = Some("a")), edit("a", DataFieldType.StringType, previousName = Some("b")))
      )
      result shouldBe a[Right[_, _]]
    }
  }

  // ── 4.11 Invalid default on an empty dataset ─────────────────────────────
  // (Type-string parsing and default-validity are performed by the repository BEFORE calling
  // `plan` -- design.md Decision 3's "checked regardless of row count" is exercised in
  // `DataSourceRepositorySpec`/`DataSourceServiceSpec`, since `FieldEditSpec.default` here is
  // already known well-formed by construction.)

  // ── 4.13 rowsMigrated operational definition ─────────────────────────────
  "rowsMigrated" should {
    "be 0 for an empty dataset regardless of edit kind" in {
      val old = Vector(field("a", DataFieldType.StringType))
      plan(old, Vector.empty, Vector(edit("a", DataFieldType.IntegerType))).toOption.get.rowsMigrated shouldBe 0
    }

    "be 0 for a rename-only edit" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("x")))
      plan(old, rows, Vector(edit("renamed", DataFieldType.StringType, previousName = Some("a")))).toOption.get.rowsMigrated shouldBe 0
    }

    "be the full row count for a successful retype-only edit even when no value needed to change" in {
      val old  = Vector(field("a", DataFieldType.StringType))
      val rows = Vector(Vector(JsString("hello")))
      plan(old, rows, Vector(edit("a", DataFieldType.StringBodyType))).toOption.get.rowsMigrated shouldBe 1
    }
  }
}
