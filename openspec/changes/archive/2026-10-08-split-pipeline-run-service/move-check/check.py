#!/usr/bin/env python3
"""Move checker (HEL-1371 design D6a). usage: check.py <base-sha> <spec.json> <dir-with-the-7-files>
Forward: every inventoried member's base text equals its text in the new file (only declared
`private` -> `private[pipelines]` substitutions allowed).
Reverse: walking each new file top to bottom, every non-blank line must be consumed POSITIONALLY by the
next expected item (member block or explicit scaffold line); any extra / missing / altered line fails.
Coverage: every non-blank base class-body line must be claimed by exactly one member block."""
import json,subprocess,sys,collections
sha,specp,d=sys.argv[1:4]
BASEPATH="backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala"
import os
W=os.environ.get("W","/home/matt/Development/helio/.claude/worktrees/task/split-pipeline-run-service/hel-1371")
base=subprocess.check_output(["git","-C",W,"show",f"{sha}:{BASEPATH}"],text=True).split("\n")
spec=json.load(open(specp)); fails=[]; stats={}
claims=collections.Counter()
for fn,items in spec.items():
    lines=open(os.path.join(d,fn)).read().split("\n")
    if lines and lines[-1]=="": lines=lines[:-1]
    pos=0; st=collections.Counter()
    for it in items:
        while pos<len(lines) and lines[pos]=="": pos+=1
        if "member" in it:
            a,b=it["range"]
            for k,orig in enumerate(range(a,b+1)):
                exp=base[orig-1]
                if str(orig) in it["subst"]:
                    new=it["subst"][str(orig)]
                    if new!=exp.replace("private ","private[pipelines] ",1) or new==exp:
                        fails.append(f"{fn}: illegal substitution at base line {orig}")
                    exp=new; st["visibility-subst"]+=1
                else: st["moved/kept verbatim"]+=1
                if pos>=len(lines) or lines[pos]!=exp:
                    got=lines[pos] if pos<len(lines) else "<EOF>"
                    fails.append(f"{fn}:{pos+1}: member {it['member']} base line {orig} mismatch\n    expected: {exp!r}\n    actual:   {got!r}")
                    return_ = True
                pos+=1
                if str(orig) not in it["subst"] or True: claims[orig]+=1
        else:
            if pos>=len(lines) or lines[pos]!=it["scaffold"]:
                got=lines[pos] if pos<len(lines) else "<EOF>"
                fails.append(f"{fn}:{pos+1}: scaffold [{it['cat']}] expected {it['scaffold']!r} got {got!r}")
            pos+=1; st["scaffold:"+it["cat"]]+=1
    while pos<len(lines) and lines[pos]=="": pos+=1
    if pos<len(lines): fails.append(f"{fn}:{pos+1}: UNACCOUNTED line(s) from here on: {lines[pos]!r} (+{len(lines)-pos-1} more)")
    stats[fn]=(len(lines),st)
# coverage of the base class body
body=[i for i in list(range(35,1695))+list(range(1697,1771)) if base[i-1].strip()!=""]
unclaimed=[i for i in body if claims[i]==0]; multi=[i for i in body if claims[i]>1]
if unclaimed: fails.append(f"base lines not claimed by any member: {unclaimed[:20]} (n={len(unclaimed)})")
if multi: fails.append(f"base lines claimed more than once: {multi[:20]} (n={len(multi)})")
# bodies that were delegated away: the entry point must hold none of their non-blank lines beyond scaffold (covered by reverse walk)
for fn,(n,st) in stats.items():
    print(f"{fn}: {n} lines :: "+", ".join(f"{k}={v}" for k,v in sorted(st.items())))
print(f"base non-blank body lines: {len(body)}; unclaimed {len(unclaimed)}; multiply-claimed {len(multi)}")
if fails:
    print("FAIL"); [print(" -",f) for f in fails[:25]]; sys.exit(1)
print("PASS")
