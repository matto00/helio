#!/usr/bin/env python3
"""usage: suitecounts.py <sbt-log> -> JSON {suite: test-count} (ScalaTest '[info] <Suite>:' header then '- ' leaf lines; ANSI stripped)"""
import re,sys,json
ansi=re.compile(r'\x1b\[[0-9;]*m')
cur=None; d={}
for ln in open(sys.argv[1],errors='replace'):
    ln=ansi.sub('',ln.rstrip("\n"))
    m=re.match(r'\[info\] ([A-Z][A-Za-z0-9_]*):$',ln)
    if m: cur=m.group(1); d.setdefault(cur,0); continue
    if cur and re.match(r'\[info\] +- ',ln) and not ln.rstrip().endswith('*** FAILED ***'): d[cur]+=1
    elif cur and re.match(r'\[info\] +- ',ln): d[cur]+=1
print(json.dumps(d,sort_keys=True))
