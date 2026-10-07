# HEL-1289: per-trace isolation check. All times in ms (resource-snapshot _monotonicTime and action startTime are both ms).
#
# ARCHIVAL: evidence script for HEL-1289, kept with the archived change. It is NOT run by CI, hooks or any gate.
# Usage: python3 probe-check-isolation.py <playwright --output dir produced with --trace on>
# Classification (HEL-1302): each trace is classified from the test title Playwright records inside the trace
# (the `title` of its `context-options` events, "<spec file>:<line> › <test title>"), never from the output
# folder name. The title's file segment must be hel1260-orphan-owner-repair.spec.ts; the test title must start
# with "owner open of an orphaned text panel" (orphan-repair) or "creating a text panel through the UI" (UI-create).
# A trace whose title is missing, conflicting, from another file, or unrecognised is reported BAD, never defaulted.
import zipfile, json, sys, glob, re
bad = 0; n = 0
for tz in sorted(glob.glob(sys.argv[1] + '/*/trace.zip')):
    z = zipfile.ZipFile(tz); reqs = []; acts = []; titles = set()
    for name in z.namelist():
        if name.endswith('.network') or name.endswith('.trace'):
            for line in z.read(name).decode().splitlines():
                try: o = json.loads(line)
                except Exception: continue
                if o.get('type') == 'resource-snapshot':
                    s = o['snapshot']; u = s['request']['url']
                    if '/api/' in u:
                        reqs.append((s['_monotonicTime'], s['request']['method'], u.split('/api/')[1], s['response']['status'], bool(s.get('_frameref') or s.get('pageref'))))
                elif o.get('type') == 'context-options':
                    if o.get('title'): titles.add(o['title'])
                elif o.get('type') == 'before' and o.get('method') == 'goto':
                    acts.append((o['startTime'], o['params']['url']))
    # Playwright 1.55: test.trace's context-options carries no title; the per-context N-trace.trace files all carry
    # the same one. Title-less events are ignored when choosing the one distinct title.
    acts.sort(); reqs.sort()
    blank = [t for t, u in acts if u == 'about:blank']
    dash = [t for t, u in acts if u.startswith('/dashboards/')]
    name = tz.split('/')[-2]; probs = []; kind = None
    if not titles: probs.append('no title')
    elif len(titles) > 1: probs.append(f'conflicting titles={sorted(titles)}')
    else:
        parts = next(iter(titles)).split(' \u203a ')
        if re.sub(r':\d+$', '', parts[0]) != 'hel1260-orphan-owner-repair.spec.ts': probs.append(f'wrong file={parts[0]}')
        elif parts[-1].startswith('owner open of an orphaned text panel'): kind = 'orphan'
        elif parts[-1].startswith('creating a text panel through the UI'): kind = 'ui'
        else: probs.append(f'unclassified title={parts[-1]}')
    if kind is None: pass
    elif len(blank) != 1 or len(dash) != 1: probs.append(f'goto counts blank={len(blank)} dash={len(dash)}')
    else:
        b, d = blank[0], dash[0]
        between = [r for r in reqs if r[4] and b <= r[0] <= d]
        if between: probs.append(f'page-frame /api/ between blank and dash goto: {between}')
        repairs = [r for r in reqs if r[1] == 'POST' and r[2].endswith('/layout/repair') and r[4]]
        panels_after = [r for r in reqs if r[4] and r[1] == 'GET' and re.search(r'dashboards/[^/]+/panels$', r[2]) and r[0] > d]
        isorphan = kind == 'orphan'
        if isorphan:
            if len(repairs) != 1: probs.append(f'repair count {len(repairs)}')
            elif not panels_after or repairs[0][0] < panels_after[0][0]: probs.append('repair not after page own GET panels following goto')
        elif repairs: probs.append(f'ui test repairs {len(repairs)}')
        if True:
            rinfo = [(round(r[0] - d, 1), r[3]) for r in repairs]
    n += 1
    if probs: bad += 1
    print(('BAD ' if probs else 'ok  ') + name, probs if probs else (f'[{kind}] repairs(+ms after dash goto, status)={rinfo}'))
print(f'{n} traces, {bad} bad')
