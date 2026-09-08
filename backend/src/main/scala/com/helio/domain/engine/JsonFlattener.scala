package com.helio.domain.engine

import spray.json._

import scala.collection.mutable

/** HEL-599 design.md D1 — the single traversal both schema inference and row materialisation
 *  must derive from. Before this existed, `SchemaInferenceEngine.flattenObject` recursed into
 *  nested `JsObject`s while `PipelineRowJson.jsRowToRow` mapped only one level, so a DataType
 *  could advertise a dotted column (`stats.pts_ppr`) that the materialised row never carried.
 *  Duplicating the traversal a second time (rather than extracting it) would only restore
 *  agreement today and let it drift again tomorrow -- so both call sites project the same
 *  `leaves` enumeration through their own, unrelated value-conversion logic
 *  (`SchemaInferenceEngine.inferJsonType` / `PipelineRowJson.jsValueToAny`). `JsonFlattener`
 *  itself knows nothing about types or engine row values -- structure only.
 *
 *  Contract:
 *   - Object values recurse; every other `JsValue` (including `JsArray`) is a leaf at its own
 *     dotted path (design D2 legacy numbering / HEL-599). Array-of-scalars and array-of-objects
 *     are treated identically -- index expansion is rejected because a row's array length would
 *     make the column set depend on that row's data, reproducing the same ordering-dependent-
 *     schema failure HEL-858 exists to fix on the merge side.
 *   - Traversal is bounded by `MaxDepth`. An object encountered AT the bound is treated as a
 *     leaf (its compact JSON text, same as an array) rather than raising or silently dropping
 *     the column -- degrade, don't fail (design D3, HEL-599 numbering).
 *   - The returned `Seq` contains AT MOST ONE pair per dotted path -- deduplicated inside `leaves`
 *     itself, not left for each caller to fold into a `Map` on its own. A duplicate-path collision
 *     (`{"a.b": 1, "a": {"b": 2}}`) resolves deterministically to "last-in-original-walk-order
 *     wins" (design D4, HEL-599 numbering). Deduplicating here (rather than trusting every
 *     projection to fold pairs into a `Map`) is what makes "exactly one `a.b` column" true on
 *     BOTH projections, including `SchemaInferenceEngine.flattenObject`'s `InferredField`
 *     sequence -- which, unlike a row, is never folded into a `Map` by its own consumer.
 *     Final-gate skeptic round 1 found exactly this: a caller-side-only fold left a
 *     duplicate-named field in the schema while the row deduplicated, silently breaking the
 *     "schema and rows never disagree" guarantee on its own collision edge case. The returned
 *     `Seq` is additionally sorted by path for a stable, readable order (a global path sort, not
 *     the previous per-level `sortBy` `SchemaInferenceEngine.flattenObject` used before this
 *     ticket).
 *   - Purely per-object: no cross-row merge policy lives here. HEL-858 replaced the old
 *     `SchemaInferenceEngine.mergeObjects` (which merged raw objects at the top level, before
 *     flattening, first-non-null-wins) with `SchemaInferenceEngine.inferFromObjects`, a
 *     union/widen over the leaf *paths* this traversal produces -- without needing any change to
 *     this traversal itself, exactly as anticipated below.
 *
 *  HEL-1015 design.md D1/D2/D4: a path whose keys are DATA, not schema (a map), must not explode
 *  into one column per key. `detectMapPaths` computes that classification ONCE, cross-row, over a
 *  batch; `leaves`/`flattenJsObject` then take the resulting `mapPaths` set as a REQUIRED
 *  parameter (no default, no same-named single-arg overload) so a missed consumer is a
 *  compile-time error rather than a silent schema/row divergence -- the worst-case failure this
 *  design exists to rule out. Test-only / genuinely-single-object callers use the separately
 *  NAMED `leavesUnclassified` / `flattenJsObjectUnclassified` helpers below so an intentionally
 *  unclassified call is explicit and greppable, never an accidental omission.
 */
object JsonFlattener {

  /** Depth beyond which a nested object is treated as a leaf rather than recursed into.
   *  Far beyond any real API shape (the Sleeper payload driving this ticket nests 3 deep) while
   *  still finite, so a pathological or cyclic-looking response cannot grow the column set
   *  without bound. */
  val MaxDepth: Int = 10

  /** HEL-1015 design D2: coverage threshold below which a path is a map candidate. */
  private val MapCoverageThreshold: Double = 0.25

  /** HEL-1015 design D3: fewer than this many object-rows at a path gives no cross-row signal,
   *  so classification defaults to STRUCT (today's behaviour, the conservative direction). */
  private val MinObjectRowsForMapClassification: Int = 2

  /** HEL-1015 design D2/D2a: classify every nested-object path across `objects` as MAP or
   *  STRUCT, cross-row, in one batch pass, and return the set of dotted paths classified MAP.
   *
   *  Compound rule (D2): a path P, present as a `JsObject` in a set of rows R, is a MAP iff
   *  `|R| >= 2` AND `coverage < 0.25` AND `intersection` (keys present in EVERY row of R) is
   *  empty. `coverage = mean(|keys(row)| / |union(keys)|)` over R. Both conjuncts are load-
   *  bearing: coverage alone misclassifies a variant/polymorphic payload (a `type` discriminator
   *  plus variant-specific fields) as MAP; the intersection conjunct rejects that case because
   *  every variant shares its discriminator while a genuine map's data-dependent keys have no
   *  reason to recur in every row.
   *
   *  Recursion (D2a): OUTERMOST-WINS -- once a path is classified MAP, nothing beneath it is
   *  classified (it becomes one leaf under D4). Denominator for a nested path's coverage is the
   *  number of rows in which its PARENT is present as an object, not the total batch size, so an
   *  optional nested struct is not penalised for its parent's absence. A path at `MaxDepth` is
   *  never classified -- `leaves`/`walk` already treat it as a leaf regardless. */
  def detectMapPaths(objects: Seq[JsObject]): Set[String] = {
    val mapPaths = mutable.Set.empty[String]

    def classify(rowsAtLevel: Seq[JsObject], prefix: String, depth: Int): Unit = {
      if (rowsAtLevel.isEmpty || depth >= MaxDepth - 1) return
      val keys = rowsAtLevel.flatMap(_.fields.keySet).toSet
      keys.foreach { key =>
        val fullPath = if (prefix.isEmpty) key else s"$prefix.$key"
        val presentRows = rowsAtLevel.flatMap(_.fields.get(key).collect { case o: JsObject => o })
        if (presentRows.nonEmpty) {
          val isMap =
            presentRows.size >= MinObjectRowsForMapClassification && {
              val union = presentRows.flatMap(_.fields.keySet).toSet
              val coverage =
                if (union.isEmpty) 1.0
                else presentRows.map(r => r.fields.keySet.size.toDouble / union.size).sum / presentRows.size
              val intersection = presentRows.map(_.fields.keySet).reduce(_ intersect _)
              coverage < MapCoverageThreshold && intersection.isEmpty
            }
          if (isMap) {
            mapPaths += fullPath
            // Outermost-wins (D2a): a path classified MAP is one leaf under D4 -- nothing
            // beneath it is classified or emitted.
          } else {
            classify(presentRows, fullPath, depth + 1)
          }
        }
      }
    }

    classify(objects, prefix = "", depth = 0)
    mapPaths.toSet
  }

  /** Enumerate `obj`'s leaves as `(dotted path, leaf JsValue)` pairs -- at most one pair per
   *  path, sorted by path. `mapPaths` (from `detectMapPaths`, computed once per batch by the
   *  caller) is REQUIRED: a path in `mapPaths` is a leaf carrying the object itself, exactly as
   *  `JsArray` is treated (HEL-1015 design D4), and is never recursed into. There is deliberately
   *  no same-named single-argument overload -- see `leavesUnclassified` for the explicit,
   *  separately-named test-only escape hatch (HEL-1015 design D1, final-gate CR2). */
  def leaves(obj: JsObject, mapPaths: Set[String]): Seq[(String, JsValue)] = {
    // `walk` can emit the same dotted path more than once on pathological input (a literal
    // dotted key colliding with a path generated by nesting). Fold to a `Map` first (last
    // pair in `walk`'s own emission order wins, deterministically -- design D4) so every
    // consumer -- including `SchemaInferenceEngine.flattenObject`, which builds an
    // `InferredField` `Seq` directly from this and never folds it into a `Map` itself -- sees
    // exactly one entry per path. Then re-sort for a stable, readable order.
    val deduped = walk(obj, prefix = "", depth = 0, mapPaths).foldLeft(scala.collection.immutable.ListMap.empty[String, JsValue]) {
      case (acc, (path, value)) => acc.updated(path, value)
    }
    deduped.toSeq.sortBy(_._1)
  }

  /** Test-only / genuinely-single-object escape hatch: classification is cross-row by
   *  construction (HEL-1015 Context 1) and impossible to compute from one object, so this is
   *  `leaves` with an empty `mapPaths` -- never flattens a map path -- named explicitly so an
   *  intentionally-unclassified call is greppable and never mistaken for an omitted parameter. */
  def leavesUnclassified(obj: JsObject): Seq[(String, JsValue)] = leaves(obj, Set.empty)

  /** Leaves re-assembled into a flat `JsObject` -- the shape `SourceService.previewRest` needs
   *  so preview, the advertised schema, and the executed rows all agree (design D6). `mapPaths`
   *  is REQUIRED for the same reason as `leaves` (HEL-1015 design D1, final-gate CR1): preview is
   *  the third `JsonFlattener` consumer, and a single-argument version here would let it compile
   *  while silently flattening maps -- the exact divergence this design exists to make
   *  impossible. */
  def flattenJsObject(obj: JsObject, mapPaths: Set[String]): JsObject =
    JsObject(leaves(obj, mapPaths).toMap)

  /** Test-only / genuinely-single-object escape hatch, mirroring `leavesUnclassified`. */
  def flattenJsObjectUnclassified(obj: JsObject): JsObject = flattenJsObject(obj, Set.empty)

  private def walk(obj: JsObject, prefix: String, depth: Int, mapPaths: Set[String]): Seq[(String, JsValue)] =
    obj.fields.toSeq.flatMap { case (key, value) =>
      val fullKey = if (prefix.isEmpty) key else s"$prefix.$key"
      value match {
        case nested: JsObject if depth < MaxDepth - 1 && !mapPaths.contains(fullKey) =>
          walk(nested, fullKey, depth + 1, mapPaths)
        case _ =>
          // Non-object, OR an object encountered at the depth bound, OR a path classified MAP
          // (HEL-1015 D4): all three are leaves.
          Seq(fullKey -> value)
      }
    }
}
