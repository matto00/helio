package com.helio.eval

import spray.json._

import scala.collection.mutable.ListBuffer
import scala.util.Try

/** Ids of everything an eval run created, in creation order, so cleanup deletes EXACTLY those ids and nothing
 *  else (the dev account and database are shared with other lanes). */
final class EvalCreated {
  val panels     = ListBuffer.empty[String]
  val outputs    = ListBuffer.empty[String]
  val dashboards = ListBuffer.empty[String]
  val pipelines  = ListBuffer.empty[String]
  val sources    = ListBuffer.empty[String]
  /** Assistant conversations the runner opened. Recorded only: the API has no way to delete one. */
  val conversations = ListBuffer.empty[String]

  def snapshot: JsObject = JsObject(
    "panels"     -> JsArray(panels.map(JsString(_)).toVector),
    "outputs"    -> JsArray(outputs.map(JsString(_)).toVector),
    "dashboards" -> JsArray(dashboards.map(JsString(_)).toVector),
    "pipelines"  -> JsArray(pipelines.map(JsString(_)).toVector),
    "sources"    -> JsArray(sources.map(JsString(_)).toVector),
    "conversationsNotDeletable" -> JsArray(conversations.map(JsString(_)).toVector)
  )
}

/** The two fixture workspaces of the HEL-1639 eval (design.md D8), created over the public API under the eval
 *  account. Standings mirrors the 2026-10-16 transcript; Sales backs the four other cases. */
object EvalWorkspace {

  final case class Standings(rostersSourceId: String, usersSourceId: String, pipelineId: String, outputId: String, dashboardId: String)
  final case class Sales(sourceId: String, pipelineId: String, outputId: String, dashboardId: String)

  private def created(reply: Reply, what: String): JsValue = {
    require(reply.ok, s"fixture step '$what' failed: HTTP ${reply.status} ${reply.body.take(300)}")
    reply.json
  }

  private def idOf(v: JsValue, what: String, path: String*): String =
    EvalJson.str(v, path: _*).getOrElse(throw new IllegalStateException(s"fixture step '$what': no id at ${path.mkString(".")} in ${v.compactPrint.take(300)}"))

  private def column(name: String, tpe: String): JsObject = JsObject("name" -> JsString(name), "type" -> JsString(tpe))

  private def staticSource(http: EvalHttp, log: EvalCreated, name: String, columns: Vector[(String, String)], rows: Vector[Vector[JsValue]]): String = {
    val body = JsObject(
      "name"    -> JsString(name),
      "type"    -> JsString("static"),
      "columns" -> JsArray(columns.map { case (n, t) => column(n, t) }),
      "rows"    -> JsArray(rows.map(JsArray(_)))
    )
    val id = idOf(created(http.post("/api/data-sources", body), s"source $name"), s"source $name", "id")
    log.sources += id
    id
  }

  private def createDashboardWithTable(http: EvalHttp, log: EvalCreated, name: String, outputId: String, panelTitle: String): String = {
    val dashboardId = idOf(created(http.post("/api/dashboards", JsObject("name" -> JsString(name))), s"dashboard $name"), s"dashboard $name", "id")
    log.dashboards += dashboardId
    val panel = created(
      http.post(
        "/api/panels",
        JsObject(
          "dashboardId" -> JsString(dashboardId),
          "title"       -> JsString(panelTitle),
          "type"        -> JsString("output"),
          "config"      -> JsObject("outputId" -> JsString(outputId))
        )
      ),
      s"panel on $name"
    )
    log.panels += idOf(panel, s"panel on $name", "id")
    dashboardId
  }

  private def createPipeline(http: EvalHttp, log: EvalCreated, body: JsObject, name: String): (String, String) = {
    val summary = created(http.post("/api/pipelines", body), s"pipeline $name")
    val pipelineId = idOf(summary, s"pipeline $name", "id")
    log.pipelines += pipelineId
    val outputs = created(http.get(s"/api/pipelines/$pipelineId/outputs"), s"outputs of $name")
    val items = outputs match {
      case JsArray(xs) => xs
      case o: JsObject => EvalJson.arr(o, "items")
      case _           => Vector.empty
    }
    val outputId = items.headOption.flatMap(EvalJson.str(_, "id")).getOrElse(throw new IllegalStateException(s"pipeline $name created no Output"))
    log.outputs += outputId
    (pipelineId, outputId)
  }

  /** Rosters + users sources, the lookup pipeline "Sleeper League Pipeline" (adds display_name, then points_for) with
   *  its table Output "Standings Table", and the "Standings" dashboard holding one table panel. The pipeline name
   *  deliberately contains no "Standings" so the dashboard is the only name match. */
  def seedStandings(http: EvalHttp, log: EvalCreated): Standings = {
    val rosterColumns = Vector(
      "owner_id" -> "string", "roster_id" -> "integer", "settings.wins" -> "integer", "settings.losses" -> "integer",
      "settings.ties" -> "integer", "settings.fpts" -> "integer", "settings.fpts_decimal" -> "integer"
    )
    val teams = Vector(("u1", 10, 3, 1500, 42), ("u2", 8, 5, 1400, 7), ("u3", 6, 7, 1300, 91), ("u4", 5, 8, 1250, 13), ("u5", 3, 10, 1100, 66))
    val rosterRows = teams.zipWithIndex.map { case ((owner, wins, losses, fpts, dec), i) =>
      Vector[JsValue](JsString(owner), JsNumber(i + 1), JsNumber(wins), JsNumber(losses), JsNumber(0), JsNumber(fpts), JsNumber(dec))
    }
    val rosters = staticSource(http, log, "Sleeper rosters", rosterColumns, rosterRows)
    val users = staticSource(
      http, log, "Sleeper users", Vector("user_id" -> "string", "display_name" -> "string"),
      teams.map { case (owner, _, _, _, _) => Vector[JsValue](JsString(owner), JsString(s"Team ${owner.drop(1)}")) }
    )
    val lookupCfg = JsObject(
      "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(users)),
      "sourceKey"      -> JsString("owner_id"),
      "lookupKey"      -> JsString("user_id"),
      "columns"        -> JsArray(JsString("display_name"))
    )
    val computeCfg = JsObject(
      "column"     -> JsString("points_for"),
      "expression" -> JsString("round($settings.fpts + $settings.fpts_decimal / 100, 2)")
    )
    val body = JsObject(
      "name"  -> JsString("Sleeper League Pipeline"),
      "roots" -> JsArray(JsObject("sourceId" -> JsString(rosters))),
      "steps" -> JsArray(
        JsObject("clientId" -> JsString("lk"), "type" -> JsString("lookup"), "config" -> lookupCfg),
        JsObject("clientId" -> JsString("pf"), "type" -> JsString("compute"), "config" -> computeCfg, "parentStepId" -> JsString("lk"))
      ),
      "outputs" -> JsArray(JsObject("nodeStepClientId" -> JsString("pf"), "kind" -> JsString("table"), "name" -> JsString("Standings Table")))
    )
    val (pipelineId, outputId) = createPipeline(http, log, body, "Sleeper League Pipeline")
    val dashboardId = createDashboardWithTable(http, log, "Standings", outputId, "Standings Table")
    Standings(rosters, users, pipelineId, outputId, dashboardId)
  }

  /** A "Sales" source (region, month, revenue, cost), a one-step pipeline with a table Output, and the
   *  "Sales Overview" dashboard with that table. Backs the four non-Standings cases. */
  def seedSales(http: EvalHttp, log: EvalCreated): Sales = {
    val regions = Vector("North", "South", "East", "West")
    val months  = Vector("2026-01", "2026-02", "2026-03")
    val rows = for {
      (region, ri) <- regions.zipWithIndex
      (month, mi)  <- months.zipWithIndex
    } yield Vector[JsValue](JsString(region), JsString(month), JsNumber(1000 + ri * 250 + mi * 90), JsNumber(600 + ri * 120 + mi * 40))
    val source = staticSource(http, log, "Sales", Vector("region" -> "string", "month" -> "string", "revenue" -> "integer", "cost" -> "integer"), rows)
    val body = JsObject(
      "name"  -> JsString("Sales Pipeline"),
      "roots" -> JsArray(JsObject("sourceId" -> JsString(source))),
      "steps" -> JsArray(
        JsObject("clientId" -> JsString("c1"), "type" -> JsString("cast"), "config" -> JsObject("casts" -> JsObject("revenue" -> JsString("integer"), "cost" -> JsString("integer"))))
      ),
      "outputs" -> JsArray(JsObject("nodeStepClientId" -> JsString("c1"), "kind" -> JsString("table"), "name" -> JsString("Sales Table")))
    )
    val (pipelineId, outputId) = createPipeline(http, log, body, "Sales Pipeline")
    val dashboardId = createDashboardWithTable(http, log, "Sales Overview", outputId, "Sales Table")
    Sales(source, pipelineId, outputId, dashboardId)
  }

  /** Deletes exactly the recorded ids: panels, Outputs, dashboards, pipelines, then sources (a pipeline
   *  references its sources). Returns one line per delete: "<kind> <id> -> <status>". */
  def cleanup(http: EvalHttp, log: EvalCreated): Vector[String] = {
    def del(kind: String, path: String, id: String): String = {
      val status = Try(http.delete(s"$path/$id").status).getOrElse(-1)
      s"$kind $id -> $status"
    }
    log.panels.reverse.map(del("panel", "/api/panels", _)).toVector ++
      log.outputs.reverse.map(del("output", "/api/outputs", _)) ++
      log.dashboards.reverse.map(del("dashboard", "/api/dashboards", _)) ++
      log.pipelines.reverse.map(del("pipeline", "/api/pipelines", _)) ++
      log.sources.reverse.map(del("source", "/api/data-sources", _))
  }
}
