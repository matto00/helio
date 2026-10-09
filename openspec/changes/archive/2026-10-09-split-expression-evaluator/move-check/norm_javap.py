#!/usr/bin/env python3
"""D6b fixed-order normalisation. usage: norm.py <base_dir> <after_dir> -> prints each step's touched lines + final diff."""
import re,sys,os,difflib
bd,ad=sys.argv[1],sys.argv[2]
MOVED={"tokenize","parse","parseLegacy","inferTypeOf","evalExpr","applyFn","applyOp","valToJs","checkArity","DollarPrefixRequiredMsg"}
files=sorted(f for f in os.listdir(bd) if f.endswith(".txt") and not f.startswith("_"))
out=0
suffix=re.compile(r"(\$anonfun\$[A-Za-z0-9_$]*?)\$(\d+)(\$adapted)?\b")
def step_i(l):
    if "$anonfun$" not in l: return l
    return re.sub(r"(\$anonfun\$[A-Za-z]+)\$\d+", r"\1$N", l)
def name_of(l):
    m=re.search(r"\$anonfun\$([A-Za-z]+)\$",l)
    if m: return m.group(1)
    m=re.search(r"\$\$([A-Za-z]+)\(",l)
    return m.group(1) if m else None
for f in files:
    B=open(os.path.join(bd,f)).read().split("\n"); A=open(os.path.join(ad,f)).read().split("\n")
    raw=[l for l in difflib.unified_diff(B,A,lineterm="",n=0) if not l.startswith(("---","+++","@@"))]
    print(f"### {f}: raw diff = {len(raw)} lines")
    for l in raw: print("   RAW",l)
    # (i)
    B1=[step_i(l) for l in B]; A1=[step_i(l) for l in A]
    for x,y in zip(B,B1):
        if x!=y: print("   (i) BEFORE",x.strip(),"=>",y.strip())
    # (ii) remove from BEFORE lambda/$$ lines of moved members
    B2=[]
    for l in B1:
        if ("$anonfun$" in l or "$$" in l):
            n=name_of(l)
            if n in MOVED: print("   (ii) removed BEFORE (moved member '%s'):"%n,l.strip()); continue
            if "$$" in l: print("   (ii) !!! $$ line of NON-moved member kept:",l.strip())
        B2.append(l)
    # (iii)
    B3=[];touched=0
    for l in B2:
        if "$anonfun$" in l:
            n=l.replace("ExpressionEvaluator$Expr","ExpressionParser$Expr").replace("ExpressionEvaluator$Val","ExpressionInterpreter$Val")
            if n!=l: touched+=1; print("   (iii) member=%s rewrite: %s"%(name_of(l),l.strip()))
            l=n
        B3.append(l)
    print("   (iii) lines touched in this file:",touched)
    # (iv)
    B4=[]
    for l in B3:
        if f=="ExpressionEvaluator$CompiledExpression.txt" and "ExpressionEvaluator$Expr" in l and "$anonfun$" not in l:
            n=l.replace("ExpressionEvaluator$Expr","ExpressionParser$Expr"); print("   (iv) ctor:",l.strip(),"=>",n.strip()); l=n
        B4.append(l)
    d=[l for l in difflib.unified_diff(B4,A1,lineterm="",n=0) if not l.startswith(("---","+++","@@"))]
    # AFTER keeps its original numbering? compare with step-(i) normalised AFTER (both sides placeholder)
    print("   (v) normalised diff lines:",len(d)); [print("      ",x) for x in d]; out+=len(d)
print("TOTAL normalised diff lines:",out)
sys.exit(1 if out else 0)
