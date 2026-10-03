package com.helio.domain.steps

/** HEL-1236: the ONE column-collision rule for `join`, shared by the in-process runtime
 *  ([[JoinStep]]), the analyze-time schema projection (`PipelineAnalyzeService.inferJoin`) and
 *  the Spark path (`SparkJobSubmitter`), so every surface produces the same column names.
 *
 *  Owner ruling (2026-10-03): auto-prefix the RIGHT side. The left column keeps its name, a
 *  colliding right column is renamed, and a join never errors on a collision nor drops a value.
 *
 *  Rules, in order:
 *  1. Left columns are never renamed or dropped.
 *  2. The join key column: when it exists on BOTH sides it is kept once, from the left; the
 *     right copy is dropped (on a matched row the two values are equal by construction, so no
 *     value is lost). When the left side does not carry the key column at all, the right key
 *     column is an ordinary right column (kept under its own name, it cannot collide).
 *  3. A right column whose name is NOT a left column keeps its name, and that name is reserved.
 *  4. A right (non-key) column whose name IS a left column is renamed `right_<name>`. If that
 *     name is already taken (a left column, a retained right column, or an earlier rename)
 *     the first free `right_<name>_2`, `right_<name>_3`, ... is used.
 *  5. Colliding columns are processed in ascending (code-point) order of their original name,
 *     never in row/map iteration order, so the result is a pure function of the two name sets.
 */
object JoinColumnNaming {
  val Prefix: String = "right_"

  /** Right column name -> output column name, for every right column that SURVIVES the join.
   *  A right column absent from the result is the dropped duplicate join key (rule 2). */
  def resolve(leftCols: Iterable[String], rightCols: Iterable[String], joinKey: String): Map[String, String] = {
    val left        = leftCols.toSet
    val right       = rightCols.toVector.distinct
    val keyDropped  = left.contains(joinKey)
    val kept        = right.filterNot(c => keyDropped && c == joinKey)
    val untouched   = kept.filterNot(left.contains)
    val colliding   = kept.filter(left.contains).sorted
    val initialTaken: Set[String] = left ++ untouched

    val (renames, _) = colliding.foldLeft((Map.empty[String, String], initialTaken)) { case ((acc, taken), col) =>
      val candidates = Iterator.single(Prefix + col) ++ Iterator.from(2).map(n => s"$Prefix${col}_$n")
      val chosen     = candidates.find(!taken.contains(_)).get
      (acc + (col -> chosen), taken + chosen)
    }
    untouched.map(c => c -> c).toMap ++ renames
  }

  /** Re-keys one right row by `mapping` (dropping columns absent from it). */
  def renameRightRow(row: Map[String, Any], mapping: Map[String, String]): Map[String, Any] =
    row.flatMap { case (k, v) => mapping.get(k).map(_ -> v) }
}
