import re,os,sys
LIVE='openspec/specs'; DELTA='openspec/changes/multi-lane-pipeline-engine/specs'
bad=[]
for cap in sorted(os.listdir(DELTA)):
    t=open(f'{DELTA}/{cap}/spec.md').read(); lp=f'{LIVE}/{cap}/spec.md'
    live=set(re.findall(r'(?m)^### Requirement: (.+)$', open(lp).read())) if os.path.exists(lp) else set()
    cur=None
    for line in t.splitlines():
        m=re.match(r'^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements', line)
        if m: cur=m.group(1); continue
        m=re.match(r'^### Requirement: (.+)$', line)
        if m and cur in ('MODIFIED','REMOVED') and m.group(1) not in live:
            bad.append((cap,cur,m.group(1)))
print("MODIFIED/REMOVED not matching a live requirement:", len(bad))
for b in bad: print("  MISSING:",b)
sys.exit(1 if bad else 0)
