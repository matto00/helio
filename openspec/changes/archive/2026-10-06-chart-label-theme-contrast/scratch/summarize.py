import json,sys
phase=sys.argv[1]
d=json.load(open(f"measure-{phase}.json"))
def cat(r,t):
    if r["kind"]=="pie": return "pie legend" if t["cy"]<30 else "pie slice label"
    if t["cy"]<30: return "legend"
    if t["text"] in ("Region","Revenue"): return "axis name"
    return "axis tick label"
rows={}
for r in d:
    for t in r["texts"]:
        if "paintedRatio" not in t: continue
        k=(r["theme"],r["kind"],cat(r,t))
        rows.setdefault(k,[]).append(t)
out=[f"# HEL-1263 measure-{phase}","","Method: for every zrender text element of each chart (via echarts.getInstanceByDom on the running app, dev 6695), `style.fill` is read, and the element's rect is screenshotted (DPR 2). Background = most common pixel in that rect; painted colour = the pixel farthest from it (glyph antialiasing means this is a lower bound on the true contrast). Ratio = WCAG relative-luminance ratio. Threshold: WCAG 2.x SC 1.4.3 AA, 4.5:1 (normal text).","",
"| theme | kind | text | fill(s) (zrender) | painted colour(s) | background | min painted ratio | max painted ratio | >= 4.5 |","|---|---|---|---|---|---|---|---|---|"]
for (th,kd,c),ts in sorted(rows.items()):
    fills=sorted({str(t["fill"]) for t in ts}); paint=sorted({t["painted"] for t in ts}); bgs=sorted({t["bg"] for t in ts})
    mn=min(t["paintedRatio"] for t in ts); mx=max(t["paintedRatio"] for t in ts)
    out.append(f"| {th} | {kd} | {c} | {', '.join(fills)} | {', '.join(paint)} | {', '.join(bgs)} | {mn} | {mx} | {'PASS' if mn>=4.5 else 'FAIL'} |")
open(f"../measure-{phase}.md","w").write("\n".join(out)+"\n")
print("\n".join(out))
