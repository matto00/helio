import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1])
ev=[]
for name in z.namelist():
    if name.endswith('.network') or name.endswith('.trace'):
        for line in z.read(name).decode().splitlines():
            try: o=json.loads(line)
            except: continue
            if o.get('type')=='resource-snapshot':
                s=o['snapshot']; u=s['request']['url']
                if '/api/' in u:
                    ev.append((s.get('_monotonicTime',0)*1000 if s.get('_monotonicTime') else 0, s['startedDateTime'], s['request']['method'], u.split('/api/')[1][:70], s['response']['status'], s.get('_frameref') or s.get('pageref')))
            elif o.get('type')=='before' and o.get('method') in ('goto','click','waitForURL','fill') :
                ev.append((o.get('startTime',0),'', 'ACTION', o.get('method')+' '+json.dumps(o.get('params',{}))[:80], '', ''))
for e in sorted(ev,key=lambda x:x[0]): print(e)
