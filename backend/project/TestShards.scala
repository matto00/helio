import java.io.File
import scala.io.Source

/** HEL-1287: deterministic split of the backend test suites across parallel CI shards.
  *
  * Pure (no sbt types) so it is cheap to reason about. `build.sbt` calls [[select]] only when a shard is
  * requested; with no shard requested the build keeps its original hash grouping untouched.
  *
  * Every call to [[select]] recomputes ALL shards and verifies the partition is exact (every suite in exactly
  * one shard) before returning anything, so a partition defect fails the shard run before any test executes.
  */
object TestShards {

  /** Parsed shard request: `None` when neither env var is set (unsharded run). */
  def parseEnv(env: Map[String, String]): Either[String, Option[(Int, Int)]] = {
    val indexRaw = env.get("HELIO_TEST_SHARD_INDEX").map(_.trim)
    val countRaw = env.get("HELIO_TEST_SHARD_COUNT").map(_.trim)
    (indexRaw, countRaw) match {
      case (None, None) => Right(None)
      case (Some(_), None) | (None, Some(_)) =>
        Left("HELIO_TEST_SHARD_INDEX and HELIO_TEST_SHARD_COUNT must be set together (or both unset)")
      case (Some(i), Some(c)) =>
        for {
          index <- i.toIntOption.toRight(s"HELIO_TEST_SHARD_INDEX is not an integer: '$i'")
          count <- c.toIntOption.toRight(s"HELIO_TEST_SHARD_COUNT is not an integer: '$c'")
          _ <- Either.cond(count >= 1, (), s"HELIO_TEST_SHARD_COUNT must be >= 1, got $count")
          _ <- Either.cond(
            index >= 0 && index < count,
            (),
            s"HELIO_TEST_SHARD_INDEX must be in [0, $count), got $index"
          )
        } yield Some((index, count))
    }
  }

  /** Weights file lines: `SuiteName<TAB>seconds`. Blank lines and `#` comments are ignored. */
  def loadWeights(file: File): Map[String, Double] =
    if (!file.exists()) Map.empty
    else
      Source
        .fromFile(file, "UTF-8")
        .getLines()
        .map(_.trim)
        .filter(l => l.nonEmpty && !l.startsWith("#"))
        .flatMap { line =>
          line.split("\t") match {
            case Array(name, secs) => secs.trim.toDoubleOption.map(name.trim -> _)
            case _                 => None
          }
        }
        .toMap

  private def medianWeight(weights: Map[String, Double]): Double =
    if (weights.isEmpty) 1.0
    else {
      val sorted = weights.values.toVector.sorted
      sorted(sorted.length / 2)
    }

  /** Longest-processing-time-first greedy bin packing into `bins` bins. Unknown suites weigh the median known
    * weight. Ties (equal weight, equal bin load) break by suite name / bin index, so the result is a pure
    * function of its inputs.
    */
  def lpt(names: Seq[String], weights: Map[String, Double], bins: Int): Vector[Vector[String]] = {
    val default = medianWeight(weights)
    def w(n: String): Double = weights.getOrElse(n, default)
    val ordered = names.distinct.sortBy(n => (-w(n), n))
    val loads = Array.fill(bins)(0.0)
    val out = Array.fill(bins)(Vector.empty[String])
    ordered.foreach { n =>
      val target = loads.indices.minBy(i => (loads(i), i))
      loads(target) += w(n)
      out(target) = out(target) :+ n
    }
    out.toVector
  }

  /** Fails (naming each offending suite) unless `shards` is an exact partition of `all`. */
  def verifyExactlyOnce(all: Seq[String], shards: Seq[Seq[String]]): Either[String, Unit] = {
    val counts = shards.flatten.groupBy(identity).view.mapValues(_.size).toMap
    val missing = all.distinct.filterNot(counts.contains).sorted
    val dup = counts.collect { case (n, c) if c > 1 => s"$n (in $c shards)" }.toVector.sorted
    val extra = counts.keys.filterNot(all.contains).toVector.sorted
    val problems =
      (if (missing.nonEmpty) Vector(s"assigned to NO shard: ${missing.mkString(", ")}") else Vector.empty) ++
        (if (dup.nonEmpty) Vector(s"assigned to MORE THAN ONE shard: ${dup.mkString(", ")}") else Vector.empty) ++
        (if (extra.nonEmpty) Vector(s"not a discovered suite: ${extra.mkString(", ")}") else Vector.empty)
    Either.cond(problems.isEmpty, (), s"Test shard partition is not exact -- ${problems.mkString("; ")}")
  }

  /** Suites for `index` of `count`, after verifying all `count` shards form an exact partition. */
  def select(
      all: Seq[String],
      weights: Map[String, Double],
      index: Int,
      count: Int,
      partition: (Seq[String], Map[String, Double], Int) => Vector[Vector[String]] = lpt
  ): Either[String, Vector[String]] = {
    val shards = partition(all, weights, count)
    verifyExactlyOnce(all, shards).map(_ => shards(index))
  }

  /** Splits one shard's suites into forked-JVM groups, dropping empty groups (sbt rejects them). */
  def groupWithinShard(
      suites: Seq[String],
      weights: Map[String, Double],
      groupCount: Int
  ): Vector[Vector[String]] =
    lpt(suites, weights, math.max(1, groupCount)).filter(_.nonEmpty)
}
