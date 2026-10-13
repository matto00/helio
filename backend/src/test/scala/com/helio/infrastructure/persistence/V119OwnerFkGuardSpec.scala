package com.helio.infrastructure.persistence

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1433: V119's pre-delete guard -- one abort test per reference kind (pipeline root, join, lookup, union,
 *  upsertsource target, form panel), plus the negative for references to live sources. Split out of the former single
 *  V119OwnerFkMigrationSpec; the harness is [[V119MigrationHarness]]. */
class V119OwnerFkGuardSpec extends AnyWordSpec with Matchers with V119MigrationHarness {

  "V119, run as a NOSUPERUSER NOBYPASSRLS table-owning role" should {

    "abort, deleting nothing, when an orphan is one of TWO roots of a pipeline (V99 cannot fire, only the guard can stop it)" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-orphan", Some(Ghost), rowCount = 2)
      ds(c, "s-null", None)
      pipeline(c, "p-two-roots", U1)
      root(c, "r-live", "p-two-roots", "s-live", 0)
      root(c, "r-orphan", "p-two-roots", "s-orphan", 1)
      // The pipeline has no public grant, so a missing pipeline_roots bracket makes the guard see ZERO roots.
      expectGuardAbort(db, c, "pipeline roots: 1")
    }

    "abort, deleting nothing, when an orphan is a join step's secondaryInput source" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-orphan", Some(Ghost))
      pipeline(c, "p-join", U1)
      root(c, "r-live", "p-join", "s-live", 0)
      rootStep(c, "st-join", "p-join", "r-live", op = "join",
        config = """{"secondaryInput": {"kind": "source", "dataSourceId": "s-orphan"}}""")
      expectGuardAbort(db, c, "steps: 1")
    }

    // A lookup/union step carries its second input as `secondaryInput: SecondaryInput` (LookupStep.scala `LookupConfig`,
    // UnionStep.scala `UnionConfig`), encoded as {"kind":"source","dataSourceId":...} by SecondaryInput -- the same shape
    // as a join, so each of these is the join test with only the step's `op` changed.
    "abort, deleting nothing, when an orphan is a lookup step's secondaryInput source" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-orphan", Some(Ghost))
      pipeline(c, "p-lookup", U1)
      root(c, "r-live", "p-lookup", "s-live", 0)
      rootStep(c, "st-lookup", "p-lookup", "r-live", op = "lookup",
        config = """{"secondaryInput": {"kind": "source", "dataSourceId": "s-orphan"}}""")
      expectGuardAbort(db, c, "steps: 1")
    }

    "abort, deleting nothing, when an orphan is a union step's secondaryInput source" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-orphan", Some(Ghost))
      pipeline(c, "p-union", U1)
      root(c, "r-live", "p-union", "s-live", 0)
      rootStep(c, "st-union", "p-union", "r-live", op = "union",
        config = """{"secondaryInput": {"kind": "source", "dataSourceId": "s-orphan"}}""")
      expectGuardAbort(db, c, "steps: 1")
    }

    "abort, deleting nothing, when an orphan is an upsertsource step's existing-source target" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-orphan", None)
      pipeline(c, "p-upsert", U1)
      root(c, "r-live", "p-upsert", "s-live", 0)
      rootStep(c, "st-upsert", "p-upsert", "r-live", op = "upsertsource",
        config = """{"target": {"kind": "existingSource", "dataSourceId": "s-orphan"}}""")
      expectGuardAbort(db, c, "steps: 1")
    }

    "abort, deleting nothing, when an orphan is a form panel's source (on a dashboard with no public grant)" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-orphan", Some(Ghost))
      dashboard(c, "d-private", U1)
      formPanel(c, "pn-form", "d-private", U1, "s-orphan")
      expectGuardAbort(db, c, "form panels: 1")
    }

    "not abort for a step or panel that merely mentions a LIVE source" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-live-2", Some(U1))
      ds(c, "s-orphan", Some(Ghost))
      pipeline(c, "p", U1)
      root(c, "r-live", "p", "s-live", 0)
      rootStep(c, "st-join", "p", "r-live", op = "join", config = """{"secondaryInput": {"kind": "source", "dataSourceId": "s-live-2"}}""")
      rootStep(c, "st-lookup", "p", "r-live", op = "lookup", config = """{"secondaryInput": {"kind": "source", "dataSourceId": "s-live-2"}}""")
      rootStep(c, "st-union", "p", "r-live", op = "union", config = """{"secondaryInput": {"kind": "source", "dataSourceId": "s-live-2"}}""")
      dashboard(c, "d", U1)
      formPanel(c, "pn", "d", U1, "s-live-2")
      noException should be thrownBy flyway(db, Some("119")).migrate()
      ids(c, "data_sources") shouldBe Set("s-live", "s-live-2")
    }
  }

}
