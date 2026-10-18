package com.helio.services.pipelines.draftpreview

import com.helio.api.protocols.pipelines.{DraftPreviewFrame, DraftPreviewRequest, DraftPreviewRoot, DraftPreviewSource, DraftPreviewStepDef}
import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.services.ServiceError
import spray.json._

import DraftPreviewLimits._

/** HEL-1630 design.md D1/D7: strict decoding of the request body. Every failure names a position in the document, never a
 *  value (a cell may be user data), so a decode error cannot echo the body. A cap violation is `413`, any other defect
 *  `400`. */
object DraftPreviewRequestDecoder {

  private type Result[A] = Either[ServiceError, A]

  private def bad(msg: String): ServiceError    = ServiceError.BadRequest(msg)
  private def tooLarge(msg: String): ServiceError = ServiceError.PayloadTooLarge(msg)

  private val TopKeys    = Set("roots", "steps", "lanes", "sources", "rowsStepId")
  private val RootKeys   = Set("id", "rows", "listFrame")
  private val FrameKeys  = Set("rows", "listFrame")
  private val SourceKeys = Set("rows", "complete")
  private val StepKeys   = Set("id", "kind", "enabled", "parentStepId", "rootId", "position", "config")

  def decode(json: JsValue): Result[DraftPreviewRequest] =
    json match {
      case obj: JsObject => decodeObject(obj)
      case _             => Left(bad("Draft preview body must be a JSON object"))
    }

  private def decodeObject(obj: JsObject): Result[DraftPreviewRequest] =
    for {
      _       <- onlyKeys(obj, TopKeys, "body")
      roots   <- array(obj, "roots", required = true).flatMap(decodeRoots)
      steps   <- array(obj, "steps", required = true).flatMap(decodeSteps)
      lanes   <- keyed(obj, "lanes", MaxLanes)(decodeFrame)
      sources <- keyed(obj, "sources", MaxSources)(decodeSource)
      rowsId  <- optString(obj, "rowsStepId", "body")
      req      = DraftPreviewRequest(roots, steps, lanes, sources, rowsId)
      _       <- structure(req)
    } yield req

  private def onlyKeys(obj: JsObject, allowed: Set[String], where: String): Result[Unit] =
    if (obj.fields.keysIterator.forall(allowed.contains)) Right(()) else Left(bad(s"$where has an unsupported field"))

  private def array(obj: JsObject, key: String, required: Boolean): Result[Vector[JsValue]] =
    obj.fields.get(key) match {
      case Some(JsArray(items))     => Right(items)
      case None if !required        => Right(Vector.empty)
      case Some(JsNull) if !required => Right(Vector.empty)
      case _                        => Left(bad(s"$key must be an array"))
    }

  private def string(obj: JsObject, key: String, where: String): Result[String] =
    obj.fields.get(key) match {
      case Some(JsString(s)) => Right(s)
      case _                 => Left(bad(s"$where.$key must be a string"))
    }

  private def optString(obj: JsObject, key: String, where: String): Result[Option[String]] =
    obj.fields.get(key) match {
      case None | Some(JsNull) => Right(None)
      case Some(JsString(s))   => Right(Some(s))
      case _                   => Left(bad(s"$where.$key must be a string or null"))
    }

  private def optBool(obj: JsObject, key: String, where: String): Result[Option[Boolean]] =
    obj.fields.get(key) match {
      case None | Some(JsNull) => Right(None)
      case Some(JsBoolean(b))  => Right(Some(b))
      case _                   => Left(bad(s"$where.$key must be a boolean"))
    }

  private def idLength(id: String, where: String): Result[String] =
    if (id.length > MaxIdLength) Left(tooLarge(s"Draft preview ids are limited to $MaxIdLength characters ($where)")) else Right(id)

  private def rows(obj: JsObject, where: String): Result[Vector[Row]] =
    obj.fields.get("rows") match {
      case Some(JsArray(items)) if items.size > MaxFrameRows =>
        Left(tooLarge(s"Draft preview frames are limited to $MaxFrameRows rows ($where)"))
      case Some(JsArray(items)) =>
        val out = Vector.newBuilder[Row]
        var i   = 0
        while (i < items.size) {
          items(i) match {
            case o: JsObject =>
              DraftPreviewCells.decodeRow(o) match {
                case Some(r) => out += r
                case None    => return Left(bad(s"$where.rows[$i] has a cell that is not a supported value"))
              }
            case _ => return Left(bad(s"$where.rows[$i] must be an object"))
          }
          i += 1
        }
        Right(out.result())
      case _ => Left(bad(s"$where.rows must be an array"))
    }

  private def decodeRoots(items: Vector[JsValue]): Result[Vector[DraftPreviewRoot]] =
    if (items.isEmpty) Left(bad("roots must hold at least one input frame"))
    else if (items.size > MaxRoots) Left(tooLarge(s"Draft preview is limited to $MaxRoots root frames"))
    else
      sequence(items.zipWithIndex.map { case (v, i) =>
        val where = s"roots[$i]"
        v match {
          case o: JsObject =>
            for {
              _  <- onlyKeys(o, RootKeys, where)
              id <- string(o, "id", where).flatMap(idLength(_, where))
              rs <- rows(o, where)
              lf <- optBool(o, "listFrame", where)
            } yield DraftPreviewRoot(id, rs, lf)
          case _ => Left(bad(s"$where must be an object"))
        }
      })

  private def decodeSteps(items: Vector[JsValue]): Result[Vector[DraftPreviewStepDef]] =
    if (items.size > MaxSteps) Left(tooLarge(s"Draft preview is limited to $MaxSteps steps"))
    else
      sequence(items.zipWithIndex.map { case (v, i) =>
        val where = s"steps[$i]"
        v match {
          case o: JsObject =>
            for {
              _      <- onlyKeys(o, StepKeys, where)
              id     <- string(o, "id", where).flatMap(idLength(_, where))
              kind   <- string(o, "kind", where)
              en     <- optBool(o, "enabled", where).flatMap(_.toRight(bad(s"$where.enabled must be a boolean")))
              parent <- optString(o, "parentStepId", where).flatMap(optId(_, where))
              root   <- optString(o, "rootId", where).flatMap(optId(_, where))
              pos    <- o.fields.get("position") match {
                          case Some(JsNumber(n)) if n.isValidInt => Right(n.toIntExact)
                          case _                                 => Left(bad(s"$where.position must be an integer"))
                        }
              cfg    <- o.fields.get("config") match {
                          case Some(c: JsObject) => Right(c)
                          case _                 => Left(bad(s"$where.config must be an object"))
                        }
            } yield DraftPreviewStepDef(id, kind, en, parent, root, pos, cfg)
          case _ => Left(bad(s"$where must be an object"))
        }
      })

  private def optId(id: Option[String], where: String): Result[Option[String]] =
    id.fold[Result[Option[String]]](Right(None))(idLength(_, where).map(Some(_)))

  private def keyed[A](obj: JsObject, key: String, max: Int)(decode: (JsObject, String) => Result[A]): Result[Map[String, A]] =
    obj.fields.get(key) match {
      case None | Some(JsNull) => Right(Map.empty)
      case Some(JsObject(fields)) if fields.size > max =>
        Left(tooLarge(s"Draft preview is limited to $max entries in $key"))
      case Some(JsObject(fields)) =>
        sequence(fields.toVector.map { case (k, v) =>
          idLength(k, key).flatMap(_ =>
            v match {
              case o: JsObject => decode(o, s"$key.entry").map(k -> _)
              case _           => Left(bad(s"$key entries must be objects"))
            }
          )
        }).map(_.toMap)
      case _ => Left(bad(s"$key must be an object"))
    }

  private def decodeFrame(o: JsObject, where: String): Result[DraftPreviewFrame] =
    for {
      _  <- onlyKeys(o, FrameKeys, where)
      rs <- rows(o, where)
      lf <- optBool(o, "listFrame", where)
    } yield DraftPreviewFrame(rs, lf)

  private def decodeSource(o: JsObject, where: String): Result[DraftPreviewSource] =
    for {
      _  <- onlyKeys(o, SourceKeys, where)
      rs <- rows(o, where)
      c  <- optBool(o, "complete", where).flatMap(_.toRight(bad(s"$where.complete must be a boolean")))
    } yield DraftPreviewSource(rs, c)

  private def sequence[A](items: Vector[Result[A]]): Result[Vector[A]] = {
    val out = Vector.newBuilder[A]
    val it  = items.iterator
    while (it.hasNext)
      it.next() match {
        case Right(a) => out += a
        case Left(e)  => return Left(e)
      }
    Right(out.result())
  }

  /** Cross-field rules: unique ids, resolvable references, and the lane/step namespaces kept apart. */
  private def structure(req: DraftPreviewRequest): Result[Unit] = {
    val stepIds = req.steps.map(_.id)
    val rootIds = req.roots.map(_.id)
    val byId    = req.steps.map(s => s.id -> s).toMap
    if (stepIds.distinct.size != stepIds.size) Left(bad("Step ids must be unique"))
    else if (rootIds.distinct.size != rootIds.size) Left(bad("Root ids must be unique"))
    else if (req.lanes.keysIterator.exists(byId.contains)) Left(bad("A lane frame cannot share an id with a step in the request"))
    else if (req.rowsStepId.exists(!byId.contains(_))) Left(bad("rowsStepId must name a step in the request"))
    else
      req.steps.zipWithIndex.collectFirst {
        case (s, i) if s.parentStepId.isEmpty && s.rootId.isEmpty =>
          bad(s"steps[$i] has no parentStepId, so it must name a rootId")
        case (s, i) if s.parentStepId.isEmpty && !rootIds.contains(s.rootId.get) =>
          bad(s"steps[$i].rootId does not name a root in the request")
        case (s, i) if s.parentStepId.isDefined && s.rootId.isDefined =>
          bad(s"steps[$i] has a parentStepId, so it cannot also name a rootId")
        case (s, i) if s.parentStepId.exists(!byId.contains(_)) =>
          bad(s"steps[$i].parentStepId does not name a step in the request")
      }.toLeft(())
  }
}
