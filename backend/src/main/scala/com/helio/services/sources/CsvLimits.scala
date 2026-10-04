package com.helio.services.sources

/** The single owner of the CSV size limits. Every CSV consumer holds a whole file as rows in
 *  memory, so the byte cap alone does not bound heap use: a narrow file at a large byte cap would be
 *  millions of rows and OOMs a 1 GiB instance. The caps were measured (design.md and measurements.md
 *  of csv-upload-entity-limit): the run path is bounded by cells, not bytes.
 *
 *  `entityLimitBytes` is what the Pekko entity limit on the CSV upload routes is derived from, so
 *  the byte cap a client is told about (`GET /api/data-sources/csv-limits`) and the wire limit
 *  cannot drift apart. */
object CsvLimits {

  // TEMPORARY pending HEL-1257 (streaming run path). The run path is bounded by cells: the margin is
  // measured as the minimum viable heap (N=2 concurrent real first-run builds pass in a 512m heap at
  // 300k cells), NOT as a sampled SerialGC peak, which includes uncollected garbage. Raising any cap
  // requires re-measuring N=2 concurrent runs at 768m (and the min-viable heap) first.
  val maxBytes: Long = envLong("CSV_MAX_FILE_SIZE_BYTES", 15728640L)
  val maxRows: Long  = envLong("CSV_MAX_ROWS", 50000L)
  val maxCells: Long = envLong("CSV_MAX_CELLS", 300000L)

  /** Headroom for the multipart envelope (boundaries, part headers, the `name`/`tag`/`fields`
   *  parts) so a file at exactly `maxBytes` is never rejected by the wire limit. */
  val multipartMarginBytes: Long = 1048576L

  val entityLimitBytes: Long = maxBytes + multipartMarginBytes

  final case class Scan(rows: Long, columns: Long) {
    def cells: Long = rows * columns
  }

  /** One allocation-free pass over `bytes`. Rows exclude the header and count every physical line
   *  (LF, CR and CRLF are each one break, matching `String.linesIterator`, which the run-path
   *  loader uses), so a quoted multi-line cell over-counts: conservative on purpose. Columns come
   *  from the first line, treating commas inside quotes as part of the cell. */
  def scan(bytes: Array[Byte]): Scan = {
    var lines     = 0L
    var firstLine = true
    var columns   = 1L
    var inQuotes  = false
    var lastBreak = true
    var i         = 0
    while (i < bytes.length) {
      val b = bytes(i)
      if (b == '\n' || b == '\r') {
        if (b == '\r' && i + 1 < bytes.length && bytes(i + 1) == '\n') i += 1
        lines += 1
        firstLine = false
        lastBreak = true
      } else {
        lastBreak = false
        if (firstLine) {
          if (b == '"') inQuotes = !inQuotes
          else if (b == ',' && !inQuotes) columns += 1
        }
      }
      i += 1
    }
    val totalLines = if (bytes.isEmpty) 0L else if (lastBreak) lines else lines + 1
    Scan(rows = math.max(0L, totalLines - 1), columns = columns)
  }

  /** `Some(message)` naming every limit when `bytes` breaches the byte, row or cell cap. */
  def violation(bytes: Array[Byte]): Option[String] =
    if (bytes.length.toLong > maxBytes) Some(message)
    else {
      val s = scan(bytes)
      if (s.rows > maxRows || s.cells > maxCells) Some(message) else None
    }

  def message: String =
    s"CSV is too large: files are limited to ${maxBytes / 1048576} MiB ($maxBytes bytes), $maxRows rows and $maxCells cells (rows x columns)"

  private def envLong(name: String, default: Long): Long =
    sys.env.get(name).flatMap(_.toLongOption).filter(_ > 0).getOrElse(default)
}
