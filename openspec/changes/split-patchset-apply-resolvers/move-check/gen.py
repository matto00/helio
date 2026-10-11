#!/usr/bin/env python3
"""Generator (HEL-1479): builds the six patchsets files from the BASE text by member-block moves and emits spec.json for check.py.
usage: BASE=<sha> W=<worktree> gen.py <outdir> <specout> [--report]
Everything that is not a verbatim BASE member block is an explicit scaffold line tagged with its D3 category."""
import json, os, re, subprocess, sys, collections
BASE = os.environ["BASE"]
W = os.environ["W"]
BASEPATH = "backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala"
base = subprocess.check_output(["git", "-C", W, "show", f"{BASE}:{BASEPATH}"], text=True).split("\n")
if base[-1] == "": base = base[:-1]
L = lambda n: base[n - 1]
outdir, specout = sys.argv[1], sys.argv[2]
report = "--report" in sys.argv
def iscomment(s): return re.match(r"^\s*(/\*\*|\*|//)", s) is not None

K, SUP, PAN, DS, PIP, STEP, OUT = ("PatchSetApplyResolvers", "PatchSetResolverSupport", "PatchSetPanelResolvers",
    "PatchSetDataSourceResolvers", "PatchSetPipelineResolvers", "PatchSetPipelineStepResolvers", "PatchSetOutputResolvers")
# (name, decl line, dest)
members = [
 ("resolveAll", 34, K), ("resolveEdit", 51, K),
 ("requireTargetId", 95, SUP), ("authorizeEditorOnDashboard", 101, SUP), ("authorizeEditorOrOwnerOnPipeline", 115, SUP),
 ("requireVisibleStep", 133, SUP), ("decodeCreatePatch", 144, SUP),
 ("pipelineSummaryResponse", 154, PIP),
 ("validateEmbeddedStepReferences", 179, STEP),
 ("resolvePanelUpdate", 230, PAN), ("resolvePanelDelete", 259, PAN), ("resolvePanelCreate", 284, PAN),
 ("rejectUnboundOrBadlyBoundForm", 318, PAN),
 ("resolveDashboardUpdate", 339, K), ("buildDashboardUpdateResolved", 362, K), ("resolveDashboardDelete", 376, K),
 ("resolveDashboardCreate", 398, K),
 ("resolveDataSourceUpdate", 416, DS), ("resolveDataSourceDelete", 441, DS), ("resolveDataSourceCreate", 462, DS),
 ("resolvePipelineUpdate", 481, PIP), ("resolvePipelineDelete", 513, PIP), ("prefixedWithEdit", 538, PIP),
 ("resolvePipelineCreate", 544, PIP),
 ("resolvePipelineStepUpdate", 593, STEP), ("resolvePipelineStepDelete", 634, STEP),
 ("buildPipelineStepDeletePriorState", 678, STEP), ("resolvePipelineStepCreate", 721, STEP),
 ("authorizeSecondSourceForCreate", 760, STEP),
 ("findOwnedOutput", 789, OUT), ("resolveOutputUpdate", 800, OUT), ("resolveOutputDelete", 829, OUT),
]
SHIFT = len(base) - 853  # HEL-1480 added one doc line at 178 (D7); 0 for BASE 6d298d5f8
members = [(n, (d + SHIFT if d > 178 else d), dst) for n, d, dst in members]
explicit = [("object-doc-and-header", 20, 32, K), ("standalone-HEL-904-comment", 169, 173, PAN),
            ("standalone-output-section-comment", 784, 784, OUT), ("object-close", 853, 853, K)]
explicit = [(n, (a + SHIFT if a > 178 else a), (b + SHIFT if b > 178 else b), d) for n, a, b, d in explicit]
starts = {}
for name, decl, dest in members:
    s = decl
    while s - 1 >= 1 and iscomment(L(s - 1)): s -= 1
    starts[name] = s
for name, a, b, dest in explicit: starts[name] = a
allstarts = sorted(set(starts.values()))
blocks = {}
for name, decl, dest in members:
    s = starts[name]; nxt = min([x for x in allstarts if x > s] + [854]); e = nxt - 1
    while L(e).strip() == "": e -= 1
    blocks[name] = dict(start=s, end=e, dest=dest, decl=decl)
for name, a, b, dest in explicit: blocks[name] = dict(start=a, end=b, dest=dest, decl=a)

def strip_code(text):
    out = []
    for ln in text.split("\n"):
        if re.match(r"^\s*(/\*\*|\*|//)", ln): continue
        ln = re.sub(r"\s//.*$", "", ln)
        ln = re.sub(r'"(?:[^"\\]|\\.)*"', lambda m: " ".join(re.findall(r"\$\{([^}]*)\}|\$(\w+)", m.group(0)) and [a or b for a, b in re.findall(r"\$\{([^}]*)\}|\$(\w+)", m.group(0))]) + " ", ln)
        out.append(ln)
    return "\n".join(out)
def body_lines(b): return base[b["start"] - 1:b["end"]]
member_names = {m[0] for m in members}
code = {n: strip_code("\n".join(body_lines(b))) for n, b in blocks.items()}
dest_code = collections.defaultdict(str)
for n, b in blocks.items(): dest_code[b["dest"]] += code[n] + "\n"
member_dest = {n: blocks[n]["dest"] for n in member_names}
def refs(text, name): return re.search(r"(?<![\w.])" + re.escape(name) + r"\b", text) is not None
# cross-destination references (a member referenced from another destination must be widened + imported)
cross = collections.defaultdict(lambda: collections.defaultdict(set))  # user dest -> owner dest -> names
for d, txt in dest_code.items():
    for n in member_names:
        if member_dest[n] != d and refs(txt, n): cross[d][member_dest[n]].add(n)
widen = set(n for d in cross for o in cross[d] for n in cross[d][o])
if report:
    print("WIDEN:", sorted(widen))
    for d in cross:
        for o, v in cross[d].items(): print("CROSS", d, "->", o, sorted(v))
    sys.exit(0)

imp_lines = [L(i) for i in range(3, 19)]
def parse_imp(s):
    m = re.match(r"^import (.+)\.\{(.+)\}$", s)
    if m: return m.group(1), [x.strip() for x in m.group(2).split(",")]
    m = re.match(r"^import (.+)\.(\w+)$", s)
    if m: return m.group(1), [m.group(2)]
    return None
def imports_for(text):
    outl = []
    for s in imp_lines:
        if s.strip() == "": continue
        if s.endswith("._"): outl.append(s); continue
        pre, names = parse_imp(s)
        keep = [n for n in names if re.search(r"(?<![\w])" + re.escape(n) + r"(?!\w)", text)]
        if not keep: continue
        outl.append(f"import {pre}.{{{', '.join(keep)}}}" if len(keep) > 1 else f"import {pre}.{keep[0]}")
    return outl
DOC = {
 SUP: "Access/decode helpers shared by the patch-set resolvers. Split out of `PatchSetApplyResolvers` (HEL-1479).",
 PAN: "Panel-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479).",
 DS: "Data-source-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479).",
 PIP: "Pipeline-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479).",
 STEP: "Pipeline-step-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479).",
 OUT: "Output-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479).",
}
FN = {d: d + ".scala" for d in [K, PAN, DS, PIP, STEP, OUT]}; FN[SUP] = FN[K]
spec = collections.OrderedDict(); outputs = {}

def widen_decl(name, lines, b, sub):
    if name in widen or (name.startswith("resolve") and member_dest[name] != K and name not in ("resolveAll",) and not name.startswith("resolveDashboard") and name != "resolveEdit"):
        i = b["decl"] - b["start"]; new = lines[i].replace("private ", "private[patchsets] ", 1)
        assert new != lines[i], name; lines[i] = new; sub[str(b["decl"])] = new

def build_object(d, items, outl, ownkeys):
    """append object d (a non-kept object) to items/outl"""
    def sc(t, cat): items.append(dict(scaffold=t, cat=cat)); outl.append(t)
    def blank():
        if outl and outl[-1] != "": outl.append("")
    own = sorted([n for n in blocks if blocks[n]["dest"] == d], key=lambda n: blocks[n]["start"])
    sc(f"/** {DOC[d]} */", "object-doc"); sc(f"private[patchsets] object {d} {{", "object-scaffold"); blank()
    imps = []
    for o in (SUP, PAN, DS, PIP, STEP, OUT):
        if o in cross[d]:
            names = sorted(cross[d][o], key=lambda n: blocks[n]["start"])
            imps.append(f"  import {o}.{{{', '.join(names)}}}" if len(names) > 1 else f"  import {o}.{names[0]}")
    for s in imps: sc(s, "member-import")
    if imps: blank()
    for n in own:
        b = blocks[n]; lines = body_lines(b); sub = {}
        if n in member_names: widen_decl(n, lines, b, sub)
        items.append(dict(member=n, range=[b["start"], b["end"]], subst=sub)); outl.extend(lines); blank()
    if outl[-1] == "": outl.pop()
    sc("}", "object-scaffold")

def build_kept():
    items = []; outl = []
    def sc(t, cat): items.append(dict(scaffold=t, cat=cat)); outl.append(t)
    def blank():
        if outl and outl[-1] != "": outl.append("")
    def member(n):
        b = blocks[n]; lines = body_lines(b); sub = {}
        if n in member_names: widen_decl(n, lines, b, sub)
        items.append(dict(member=n, range=[b["start"], b["end"]], subst=sub)); outl.extend(lines)
    keptnames = sorted([n for n in blocks if blocks[n]["dest"] == K], key=lambda n: blocks[n]["start"])
    # compute imports over the kept code + support code + scaffold imports text
    txt = dest_code[K] + "\n" + dest_code[SUP]
    imps = imports_for(txt)
    sc("package com.helio.services.patchsets", "package"); blank()
    first = True
    for s in imps:
        if (s.startswith("import scala.")) and first: blank(); first = False
        sc(s, "imports")
    blank()
    member("object-doc-and-header"); blank()
    mi = []
    for o in (SUP, PAN, DS, PIP, STEP, OUT):
        if o in cross[K]:
            names = sorted(cross[K][o], key=lambda n: blocks[n]["start"])
            mi.append(f"  import {o}.{{{', '.join(names)}}}" if len(names) > 1 else f"  import {o}.{names[0]}")
    # dispatch-called resolvers live in other destinations: they are in cross[K]
    for s in mi: sc(s, "member-import")
    if mi: blank()
    for n in keptnames:
        if n in ("object-doc-and-header", "object-close"): continue
        member(n); blank()
    member("object-close"); blank()
    build_object(SUP, items, outl, None)
    return items, outl

def emit(fn, items, outl): spec[fn] = items; outputs[fn] = "\n".join(outl) + "\n"
it, ol = build_kept(); emit(FN[K], it, ol)
for d in (PAN, DS, PIP, STEP, OUT):
    items = []; outl = []
    own = [n for n in blocks if blocks[n]["dest"] == d]
    imps = imports_for(dest_code[d])
    def sc(t, cat): items.append(dict(scaffold=t, cat=cat)); outl.append(t)
    sc("package com.helio.services.patchsets", "package"); outl.append("")
    first = True
    for s in imps:
        if s.startswith("import scala.") and first: outl.append(""); first = False
        sc(s, "imports")
    outl.append("")
    build_object(d, items, outl, None)
    emit(FN[d], items, outl)
os.makedirs(outdir, exist_ok=True)
for fn, txt in outputs.items(): open(os.path.join(outdir, fn), "w").write(txt)
json.dump(spec, open(specout, "w"), indent=1)
for fn, txt in outputs.items(): print(f"{fn}: {len(txt.splitlines())} lines")
json.dump({n: dict(start=b["start"], end=b["end"], dest=b["dest"], widen=(n in widen)) for n, b in blocks.items()}, open(specout + ".inventory.json", "w"), indent=1)
