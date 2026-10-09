import sys,re,subprocess
sys.argv=["x","/home/matt/Development/helio/.claude/worktrees/task/pipelinerunservice-preview-split-tidy/HEL-1393","ecaa1a53"]
src=open(sys.argv[0] if False else "check.py").read()
# exec only the definitions part up to 'fails=[]'
exec(src.split("fails=[]")[0].replace('P=opt(','P=opt(').replace('E=opt(','E=opt('))
open(P,"w").write("\n".join(HEAD+moved+TAIL)+"\n")
ent=[]
bi=list(base)
if bi and bi[-1]=="": bi=bi[:-1]
for n,l in enumerate(bi,1):
    if n==A: ent+=DELEG
    if A<=n<=B: continue
    if l in EDITS:
        if EDITS[l] is None: continue
        l=EDITS[l]
    ent.append(l)
    if l=="  import executor.runPipeline": ent+=PREVIEW_VAL
open(E,"w").write("\n".join(ent)+"\n")
