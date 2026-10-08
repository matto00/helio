#!/usr/bin/env python3
"""usage: classify.py javap-base.txt javap-after.txt   -- classifies every per-class added/removed javap -public line (D5b(b))."""
import sys, re
def parse(p):
    d={}; cur=None
    for ln in open(p).read().split("\n"):
        if ln.startswith("== "): cur=ln[3:]; d[cur]=[]
        elif cur and ln.strip(): d[cur].append(ln)
    return d
B,A=parse(sys.argv[1]),parse(sys.argv[2])
P="com.helio.services.pipelines."; R="com.helio.infrastructure.persistence.pipelines."
OCV=P+"OutputConfigValidation"; OS=P+"OutputService"; NR=R+"NodeSnapshotRepository"
fails=[]; rows=[]
def synthetic(l): return ("$anonfun$" in l) or ("$deserializeLambda$" in l)
APPROVED_REMOVED = ["com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$escapeLikeTerm(java.lang.String)", "com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$likeEscapeChar()"]
OCV_ADD_METHODS = ["mergeConfig(spray.json.JsObject, spray.json.JsObject)","validateConfig$default$4()",
                   "validateConfig(com.helio.domain.model.OutputKind, spray.json.JsObject, spray.json.JsObject, com.helio.services.pipelines.OutputConfigWritePolicy)",
                   "validateFieldMapping(com.helio.domain.model.OutputKind, spray.json.JsObject)"]
def is_pf_anon_class(c): return re.search(r"\$\$anonfun\$\d+$",c) is not None
for c in sorted(set(B)|set(A)):
    b,a=B.get(c),A.get(c)
    if b is None:   # class added
        if c.startswith(OCV) and is_pf_anon_class(c):
            rows.append((c,"CLASS ADDED","compiler PartialFunction class carrying a moved `collect { case .. }` body: OK (name-only change from OutputService$$anonfun$N)"))
        else: fails.append(("unexpected class added",c)); rows.append((c,"CLASS ADDED","FAIL"))
        continue
    if a is None:
        if is_pf_anon_class(c) and (c.startswith(OS) or c.startswith(NR)):
            rows.append((c,"CLASS REMOVED","compiler PartialFunction class whose body moved: OK"))
        else: fails.append(("unexpected class removed",c)); rows.append((c,"CLASS REMOVED","FAIL"))
        continue
    sb,sa=set(b),set(a)
    for l in sorted(sa-sb):
        ok=None
        if synthetic(l): ok="compiler synthetic (added)"
        elif c in (OCV,OCV+"$") and any(m in l for m in OCV_ADD_METHODS): ok="pre-approved OutputConfigValidation addition (moved method / default / static forwarder)"
        rows.append((c,"+ "+l.strip(),ok or "FAIL"))
        if not ok: fails.append(("unclassified added",c,l))
        if "$$" in l and "$$anonfun$" not in l: fails.append(("ADDED $$ NAME",c,l))
    for l in sorted(sb-sa):
        ok=None
        if synthetic(l): ok="compiler synthetic (removed)"
        elif c==NR and any(x in l for x in APPROVED_REMOVED): ok="PRE-APPROVED $$ removal (privates made public only for the collect closure; moved to NodeSnapshotFilterSql)"
        rows.append((c,"- "+l.strip(),ok or "FAIL"))
        if not ok: fails.append(("unclassified removed",c,l))
# explicit invariants
def has(c,frag): return any(frag in l for l in A.get(c,[]))
inv=[("OutputService carries validateConfig$default$4()",has(OS,"validateConfig$default$4()")),
     ("OutputService$ carries validateConfig$default$4()",has(OS+"$","validateConfig$default$4()")),
     ("OutputService has no member containing 'rowReads' or 'rootResolution'",not any(("rowReads" in l or "rootResolution" in l) for l in A[OS]+A[OS+"$"])),
     ("no `$$` MEMBER (method/field) name added on any checked class",not any(f[0]=="ADDED $$ NAME" for f in fails))]
for n,v in inv:
    rows.append(("INVARIANT",n,"OK" if v else "FAIL"))
    if not v: fails.append(("invariant",n))
for r in rows: print(" | ".join(r))
print("\nRESULT:","PASS" if not fails else "FAIL "+str(fails)); sys.exit(1 if fails else 0)
