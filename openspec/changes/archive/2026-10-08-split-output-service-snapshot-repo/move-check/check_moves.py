#!/usr/bin/env python3
"""HEL-1187 positional move checker.
usage: check_moves.py <root-with-new-files> <repo-for-git-show> [--quiet]
Each resulting file is declared as an ordered LAYOUT of items:
  S(file, a, b, subs)  base lines a..b of `git show 24f6de4cf:<file>` (1-based, inclusive) with exact-text substitutions
  L(category, text...) literal allow-listed non-move lines
The layout is expanded to expected text and compared to the actual file line-by-line:
  a mismatch = either a moved body that is not byte-identical (forward) or a line no member/allow-list claims (reverse).
Also: the base inventory partitions every original line exactly once, and every inventoried span is used by exactly its destination."""
import subprocess, sys, os, difflib
ROOT, REPO = sys.argv[1], sys.argv[2]; QUIET = "--quiet" in sys.argv
BASE = "24f6de4cf"
SVC = "backend/src/main/scala/com/helio/services/pipelines/"
PER = "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/"
OS, CV, NR = SVC+"OutputService.scala", SVC+"OutputConfigValidation.scala", PER+"NodeSnapshotRepository.scala"
RR, RT, FS = SVC+"OutputRowReads.scala", SVC+"OutputRootResolution.scala", PER+"NodeSnapshotFilterSql.scala"
_cache = {}
def base(p):
    if p not in _cache:
        _cache[p] = subprocess.run(["git","-C",REPO,"show",f"{BASE}:{p}"],capture_output=True,text=True,check=True).stdout.split("\n")[:-1]
    return _cache[p]
def S(f,a,b,subs=(),drop=()): return ("S",f,a,b,tuple(subs),tuple(drop))
def L(cat,*lines): return ("L",cat,lines)

# ---- inventory: every base line -> exactly one destination
INV = {
 OS: [(1,59,OS),(60,60,OS),(61,169,OS),(170,216,RT),(217,217,"separator-dropped"),(218,335,OS),
      (336,388,RR),(389,402,RR),(403,428,RR),(429,449,RR),(450,456,OS),(457,478,CV),(479,499,CV),(500,502,CV),(503,503,OS)],
 NR: [(1,87,NR),(88,204,NR),(205,311,FS),(312,312,"separator-dropped"),(313,458,NR)],
 CV: [(1,2,CV),(3,3,CV),(4,7,CV),(8,147,CV),(148,157,CV)],
}
IMPORT_DROPS = ["import com.helio.domain.history.{OutputCompare, PayloadOptIn}","import com.helio.domain.panels.OutputBindingSpec"]
LAYOUT = {
 OS: [
  S(OS,1,59,subs=[("import spray.json.{JsObject, JsString, JsValue}","import spray.json.{JsObject, JsValue}"),
                  ("PipelineId, PipelineRootId, PipelineRunId","PipelineId, PipelineRunId")],drop=IMPORT_DROPS),
  S(OS,60,60),
  L("D5a wiring + D2 member import","","  private val rowReads       = new OutputRowReads(outputRepo, nodeSnapshotRepo, pipelineRunRepo)",
    "  private val rootResolution = new OutputRootResolution(pipelineRootRepo)",
    "  import rootResolution.{requireUnambiguousRootWhenNeither, resolveExplicitRootId}"),
  S(OS,61,169), S(OS,218,335),
  L("D1 delegation doc","  /** `GET /api/outputs/:id/rows`; implemented by [[OutputRowReads]]. */"),
  S(OS,349,355),   # rows signature, byte-identical incl. defaults
  L("D1 delegation body","    rowReads.rows(id, page, user, sort, filter)","","  /** `GET /api/outputs/:id/filter-capabilities`; implemented by [[OutputRowReads]]. */"),
  S(OS,394,394),
  L("D1 delegation body","    rowReads.filterCapabilities(id, user)","","  /** `GET /api/outputs/:id/distinct-values?column=`; implemented by [[OutputRowReads]]. */"),
  S(OS,408,408),
  L("D1 delegation body","    rowReads.distinctValues(id, user, column)"),
  S(OS,450,456),
  L("D3 forwarder doc+sig","  /** Forwarder to [[OutputConfigValidation.validateFieldMapping]]. */",
    "  def validateFieldMapping(kind: OutputKind, config: JsObject): Either[ServiceError, Unit] =",
    "    OutputConfigValidation.validateFieldMapping(kind, config)","",
    "  /** Forwarder to [[OutputConfigValidation.validateConfig]]. */","  def validateConfig("),
  S(OS,484,487),   # kind/written/stored/policy-with-default params byte-identical
  L("D3 forwarder body","  ): Either[ServiceError, Unit] =","    OutputConfigValidation.validateConfig(kind, written, stored, policy)","",
    "  /** Forwarder to [[OutputConfigValidation.mergeConfig]] (shared with `PatchSetPreviewProjection`). */",
    "  def mergeConfig(existing: JsObject, patch: JsObject): JsObject =","    OutputConfigValidation.mergeConfig(existing, patch)"),
  S(OS,503,503),
 ],
 RR: [
  L("new-file scaffolding (package/imports/class doc/ctor)","package com.helio.services.pipelines","",
    "import com.helio.services.ServiceError","import com.helio.api.protocols.pipelines.OutputRowsResponse",
    "import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, Page, PagedResult}",
    "import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRunRepository}",
    "import spray.json.{JsObject, JsValue}","","import scala.concurrent.{ExecutionContext, Future}","",
    "/** The materialized-row read surface of `OutputService` (`rows`, `filterCapabilities`, `distinctValues`):",
    " *  reads an Output's own node snapshot behind the same sharing-aware `outputRepo.findById` ACL gate.",
    " *  Collaborators keep `OutputService`'s nullable-optional wiring (null degrades, never an NPE). */",
    "private[pipelines] final class OutputRowReads(","    outputRepo:       OutputRepository,",
    "    nodeSnapshotRepo: NodeSnapshotRepository,","    pipelineRunRepo:  PipelineRunRepository",
    ")(implicit ec: ExecutionContext) {",""),
  S(OS,336,388,subs=[("   *  /api/outputs/:id` above) -- an Output's rows","   *  /api/outputs/:id`) -- an Output's rows"),
                     ("mirroring every other nullable dependency in this\n   *  service.","mirroring every other nullable dependency in\n   *  `OutputService`.")]),
  S(OS,389,402,subs=[("mirroring every other such fixture in this file)\n   *  degrades","mirroring every other such fixture in `OutputService.scala`)\n   *  degrades")]),
  S(OS,403,428), S(OS,429,449),
  L("new-file scaffolding","}"),
 ],
 RT: [
  L("new-file scaffolding (package/imports/class doc/ctor)","package com.helio.services.pipelines","",
    "import com.helio.services.ServiceError","import com.helio.api.protocols.pipelines.CreateOutputRequest",
    "import com.helio.domain.model.{PipelineId, PipelineRootId}",
    "import com.helio.infrastructure.persistence.pipelines.PipelineRootRepository","",
    "import scala.concurrent.{ExecutionContext, Future}","",
    "/** Create-time root anchoring for `OutputService.create`: which pipeline root a new Output binds to.",
    " *  `pipelineRootRepo == null` (a fixture that doesn't wire one) skips the ambiguity check and rejects an explicit `rootId` with 400. */",
    "private[pipelines] final class OutputRootResolution(pipelineRootRepo: PipelineRootRepository)(implicit ec: ExecutionContext) {",""),
  S(OS,170,216,subs=[("  private def requireUnambiguousRootWhenNeither(","  private[pipelines] def requireUnambiguousRootWhenNeither("),
                     ("  private def resolveExplicitRootId(","  private[pipelines] def resolveExplicitRootId("),
                     ("no caller of THIS class exercises","no caller of `OutputService` exercises"),
                     ("three-caller enumeration this class is one of","three-caller enumeration `OutputService` is one of")]),
  L("new-file scaffolding","}"),
 ],
 CV: [
  S(CV,1,2),
  L("imports (D3 receiving file)","import com.helio.domain.history.{OutputCompare, PayloadOptIn}"),
  S(CV,3,3),
  L("imports (D3 receiving file)","import com.helio.domain.panels.OutputBindingSpec","import com.helio.services.ServiceError"),
  S(CV,4,7),
  L("D3 header amendment (2 added lines after base line 7; no base line edited)",
    " *  Also holds the whole-config write validators moved from `OutputService`, which judge the MERGED config's",
    " *  `fieldMapping`/`compare`/`historyPayloads` outside the tolerance rule below."),
  S(CV,8,147),
  L("separator before moved members",""),
  S(OS,457,478), S(OS,479,499), S(OS,500,502),
  S(CV,148,157),
 ],
 NR: [
  S(NR,1,87),
  L("D4 member import","  import NodeSnapshotFilterSql.{filterWhereFragment, orderByFragment}",""),
  S(NR,88,204), S(NR,313,458),
 ],
 FS: [
  L("new-file scaffolding (package/imports/object doc)","package com.helio.infrastructure.persistence.pipelines","",
    "import slick.jdbc.PostgresProfile.api._","import slick.jdbc.SQLActionBuilder","",
    "/** HEL-1027 / HEL-1188 -- pure SQL-fragment construction for `NodeSnapshotRepository`'s filtered and",
    " *  sorted reads: `ILIKE` term escaping, `ops[]` casts and comparisons, the `WHERE` tail and `ORDER BY`.",
    " *  Touches no `DbContext`; every fragment binds its values as parameters. The node-scoping predicate",
    " *  every read shares (`nodeFilterFragment`) stays on the repository. */",
    "private[pipelines] object NodeSnapshotFilterSql {",""),
  S(NR,205,311,subs=[("  private def filterWhereFragment(","  private[pipelines] def filterWhereFragment("),
                     ("  private def orderByFragment(","  private[pipelines] def orderByFragment(")]),
  L("new-file scaffolding","}"),
 ],
}
def expand(items):
    out=[]; tags=[]   # (line, tag)
    for it in items:
        if it[0]=="S":
            _,f,a,b,subs,drop=it
            txt=base(f)[a-1:b]
            if drop:
                for d in drop:
                    assert txt.count(d)==1,("drop not found",d); txt.remove(d)
            t="\n".join(txt)
            for o,n in subs:
                assert t.count(o)==1,("sub not found exactly once",o,t.count(o)); t=t.replace(o,n)
            seg=t.split("\n"); out+=seg; tags+=[f"base {os.path.basename(f)}:{a}-{b}"]*len(seg)
        else:
            out+=list(it[2]); tags+=[f"ALLOW[{it[1]}]"]*len(it[2])
    return out,tags
rc=0; report=[]
# inventory partition
for f,spans in INV.items():
    n=len(base(f)); cov=[0]*(n+1)
    for a,b,d in spans:
        for i in range(a,b+1): cov[i]+=1
    bad=[i for i in range(1,n+1) if cov[i]!=1]
    report.append(f"inventory {os.path.basename(f)}: {n} base lines, spans cover each exactly once: {'OK' if not bad else 'FAIL '+str(bad[:10])}")
    if bad: rc=1
# layout usage matches inventory destinations
used={}
for dest,items in LAYOUT.items():
    for it in items:
        if it[0]=="S": used.setdefault((it[1],it[2],it[3]),[]).append(dest)
for f,spans in INV.items():
    for a,b,d in spans:
        if d=="separator-dropped": continue
        # a span is "claimed" if the union of layout S-items inside it with dest d covers all of its lines
        cov=set()
        for (ff,aa,bb),ds in used.items():
            if ff==f and d in ds:
                for i in range(max(a,aa),min(b,bb)+1): cov.add(i)
        miss=[i for i in range(a,b+1) if i not in cov]
        if miss: report.append(f"FAIL inventory span {os.path.basename(f)}:{a}-{b} -> {os.path.basename(d)} not fully claimed by that file's layout: {miss[:5]}"); rc=1
# compare every resulting file
for dest,items in LAYOUT.items():
    exp,tags=expand(items)
    actual=open(os.path.join(ROOT,dest)).read().split("\n")
    if actual and actual[-1]=="": actual=actual[:-1]
    ok = exp==actual
    report.append(f"{os.path.basename(dest)}: {len(actual)} lines, {sum(1 for t in tags if t.startswith('ALLOW'))} allow-listed non-move lines, "
                  f"{sum(1 for t in tags if t.startswith('base'))} base-claimed lines -> {'OK' if ok else 'FAIL'}")
    if not ok:
        rc=1
        sm=difflib.SequenceMatcher(None,exp,actual,autojunk=False)
        for tag,i1,i2,j1,j2 in sm.get_opcodes():
            if tag!="equal":
                report.append(f"   {tag}: expected[{i1}:{i2}] ({tags[i1] if i1<len(tags) else 'EOF'}) vs actual[{j1+1}:{j2}]")
                for l in exp[i1:i2][:3]: report.append("     - "+l)
                for l in actual[j1:j2][:3]: report.append("     + "+l)
print("\n".join(report)); 
if not QUIET and rc==0:
    print("\nAllow-listed non-move lines and substitutions by category:")
    for dest,items in LAYOUT.items():
        for it in items:
            if it[0]=="L": print(f"  {os.path.basename(dest)} [{it[1]}]: {len(it[2])} line(s)")
            elif it[4] or it[5]:
                for o,n in it[4]: print(f"  {os.path.basename(dest)} [positional/visibility sub]: {o!r} -> {n!r}")
                for d in it[5]: print(f"  {os.path.basename(dest)} [unused import removed]: {d}")
print("RESULT:", "PASS" if rc==0 else "FAIL"); sys.exit(rc)
