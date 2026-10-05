# HEL-1289: per-trace isolation check. All times in ms (resource-snapshot _monotonicTime and action startTime are both ms).
import zipfile, json, sys, glob, re
bad = 0; n = 0
for tz in sorted(glob.glob(sys.argv[1] + '/*/trace.zip')):
    z = zipfile.ZipFile(tz); reqs = []; acts = []
    for name in z.namelist():
        if name.endswith('.network') or name.endswith('.trace'):
            for line in z.read(name).decode().splitlines():
                try: o = json.loads(line)
                except Exception: continue
                if o.get('type') == 'resource-snapshot':
                    s = o['snapshot']; u = s['request']['url']
                    if '/api/' in u:
                        reqs.append((s['_monotonicTime'], s['request']['method'], u.split('/api/')[1], s['response']['status'], bool(s.get('_frameref') or s.get('pageref'))))
                elif o.get('type') == 'before' and o.get('method') == 'goto':
                    acts.append((o['startTime'], o['params']['url']))
    acts.sort(); reqs.sort()
    blank = [t for t, u in acts if u == 'about:blank']
    dash = [t for t, u in acts if u.startswith('/dashboards/')]
    name = tz.split('/')[-2]; probs = []
    if len(blank) != 1 or len(dash) != 1: probs.append(f'goto counts blank={len(blank)} dash={len(dash)}')
    else:
        b, d = blank[0], dash[0]
        between = [r for r in reqs if r[4] and b <= r[0] <= d]
        if between: probs.append(f'page-frame /api/ between blank and dash goto: {between}')
        repairs = [r for r in reqs if r[1] == 'POST' and r[2].endswith('/layout/repair') and r[4]]
        panels_after = [r for r in reqs if r[4] and r[1] == 'GET' and re.search(r'dashboards/[^/]+/panels$', r[2]) and r[0] > d]
        isorphan = 'survives' not in name
        if isorphan:
            if len(repairs) != 1: probs.append(f'repair count {len(repairs)}')
            elif not panels_after or repairs[0][0] < panels_after[0][0]: probs.append('repair not after page own GET panels following goto')
        elif repairs: probs.append(f'ui test repairs {len(repairs)}')
        if not isorphan or True:
            rinfo = [(round(r[0] - d, 1), r[3]) for r in repairs]
    n += 1
    if probs: bad += 1
    print(('BAD ' if probs else 'ok  ') + name, probs if probs else (f'repairs(+ms after dash goto, status)={rinfo}'))
print(f'{n} traces, {bad} bad')
