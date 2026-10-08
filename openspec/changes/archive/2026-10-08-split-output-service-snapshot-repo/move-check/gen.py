#!/usr/bin/env python3
"""Generates the HEL-1187 split from `git show 24f6de4cf:<path>` by line-range moves (so moved text is a copy)."""
import subprocess, sys, os
W = sys.argv[1]
BASE = "24f6de4cf"
SVC = "backend/src/main/scala/com/helio/services/pipelines/"
PER = "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/"
def base(p): return subprocess.run(["git","-C",W,"show",f"{BASE}:{p}"],capture_output=True,text=True,check=True).stdout.split("\n")[:-1]
def rng(L,a,b): return L[a-1:b]
def sub(lines, old, new, count=1):
    t="\n".join(lines)
    assert t.count(old)==count,(old,t.count(old))
    return t.replace(old,new).split("\n")
def write(p, lines):
    open(os.path.join(W,p),"w").write("\n".join(lines)+"\n")

# ---------------- NodeSnapshotRepository / NodeSnapshotFilterSql
nr = base(PER+"NodeSnapshotRepository.scala")
moved = rng(nr,205,311)
moved = sub(moved,"  private def filterWhereFragment(","  private[pipelines] def filterWhereFragment(")
moved = sub(moved,"  private def orderByFragment(","  private[pipelines] def orderByFragment(")
fs = ["package com.helio.infrastructure.persistence.pipelines","",
 "import slick.jdbc.PostgresProfile.api._",
 "import slick.jdbc.SQLActionBuilder","",
 "/** HEL-1027 / HEL-1188 -- pure SQL-fragment construction for `NodeSnapshotRepository`'s filtered and",
 " *  sorted reads: `ILIKE` term escaping, `ops[]` casts and comparisons, the `WHERE` tail and `ORDER BY`.",
 " *  Touches no `DbContext`; every fragment binds its values as parameters. The node-scoping predicate",
 " *  every read shares (`nodeFilterFragment`) stays on the repository. */",
 "private[pipelines] object NodeSnapshotFilterSql {",""] + moved + ["}"]
write(PER+"NodeSnapshotFilterSql.scala", fs)
new_nr = nr[:204] + nr[312:]   # drop 205..312 (builders + trailing blank)
i = new_nr.index("class NodeSnapshotRepository(ctx: DbContext)(implicit ec: ExecutionContext) {")
new_nr[i+1:i+1] = ["  import NodeSnapshotFilterSql.{filterWhereFragment, orderByFragment}",""]
write(PER+"NodeSnapshotRepository.scala", new_nr)

# ---------------- OutputService
os_ = base(SVC+"OutputService.scala")
rows_blk = rng(os_,336,387); fc = rng(os_,389,401); dv = rng(os_,403,427); mat = rng(os_,429,449)
rr = rows_blk+[""]+fc+[""]+dv+[""]+mat
# positional-word edits (D5)
rr = sub(rr,"(same ACL surface as `GET\n   *  /api/outputs/:id` above)","(same ACL surface as `GET\n   *  /api/outputs/:id`)") if False else rr
t="\n".join(rr)
edits=[("   *  /api/outputs/:id` above) -- an Output's rows","   *  /api/outputs/:id`) -- an Output's rows"),
       ("mirroring every other nullable dependency in this\n   *  service.","mirroring every other nullable dependency in\n   *  `OutputService`."),
       ("mirroring every other such fixture in this file)\n   *  degrades to an empty contract","mirroring every other such fixture in `OutputService.scala`)\n   *  degrades to an empty contract")]
for o,n in edits:
    assert t.count(o)==1,o
    t=t.replace(o,n)
rr=t.split("\n")
rr_head = ["package com.helio.services.pipelines","",
 "import com.helio.services.ServiceError",
 "import com.helio.api.protocols.pipelines.OutputRowsResponse",
 "import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, Page, PagedResult}",
 "import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRunRepository}",
 "import spray.json.{JsObject, JsValue}","",
 "import scala.concurrent.{ExecutionContext, Future}","",
 "/** The materialized-row read surface of `OutputService` (`rows`, `filterCapabilities`, `distinctValues`):",
 " *  reads an Output's own node snapshot behind the same sharing-aware `outputRepo.findById` ACL gate.",
 " *  Collaborators keep `OutputService`'s nullable-optional wiring (null degrades, never an NPE). */",
 "private[pipelines] final class OutputRowReads(",
 "    outputRepo:       OutputRepository,",
 "    nodeSnapshotRepo: NodeSnapshotRepository,",
 "    pipelineRunRepo:  PipelineRunRepository",
 ")(implicit ec: ExecutionContext) {",""]
write(SVC+"OutputRowReads.scala", rr_head+rr+["}"])

# root resolution
rootm = rng(os_,170,191)+[""]+rng(os_,193,216)
rootm = sub(rootm,"  private def requireUnambiguousRootWhenNeither(","  private[pipelines] def requireUnambiguousRootWhenNeither(")
rootm = sub(rootm,"  private def resolveExplicitRootId(","  private[pipelines] def resolveExplicitRootId(")
rootm = sub(rootm,"no caller of THIS class exercises","no caller of `OutputService` exercises")
rootm = sub(rootm,"three-caller enumeration this class is one of","three-caller enumeration `OutputService` is one of")
write(SVC+"OutputRootResolution.scala", ["package com.helio.services.pipelines","",
 "import com.helio.services.ServiceError",
 "import com.helio.api.protocols.pipelines.CreateOutputRequest",
 "import com.helio.domain.model.{PipelineId, PipelineRootId}",
 "import com.helio.infrastructure.persistence.pipelines.PipelineRootRepository","",
 "import scala.concurrent.{ExecutionContext, Future}","",
 "/** Create-time root anchoring for `OutputService.create`: which pipeline root a new Output binds to.",
 " *  `pipelineRootRepo == null` (a fixture that doesn't wire one) skips both checks. */",
 "private[pipelines] final class OutputRootResolution(pipelineRootRepo: PipelineRootRepository)(implicit ec: ExecutionContext) {",""]+rootm+["}"])

# config validation
cv = base(SVC+"OutputConfigValidation.scala")
valm = rng(os_,457,477)+[""]+rng(os_,479,498)+[""]+rng(os_,500,502)
# insert before object's closing brace (line 148)
assert cv[147]=="}"
cv2 = cv[:147]+[""]+valm+cv[147:]
# header amendment: after line 8
assert cv[6].startswith(" *  set, plus the")
cv2[7:7]=[" *  Also holds the whole-config write validators moved from `OutputService`, which judge the MERGED config's",
          " *  `fieldMapping`/`compare`/`historyPayloads` outside the tolerance rule below."]
# imports
cv2 = sub(cv2,"import com.helio.domain.model.OutputKind\n","import com.helio.domain.history.{OutputCompare, PayloadOptIn}\nimport com.helio.domain.model.OutputKind\nimport com.helio.domain.panels.OutputBindingSpec\nimport com.helio.services.ServiceError\n")
write(SVC+"OutputConfigValidation.scala", cv2)

# OutputService result
head = rng(os_,1,59)   # through constructor + blank? verify below
body_pre = rng(os_,60,169)  # log .. create end
rest1 = rng(os_,218,335)    # findById .. assertionStatus (+ trailing blank)
comp = ["object OutputService {","",
 "  /** Default `backfillObserver` (HEL-1356): does nothing. */",
 "  val NoBackfillObserver: (OutputId, Future[Unit]) => Unit = (_, _) => ()","",
 "  /** Forwarder to [[OutputConfigValidation.validateFieldMapping]]. */",
 "  def validateFieldMapping(kind: OutputKind, config: JsObject): Either[ServiceError, Unit] =",
 "    OutputConfigValidation.validateFieldMapping(kind, config)","",
 "  /** Forwarder to [[OutputConfigValidation.validateConfig]]. */",
 "  def validateConfig(",
 "      kind:    OutputKind,",
 "      written: JsObject,",
 "      stored:  JsObject,",
 "      policy:  OutputConfigWritePolicy = OutputConfigWritePolicy.ValidateWrite",
 "  ): Either[ServiceError, Unit] =",
 "    OutputConfigValidation.validateConfig(kind, written, stored, policy)","",
 "  /** Forwarder to [[OutputConfigValidation.mergeConfig]] (shared with `PatchSetPreviewProjection`). */",
 "  def mergeConfig(existing: JsObject, patch: JsObject): JsObject =",
 "    OutputConfigValidation.mergeConfig(existing, patch)",
 "}"]
deleg = [
 "  /** `GET /api/outputs/:id/rows`; implemented by [[OutputRowReads]]. */",
 "  def rows(",
 "      id: OutputId,",
 "      page: Page,",
 "      user: AuthenticatedUser,",
 "      sort: Option[OutputRowsQuery.SortParam] = None,",
 "      filter: Option[OutputRowsQuery.FilterParam] = None",
 "  ): Future[Either[ServiceError, OutputRowsResponse]] =",
 "    rowReads.rows(id, page, user, sort, filter)","",
 "  /** `GET /api/outputs/:id/filter-capabilities`; implemented by [[OutputRowReads]]. */",
 "  def filterCapabilities(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, OutputFilterCapability.FilterCapabilityContract]] =",
 "    rowReads.filterCapabilities(id, user)","",
 "  /** `GET /api/outputs/:id/distinct-values?column=`; implemented by [[OutputRowReads]]. */",
 "  def distinctValues(id: OutputId, user: AuthenticatedUser, column: String): Future[Either[ServiceError, Vector[(String, Int)]]] =",
 "    rowReads.distinctValues(id, user, column)",
 "}"]
out = head+body_pre
# wiring after log
li = out.index("  private val log = LoggerFactory.getLogger(getClass)")
out[li+1:li+1] = ["","  private val rowReads        = new OutputRowReads(outputRepo, nodeSnapshotRepo, pipelineRunRepo)",
                  "  private val rootResolution = new OutputRootResolution(pipelineRootRepo)",
                  "  import rootResolution.{requireUnambiguousRootWhenNeither, resolveExplicitRootId}"]
out += rest1[:]  # starts with findById doc? ensure blank separation
write(SVC+"OutputService.scala", out+deleg+[""]+comp)
print("ok")
