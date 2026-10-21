package com.helio.domain.steps

import java.util.concurrent.TimeUnit

/** HEL-1676: a user-supplied regex (`stringops` `extractRegex`, `assert` `regex`) runs on `java.util.regex`, which backtracks
 *  exponentially on a pattern like `^(.*a){12}$`. One such step could hold a draft-preview slot, or a run, for minutes. A
 *  [[RegexTimeBox.Deadline]] bounds the wall-clock time one step spends matching, summed over every row it matches.
 *
 *  Backtracking has to read characters, so the matcher is handed a [[CharSequence]] whose `charAt` checks the deadline; on expiry it
 *  throws [[RegexTimeBudgetExceeded]], an `IllegalArgumentException`, so the engine surfaces it verbatim as a step error. */
object RegexTimeBox {

  /** The fixed per-step budget (owner ruling, HEL-1676): shared by all rows of one step evaluation, not configurable. */
  val StepBudget: Long = TimeUnit.SECONDS.toNanos(2)

  /** `charAt` consults the clock once per this many reads (a clock read per character cost measurably more). */
  private val CheckEvery = 1024

  /** One step evaluation's deadline. `reads` is the clock-check counter: it lives HERE, not in each wrapper, so it counts reads across
   *  every row of the step. A per-row counter would never reach its first check on a step made of many short rows, and a hot row
   *  would restart its count each time. A step evaluates its rows on one thread, so no synchronisation is needed. */
  final class Deadline private[steps] (budgetNanos: Long) {
    private val expiresAt = System.nanoTime() + budgetNanos
    private var reads     = 0

    private[steps] def tick(what: => String): Unit = {
      reads += 1
      if (reads >= CheckEvery) { reads = 0; check(what) }
    }

    /** Throws when the budget is spent; also called between rows so cheap rows cannot outlast it unnoticed. */
    def check(what: => String): Unit =
      if (System.nanoTime() - expiresAt >= 0) throw new RegexTimeBudgetExceeded(what, budgetNanos)

    /** The row value as a deadline-checking `CharSequence`. Matching it gives the same results as matching `s` itself. */
    def input(s: String, what: => String): CharSequence = new BoxedInput(s, this, what)
  }

  def deadline(): Deadline = new Deadline(StepBudget)

  /** Test seam (D4): a short budget to exercise the wrapper itself. Production only uses [[deadline]]. */
  private[steps] def deadline(budgetNanos: Long): Deadline = new Deadline(budgetNanos)

  private final class BoxedInput(underlying: String, deadline: Deadline, what: => String) extends CharSequence {
    def length(): Int                              = underlying.length
    def charAt(index: Int): Char                   = { deadline.tick(what); underlying.charAt(index) }
    // The plain substring: `Matcher.group` text must be unchanged and `group()` must not be able to spend or trip the budget.
    def subSequence(start: Int, end: Int): CharSequence = underlying.subSequence(start, end)
    override def toString: String                  = underlying
  }
}

/** A user regex used up its step's time budget. Not a `StepConfigError`: the configuration is valid, the input was too costly.
 *  Created without a stack trace (thrown from inside a hot matching loop). */
final class RegexTimeBudgetExceeded(what: String, budgetNanos: Long)
    extends IllegalArgumentException(s"$what exceeded the ${TimeUnit.NANOSECONDS.toSeconds(budgetNanos)} s regex time budget for this step") {
  override def fillInStackTrace(): Throwable = this
}
