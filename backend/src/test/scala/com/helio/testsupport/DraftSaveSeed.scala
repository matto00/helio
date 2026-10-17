package com.helio.testsupport

import java.util.UUID

/** One pipeline seeded for the draft-save specs (HEL-1629), by plain SQL so the stored state is exactly what a spec states.
 *
 *  Shape (`p` = the unique prefix, owner A):
 *  - roots `r1` (source `ds1`) and `r2` (source `ds2`); two roots so a source delete can cascade without tripping the
 *    zero-root guard
 *  - steps `t1` (root-level on r1) with children `t2` (position 0, the trunk) and `t3` (position 1, a tail); `t4`
 *    root-level on r2
 *  - Outputs `oa` (on t2, position 1) and `ob` (on t2, position 0), the REVERSE of id order, `oc` (on t3), `od` (root-bound
 *    on r2)
 *  - panels `pa` on A's dashboard `d1` bound to `oa`, `pb` on C's dashboard `d3` (a third user's) bound to `ob`
 *  - alert rules `ra` (owner A) on `oa` and `rb` (owner C) on `ob`
 *  - a schedule */
final case class DraftSaveSeed(prefix: String, owner: String, other: String) {
  def id(local: String): String = s"$prefix$local"
  val pipeline: String = id("p")
  val ds1: String      = id("ds1")
  val ds2: String      = id("ds2")
  val r1: String       = id("r1")
  val r2: String       = id("r2")
  val t1: String       = id("t1")
  val t2: String       = id("t2")
  val t3: String       = id("t3")
  val t4: String       = id("t4")
  val oa: String       = id("oa")
  val ob: String       = id("ob")
  val oc: String       = id("oc")
  val od: String       = id("od")
  val d1: String       = id("d1")
  val d3: String       = id("d3")
  val pa: String       = id("pa")
  val pb: String       = id("pb")
  val ra: String       = id("ra")
  val rb: String       = id("rb")

  /** The statements that create the seed, in dependency order. `other` owns d3, pb's dashboard and `rb`. */
  def statements: Vector[String] = Vector(
    s"""INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES
        ('$ds1','$ds1','dataset','{}',now(),now(),'$owner','[]'),('$ds2','$ds2','dataset','{}',now(),now(),'$owner','[]')""",
    s"INSERT INTO pipelines (id,name,created_at,updated_at,owner_id) VALUES ('$pipeline','$pipeline',now(),now(),'$owner')",
    s"""INSERT INTO pipeline_roots (id,pipeline_id,data_source_id,position,created_at) VALUES
        ('$r1','$pipeline','$ds1',0,now()),('$r2','$pipeline','$ds2',1,now())""",
    s"""INSERT INTO pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) VALUES
        ('$t1','$pipeline',0,'limit','{"count":1}',now(),now(),true,NULL,'$r1'),
        ('$t4','$pipeline',0,'limit','{"count":4}',now(),now(),true,NULL,'$r2')""",
    s"""INSERT INTO pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) VALUES
        ('$t2','$pipeline',0,'limit','{"count":2}',now(),now(),true,'$t1',NULL),
        ('$t3','$pipeline',1,'limit','{"count":3}',now(),now(),true,'$t1',NULL)""",
    s"""INSERT INTO outputs (id,pipeline_id,node_step_id,owner_id,name,kind,config,schema,position,created_at,updated_at,root_id) VALUES
        ('$oa','$pipeline','$t2','$owner','oa','table','{}','[]',1,now(),now(),NULL),
        ('$ob','$pipeline','$t2','$owner','ob','table','{}','[]',0,now(),now(),NULL),
        ('$oc','$pipeline','$t3','$owner','oc','table','{}','[]',2,now(),now(),NULL),
        ('$od','$pipeline',NULL,'$owner','od','table','{}','[]',3,now(),now(),'$r2')""",
    s"""INSERT INTO dashboards (id,name,created_by,created_at,last_updated,appearance,layout,owner_id) VALUES
        ('$d1','d1','u',now(),now(),'${DraftSaveSeed.DashboardAppearance}','{"lg":[],"md":[],"sm":[],"xs":[]}','$owner'),
        ('$d3','d3','u',now(),now(),'${DraftSaveSeed.DashboardAppearance}','{"lg":[],"md":[],"sm":[],"xs":[]}','$other')""",
    s"""INSERT INTO panels (id,dashboard_id,title,created_by,created_at,last_updated,appearance,owner_id,kind,output_id) VALUES
        ('$pa','$d1','pa','u',now(),now(),'${DraftSaveSeed.PanelAppearance}','$owner','output','$oa'),
        ('$pb','$d3','pb','u',now(),now(),'${DraftSaveSeed.PanelAppearance}','$other','output','$ob')""",
    s"""INSERT INTO alert_rules (id,owner_id,metric,condition,name,enabled,severity,created_at,updated_at,target_output_id) VALUES
        ('$ra','$owner','m','{}','ra',true,'warning',now(),now(),'$oa'),
        ('$rb','$other','m','{}','rb',true,'warning',now(),now(),'$ob')""",
    s"INSERT INTO pipeline_schedules (id,pipeline_id,kind,expression,enabled,timezone) VALUES ('${id("sch")}','$pipeline','cron','0 * * * *',true,'UTC')"
  )

  /** Grants `grantee` the `role` (`editor` or `viewer`) on the pipeline. */
  def grant(grantee: String, role: String): String =
    s"INSERT INTO resource_permissions (resource_type,resource_id,grantee_id,role) VALUES ('pipeline','$pipeline','$grantee','$role')"
}

object DraftSaveSeed {
  /** A stored panel appearance the repositories can read back (an empty object fails their decoder). */
  val DashboardAppearance: String = """{"background":"transparent","gridBackground":"transparent"}"""
  val PanelAppearance: String = """{"background":"transparent","color":"inherit","transparency":0.0}"""

  /** A seed with a fresh prefix, so many pipelines share one embedded database. */
  def fresh(owner: String, other: String): DraftSaveSeed = DraftSaveSeed(UUID.randomUUID().toString.take(8) + "-", owner, other)
}
