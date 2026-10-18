package com.helio.domain.steps

import java.util.Locale

/** HEL-1630 (owner ruling `row-budget`): the draft preview's per-node output ceiling. Runs and the saved preview carry no
 *  ceiling (`maxNodeRows = None`), so every helper here is a plain pass-through for them. */
object RowBudget {

  /** The draft preview's `maxNodeRows`. */
  val DraftMaxNodeRows: Int = 20000

  private def formatted(n: Int): String = String.format(Locale.US, "%,d", Int.box(n))

  /** A step that would emit more than `limit` rows; raised before or while materialising them. */
  def exceeded(kind: String, limit: Int): StepConfigError =
    new StepConfigError(s"$kind would produce more than ${formatted(limit)} rows (draft preview limit)")

  /** The engine's post-node backstop for a kind with no emit-time check of its own; deliberately worded differently from
   *  [[exceeded]] so a spec can tell which guard fired. */
  def backstop(produced: Int, limit: Int): StepConfigError =
    new StepConfigError(s"node produced $produced rows, over the draft preview limit of ${formatted(limit)}")

  /** `in.flatMap(f)`, except that with a `limit` it stops pulling input rows as soon as the running output count passes it.
   *  `f` still runs to completion for the row in hand, so the overshoot is bounded by one input row's output. */
  def flatMap[A, B](in: Seq[A], limit: Option[Int], kind: String)(f: A => Seq[B]): Seq[B] =
    limit match {
      case None => in.flatMap(f)
      case Some(max) =>
        val out   = Vector.newBuilder[B]
        val it    = in.iterator
        var count = 0
        while (it.hasNext) {
          val produced = f(it.next())
          count += produced.size
          if (count > max) throw exceeded(kind, max)
          out ++= produced
        }
        out.result()
    }
}
