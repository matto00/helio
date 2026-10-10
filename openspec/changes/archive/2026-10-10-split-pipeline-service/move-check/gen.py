#!/usr/bin/env python3
"""Generator (HEL-1463): builds the ten PipelineService* files from the BASE text by member-block moves, and
emits spec.json for check.py. usage: gen.py <outdir> <specout> [--report]
Everything that is not a verbatim base member block is an explicit scaffold line tagged with its D3 category."""
import json, os, re, subprocess, sys, collections
BASE = "1b765f59d"
W = os.environ.get("W", "/home/matt/Development/helio/.claude/worktrees/task/split-pipeline-service/hel-1463")
BASEPATH = "backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala"
base = subprocess.check_output(["git", "-C", W, "show", f"{BASE}:{BASEPATH}"], text=True).split("\n")
if base[-1] == "": base = base[:-1]
L = lambda n: base[n - 1]
outdir, specout = sys.argv[1], sys.argv[2]
report = "--report" in sys.argv

def iscomment(s): return re.match(r"^\s*(/\*\*|\*|//)", s) is not None

# ---- destination table: member name -> (decl line, destination) -------------------------------------------
ENTRY = "PipelineService"
SUP, CW, CT, RW, AR, NR, PA, SC, SW = ("PipelineServiceSupport", "PipelineCreateWrites", "PipelineCreateTransaction",
    "PipelineRootWrites", "PipelineAnalyzeReads", "PipelineNodeReads", "PipelineProposalAnalyze", "PipelineStepCreate", "PipelineStepWrites")
members = [  # (name, decl line, dest, delegate-call-or-None)
 ("require", 84, ENTRY, None), ("log", 86, ENTRY, None), ("costInputGathering", 91, ENTRY, None),
 ("audit", 93, SUP, None), ("stepResponseWithRoot", 110, SUP, None),
 ("listSummaries", 118, ENTRY, None), ("findSummaryById", 122, ENTRY, None),
 ("create", 152, CW, "createWrites.create(req, user)"),
 ("checkedCreate", 173, CW, None), ("checkRootsReadOnly", 194, CW, None), ("rootShapeProblem", 217, CW, None),
 ("createWithInlineRoots", 241, CW, None), ("createRootSources", 275, CW, None), ("lookupOwnedRoots", 291, CW, None),
 ("compensatingInlineSources", 309, CW, None), ("deleteInlineSources", 319, CW, None),
 ("stepAddress", 329, SUP, None), ("outputAddress", 330, SUP, None),
 ("createTransactional", 346, CT, None), ("validateStepCrossOwnerRefs", 410, CT, None),
 ("upsertTargetProblems", 445, AR, None), ("checkOwnedSource", 452, CT, None), ("rewriteLaneClientId", 469, CT, None),
 ("buildStepsAction", 494, CT, None), ("buildOutputsAction", 545, CT, None),
 ("validateOutputFieldMapping", 608, SUP, None),
 ("updateName", 633, ENTRY, None), ("delete", 651, ENTRY, None),
 ("resolveOneRootSourceId", 672, RW, None), ("resolveInlineRootSourceId", 693, RW, None),
 ("addRoot", 744, RW, "rootWrites.addRoot(pipelineId, req, user)"),
 ("removeRoot", 787, RW, "rootWrites.removeRoot(pipelineId, rootId, user)"),
 ("analyze", 854, AR, "analyzeReads.analyze(pipelineId, user)"),
 ("toWarningResponse", 992, SUP, None), ("toCostVerdictResponse", 998, AR, None),
 ("resolveSecondarySourceSchemas", 1022, SUP, None),
 ("analyzeConcise", 1037, AR, "analyzeReads.analyzeConcise(pipelineId, user)"),
 ("laneTree", 1092, NR, "nodeReads.laneTree(pipelineId, user)"),
 ("laneTreeGiven", 1118, NR, "nodeReads.laneTreeGiven(pipelineId, allSteps, outputsAlreadyFetchedForThisPipeline)"),
 ("listRootDataSourceIdsInternalBatch", 1151, NR, "nodeReads.listRootDataSourceIdsInternalBatch(pipelineIds)"),
 ("rootIdsOfBatch", 1158, NR, "nodeReads.rootIdsOfBatch(pipelineIds)"),
 ("listByPipelineInternalBatch", 1166, NR, "nodeReads.listByPipelineInternalBatch(pipelineIds)"),
 ("laneTreeFromRoots", 1171, NR, "nodeReads.laneTreeFromRoots(allSteps, outputsAlreadyFetchedForThisPipeline, rootDataSourceIds, rootIdOfStep)"),
 ("capabilitiesAtNode", 1200, NR, "nodeReads.capabilitiesAtNode(pipelineId, stepId, user)"),
 ("validateExpression", 1223, NR, "nodeReads.validateExpression(pipelineId, stepId, expression, user)"),
 ("projectedSchemaAtNode", 1246, NR, None), ("buildNodeCapabilities", 1290, NR, None),
 ("parseBaselineSchema", 1311, AR, None), ("toDriftResponse", 1321, AR, None),
 ("analyzeProposal", 1356, PA, "proposalAnalyze.analyzeProposal(proposal, user)"),
 ("resolveProposalOutputAnalyses", 1418, PA, None), ("resolveOneProposalOutputAnalysis", 1433, PA, None),
 ("resolveProposalOutputNodeSchema", 1466, PA, None), ("resolveAllProposalRootSchemas", 1503, PA, None),
 ("resolveOneProposalRootSchema", 1519, PA, None), ("validateStepKinds", 1544, PA, None),
 ("resolveInlineSourceSchema", 1560, PA, None), ("toSchemaFields", 1661, PA, None),
 ("toAnalyzeStepResponse", 1667, SUP, None),
 ("listSteps", 1740, ENTRY, None), ("addStep", 1765, ENTRY, None),
 ("addStepReporting", 1771, SC, "stepCreate.addStepReporting(pipelineId, req, user)"),
 ("upsertOwnershipCheckF", 1899, SUP, None), ("persistNewStep", 1921, SC, None),
 ("updateStep", 2088, SW, "stepWrites.updateStep(stepId, req, user)"),
 ("deleteStep", 2204, SW, "stepWrites.deleteStep(stepId, user)"),
 ("reorderSteps", 2249, SW, "stepWrites.reorderSteps(pipelineId, req, user)"),
 ("duplicateStep", 2294, SW, "stepWrites.duplicateStep(stepId, user)"),
 ("requireEditorAccess", 2356, ENTRY, None),
 ("toSummaryResponse", 2367, SUP, None), ("toFieldResponse", 2382, SUP, None),
 ("PipelineCreateValidationFailure", 2393, ENTRY, None),
]
# explicit blocks: (name, start, end, dest)
explicit = [("class-header", 35, 82, ENTRY), ("standalone-hasSourceUrl-comment", 988, 990, AR), ("companion-object", 2395, 2571, ENTRY)]
CLOSE = 2384  # class-closing brace (scaffold in the entry point)

starts = {}
for name, decl, dest, _ in members:
    s = decl
    while s - 1 >= 1 and iscomment(L(s - 1)): s -= 1
    starts[name] = s
for name, a, b, dest in explicit: starts[name] = a
allstarts = sorted(set(list(starts.values()) + [CLOSE]))
blocks = {}  # name -> dict(start,end,dest,decl)
for name, decl, dest, dele in members:
    s = starts[name]; nxt = min(x for x in allstarts if x > s); e = nxt - 1
    while L(e).strip() == "": e -= 1
    blocks[name] = dict(start=s, end=e, dest=dest, decl=decl, delegate=dele)
for name, a, b, dest in explicit:
    blocks[name] = dict(start=a, end=b, dest=dest, decl=a, delegate=None)
# the case-class block must stop before the companion: handled by next-start rule.

def strip_code(text):
    """comment-free, string-literal-free (keeping ${...} interpolations) text for identifier scans."""
    out = []
    for ln in text.split("\n"):
        if re.match(r"^\s*(/\*\*|\*|//)", ln): continue
        ln = re.sub(r"\s//.*$", "", ln)
        def blank(m):
            inner = m.group(0)
            return " ".join(re.findall(r"\$\{([^}]*)\}", inner)) + " "
        ln = re.sub(r'"(?:[^"\\]|\\.)*"', blank, ln)
        out.append(ln)
    return "\n".join(out)

def body_lines(b): return base[b["start"] - 1:b["end"]]
code = {n: strip_code("\n".join(body_lines(b))) for n, b in blocks.items()}
dest_code = collections.defaultdict(str)
for n, b in blocks.items():
    if n != "companion-object": dest_code[b["dest"]] += code[n] + "\n"
member_dest = {n: b["dest"] for n, b in blocks.items() if n in dict((m[0], 1) for m in members)}
decl_text = {n: L(b["decl"]) for n, b in blocks.items()}
def refs(text, name): return re.search(r"(?<![\w.])" + re.escape(name) + r"\b", text) is not None
# which `private` members are called from another destination (they need private[pipelines])
widen = set()
for n, b in blocks.items():
    if n not in member_dest: continue
    if b["dest"] != ENTRY and re.match(r"^  private (def|val) ", decl_text[n]):
        for d, txt in dest_code.items():
            if d != b["dest"] and refs(txt, n): widen.add(n)
widen.discard("requireEditorAccess")  # stays private in the entry point (C2); reached through a constructor parameter
# sibling references per destination: names (members of other destinations) used in the destination's own code
sib = collections.defaultdict(lambda: collections.defaultdict(set))
for d, txt in dest_code.items():
    for n in member_dest:
        if member_dest[n] != d and member_dest[n] != ENTRY and refs(txt, n): sib[d][member_dest[n]].add(n)
# entry-kept names called from moved code (should be none besides the function parameter)
entry_calls = collections.defaultdict(set)
for d, txt in dest_code.items():
    if d == ENTRY: continue
    for n in member_dest:
        if member_dest[n] == ENTRY and refs(txt, n): entry_calls[d].add(n)
if report:
    print("WIDEN:", sorted(widen))
    for d in sib:
        for k, v in sib[d].items(): print("SIB", d, "->", k, sorted(v))
    print("ENTRY-CALLS:", {k: sorted(v) for k, v in entry_calls.items()})
    sys.exit(0)

# ---- imports ---------------------------------------------------------------------------------------------
imp_lines = [L(i) for i in range(3, 34)]
def parse_imp(s):
    m = re.match(r"^import (.+)\.\{(.+)\}$", s)
    if m: return m.group(1), [x.strip() for x in m.group(2).split(",")], True
    m = re.match(r"^import (.+)\.(\w+)$", s)
    if m and not s.endswith("._"): return m.group(1), [m.group(2)], False
    return None
def imports_for(text, wild):
    outl = []
    for s in imp_lines:
        if s.strip() == "": continue
        p = parse_imp(s)
        if s in wild:
            outl.append(s); continue
        if p is None:
            if s in wild: outl.append(s)
            continue
        pre, names, grouped = p
        keep = [n for n in names if re.search(r"(?<![\w])" + re.escape(n.split(" => ")[-1]) + r"(?!\w)", text)]
        if not keep: continue
        outl.append(f"import {pre}.{{{', '.join(keep)}}}" if len(keep) > 1 else f"import {pre}.{keep[0]}")
    return outl
def wild_for(text):
    w = set()
    if re.search(r"\b(JsObject|JsValue|JsString|JsArray|compactPrint|parseJson|convertTo|toJson)\b", text): w.add("import spray.json._")
    if re.search(r"convertTo\[", text): w.add("import spray.json.DefaultJsonProtocol._"); w.add("import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat")
    if re.search(r"\bDBIO\b", text): w.add("import slick.jdbc.PostgresProfile.api._")
    return w

# ---- file construction -----------------------------------------------------------------------------------
CTOR = [  # (param name, declaration text) in the original constructor order
 ("pipelineRepo", "pipelineRepo: PipelineRepository"), ("pipelineStepRepo", "pipelineStepRepo: PipelineStepRepository"),
 ("dataSourceRepo", "dataSourceRepo: DataSourceRepository"), ("connector", "connector: RestApiConnectorDriver"),
 ("auditService", "auditService: AuditService"), ("outputRepo", "outputRepo: OutputRepository"),
 ("pipelineRootRepo", "pipelineRootRepo: PipelineRootRepository"), ("sourceService", "sourceService: SourceService"),
 ("dataSourceService", "dataSourceService: DataSourceService"), ("costInputGathering", "costInputGathering: PipelineCostInputGathering"),
]
SIBVAR = {SUP: ("support", "PipelineServiceSupport"), RW: ("rootWrites", "PipelineRootWrites"), CT: ("createTransaction", "PipelineCreateTransaction")}
REQ = "requireEditorAccess: (PipelineId, AuthenticatedUser) => Future[Either[ServiceError, Unit]]"
DOC = {
 SUP: "Shared helpers for the PipelineService collaborators: auditing, step-response assembly, wire-response mapping, schema",
 CW: "The create path of `PipelineService.create`: request-only root checks, inline-root creation with compensation.",
 CT: "The single-call transactional create (`createTransactional`) and the DBIO builders it composes.",
 RW: "Root add/remove (`addRoot`/`removeRoot`) and the shared root-source resolution `create` also uses.",
 AR: "Analyze reads: `analyze` and `analyzeConcise` and their wire-response mapping.",
 NR: "Per-node reads: the lane tree, node capabilities, expression validation and the `private[services]` batched lookups.",
 PA: "Dry-analyze of a not-yet-created `PipelineProposal` (`analyzeProposal`) and its source/Output resolution.",
 SC: "Step creation (`addStepReporting`) and its shared persist branch.",
 SW: "Step update/delete/reorder/duplicate.",
}
DOC2 = {SUP: " *  resolution and the upsert-target ownership check. Split out of `PipelineService` (HEL-1463). */"}
FILENAMES = {d: d + ".scala" for d in [SUP, CW, CT, RW, AR, NR, PA, SC, SW]}; FILENAMES[ENTRY] = "PipelineService.scala"
needs_editor = {RW, SC, SW}
LOGGERS = {d for d in dest_code if d != ENTRY and refs(dest_code[d], "log")}

spec = collections.OrderedDict(); outputs = {}; CTORNAMES = {}
def build_class(d):
    items = []  # spec items
    outl = []   # output lines
    def sc(text, cat):
        items.append(dict(scaffold=text, cat=cat)); outl.append(text)
    def blank():
        if outl and outl[-1] != "": outl.append("")
    def member(name):
        b = blocks[name]
        sub = {}
        lines = body_lines(b)
        if name in widen:
            i = b["decl"] - b["start"]
            new = lines[i].replace("private ", "private[pipelines] ", 1)
            assert new != lines[i]; lines[i] = new; sub[str(b["decl"])] = new
        items.append(dict(member=name, range=[b["start"], b["end"]], subst=sub)); outl.extend(lines)
    own = sorted([n for n in blocks if blocks[n]["dest"] == d and n in member_dest], key=lambda n: blocks[n]["start"])
    own_all = sorted([n for n in blocks if blocks[n]["dest"] == d], key=lambda n: blocks[n]["start"])
    text = dest_code[d]
    # parameters actually referenced by the moved bodies
    params = [(n, t) for n, t in CTOR if n != "costInputGathering" and refs(text, n)]
    if d == AR: params.append(("costInputGathering", dict(CTOR)["costInputGathering"]))
    sibs = [k for k in (SUP, RW, CT) if k != d and k in sib[d]]
    fullbody = "\n".join(body_lines(blocks[n])[i] for n in own_all for i in range(len(body_lines(blocks[n]))))
    imps = imports_for(strip_code(fullbody) + "\n" + "\n".join(t for _, t in params) + "\nExecutionContext Future Either" +
                       ("\nPipelineId AuthenticatedUser ServiceError" if d in needs_editor else "") + ("\nPipelineStepKind" if False else "") +
                       ("\nLoggerFactory" if d in LOGGERS else "") +
                       "\n" + "\n".join(SIBVAR[k][1] for k in sibs) + ("\nPipelineServiceSupport" if d != SUP else ""),
                       wild_for(strip_code(fullbody)))
    sc("package com.helio.services.pipelines", "package"); blank()
    first = True
    for s in imps:
        if s.startswith("import scala.") or s.startswith("import java."):
            if first: blank(); first = False
        sc(s, "imports")
    blank()
    sc(f"/** {DOC[d]}" + ("" if d == SUP else " Split out of `PipelineService` (HEL-1463). */"), "class-doc")
    if d == SUP: sc(DOC2[d], "class-doc")
    sc(f"private[pipelines] final class {d}(", "class-scaffold")
    plist = [t for _, t in params]
    for k in sibs: plist.append(f"{SIBVAR[k][0]}: {SIBVAR[k][1]}")
    if d != SUP and d not in sibs and True: pass
    if d != SUP and SUP not in sibs: plist.append(f"support: {SIBVAR[SUP][1]}")
    if d in needs_editor: plist.append(REQ)
    # support must come before the other siblings: reorder
    plist = [p for p in plist if not p.startswith("support:")] ; 
    pre = [t for _, t in params]
    plist = pre + ([f"support: {SIBVAR[SUP][1]}"] if d != SUP else []) + [f"{SIBVAR[k][0]}: {SIBVAR[k][1]}" for k in sibs if k != SUP] + ([REQ] if d in needs_editor else [])
    CTORNAMES[d] = [p.split(":")[0] for p in plist]
    for i, p in enumerate(plist): sc("    " + p + ("," if i < len(plist) - 1 else ""), "class-scaffold")
    sc(")(implicit ec: ExecutionContext) {", "class-scaffold"); blank()
    if d in LOGGERS: sc("  private val log = LoggerFactory.getLogger(classOf[PipelineService])", "logger"); blank()
    # member imports from siblings
    allsib = []
    if d != SUP and SUP in sib[d]: allsib.append((SUP, "support"))
    for k in (RW, CT):
        if k != d and k in sib[d]: allsib.append((k, SIBVAR[k][0]))
    for k, var in allsib:
        names = sorted(sib[d][k], key=lambda n: blocks[n]["start"])
        sc(f"  import {var}.{{{', '.join(names)}}}" if len(names) > 1 else f"  import {var}.{names[0]}", "collaborator-import")
    if allsib: blank()
    for n in own_all:
        member(n) if True else None; blank()
    if outl[-1] == "": outl.pop()
    sc("}", "class-scaffold")
    return items, outl

def build_entry():
    items = []; outl = []
    def sc(text, cat): items.append(dict(scaffold=text, cat=cat)); outl.append(text)
    def blank():
        if outl and outl[-1] != "": outl.append("")
    def member(name):
        b = blocks[name]; items.append(dict(member=name, range=[b["start"], b["end"]], subst={})); outl.extend(body_lines(b))
    # entry code = everything the entry keeps + delegation text
    keep = [n for n in blocks if blocks[n]["dest"] == ENTRY]
    kept_code = "\n".join(strip_code("\n".join(body_lines(blocks[n]))) for n in keep)
    dele = [n for n in blocks if blocks[n]["delegate"]]
    sigs = {}
    for n in dele:
        b = blocks[n]; i = b["decl"]; sig = []
        while True:
            sig.append(L(i))
            if re.search(r"=( \{)?$", L(i)) and not L(i).rstrip().endswith("=>"): break
            i += 1
        # a multi-line signature ends at the first line ending in `=`/`= {`
        sig[-1] = re.sub(r" \{$", "", sig[-1])
        sigs[n] = sig
    deleg_code = "\n".join("\n".join(s) for s in sigs.values())
    wiring_text = "PipelineServiceSupport PipelineAnalyzeReads PipelineNodeReads PipelineProposalAnalyze PipelineRootWrites PipelineCreateTransaction PipelineCreateWrites PipelineStepCreate PipelineStepWrites"
    imps = imports_for(kept_code + "\n" + deleg_code + "\n" + strip_code(L(1)), wild_for(kept_code + deleg_code))
    sc("package com.helio.services.pipelines", "package"); blank()
    first = True
    for s in imps:
        if (s.startswith("import scala.") or s.startswith("import java.")) and first: blank(); first = False
        sc(s, "imports")
    blank()
    order = sorted([n for n in blocks if blocks[n]["dest"] == ENTRY or blocks[n]["delegate"]], key=lambda n: blocks[n]["start"])
    for n in order:
        b = blocks[n]
        if n == "class-header": member(n); blank(); continue
        if n == "costInputGathering":
            member(n); blank()
            wiring()  # noqa
            continue
        if n == "PipelineCreateValidationFailure":
            sc("}", "class-scaffold"); blank()
        if b["delegate"]:
            for s in sigs[n]: sc(s, "delegation")
            sc("    " + b["delegate"], "delegation"); blank(); continue
        member(n); blank()
    if outl[-1] == "": outl.pop()
    return items, outl, sc, blank

def wiring():  # placeholder, replaced below
    pass

def build_entry_full():
    items = []; outl = []
    def sc(text, cat): items.append(dict(scaffold=text, cat=cat)); outl.append(text)
    def blank():
        if outl and outl[-1] != "": outl.append("")
    def member(name):
        b = blocks[name]; items.append(dict(member=name, range=[b["start"], b["end"]], subst={})); outl.extend(body_lines(b))
    keep = [n for n in blocks if blocks[n]["dest"] == ENTRY]
    kept_code = "\n".join(strip_code("\n".join(body_lines(blocks[n]))) for n in keep)
    dele = [n for n in blocks if blocks[n]["delegate"]]
    sigs = {}
    for n in dele:
        b = blocks[n]; i = b["decl"]; sig = []
        while True:
            sig.append(L(i))
            if L(i).rstrip().endswith("=") or L(i).rstrip().endswith("= {"): break
            i += 1
        sig[-1] = re.sub(r" \{$", "", sig[-1])
        sigs[n] = sig
    deleg_code = "\n".join("\n".join(s) for s in sigs.values())
    imps = imports_for(kept_code + "\n" + deleg_code, wild_for(kept_code + deleg_code))
    sc("package com.helio.services.pipelines", "package"); blank()
    first = True
    for s in imps:
        if (s.startswith("import scala.") or s.startswith("import java.")) and first: blank(); first = False
        sc(s, "imports")
    blank()
    order = sorted([n for n in blocks if blocks[n]["dest"] == ENTRY or blocks[n]["delegate"]], key=lambda n: blocks[n]["start"])
    VARS = [("support", SUP), ("analyzeReads", AR), ("nodeReads", NR), ("proposalAnalyze", PA), ("rootWrites", RW),
            ("createTransaction", CT), ("createWrites", CW), ("stepCreate", SC), ("stepWrites", SW)]  # D4 order
    W_ = [(v, c, ", ".join(CTORNAMES[c])) for v, c in VARS]
    for n in order:
        b = blocks[n]
        if n == "PipelineCreateValidationFailure":
            sc("}", "class-scaffold"); blank()
        if n == "class-header": member(n); blank(); continue
        if b["delegate"]:
            for s in sigs[n]: sc(s, "delegation")
            sc("    " + b["delegate"], "delegation"); blank(); continue
        member(n); blank()
        if n == "costInputGathering":
            for var, cls, args in W_: sc(f"  private val {var} = new {cls}({args})", "wiring")
            blank()
            sc("  import support.{audit, toSummaryResponse}", "collaborator-import"); blank()
    if outl[-1] == "": outl.pop()
    return items, outl

def emit(d, items, outl):
    spec[FILENAMES[d]] = items; outputs[FILENAMES[d]] = "\n".join(outl) + "\n"

for d in [SUP, CW, CT, RW, AR, NR, PA, SC, SW]:
    it, ol = build_class(d); emit(d, it, ol)
it, ol = build_entry_full(); emit(ENTRY, it, ol)
os.makedirs(outdir, exist_ok=True)
for fn, txt in outputs.items(): open(os.path.join(outdir, fn), "w").write(txt)
json.dump(spec, open(specout, "w"), indent=1)
# summary
for fn, txt in outputs.items(): print(f"{fn}: {len(txt.splitlines())} lines")
json.dump({n: dict(start=b["start"], end=b["end"], dest=b["dest"], widen=(n in widen)) for n, b in blocks.items()}, open(specout + ".inventory.json", "w"), indent=1)
