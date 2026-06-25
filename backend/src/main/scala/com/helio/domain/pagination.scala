package com.helio.domain

/** Pagination cursor passed by callers to list queries.
 *
 *  Defaults: offset=0, limit=200. Server-side cap: limit is clamped to 500
 *  by the route layer; negative offset is rejected with 400 before reaching
 *  the repository. */
final case class Page(offset: Int, limit: Int)

object Page {
  val Default: Page = Page(offset = 0, limit = 200)
  val MaxLimit: Int = 500
}

/** Paginated list result returned by repository findAll methods.
 *
 *  `total` is the row count for the caller's full (un-sliced) query — callers
 *  use it to render pagination controls or to decide whether to request the
 *  next page. `offset` and `limit` echo the [[Page]] that produced this result
 *  so consumers don't need to remember the query params. */
final case class PagedResult[A](items: Vector[A], total: Int, offset: Int, limit: Int)
