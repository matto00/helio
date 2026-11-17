- `.github/dependabot.yml` — D6 Pin + upstream draft: ignore react-grid-layout >=2.3.0 in the /frontend npm block (HEL-1728 reason comment)
- `openspec/changes/rgl-23-drag-tracking/upstream-issue-draft.md` — draft only, not filed
- `openspec/changes/rgl-23-drag-tracking/{red-baseline,bisect-log,running-app-check,minimal-repro}.md` — measurements
- `openspec/changes/rgl-23-drag-tracking/{hel1728-sweep.spec.ts,run-sweep.sh,min/*}` — sweep/minimal-page scripts (copied into e2e/ or frontend/ only while running, then removed)
- `openspec/changes/rgl-23-drag-tracking/drag-held-{light,dark}.png` — 2.3.0 screenshots

Notes: frontend/package.json and package-lock.json are unchanged (2.2.4 stays). Dev-DB residue: every e2e run registers throwaway users and the harness teardown deleted them by recorded id (20+20 in the red baseline runs, 20 final, 1+1 hel1230/hel908, plus sweep/min runs, all reported "deleted N recorded throwaway user(s)"); no other rows created.
