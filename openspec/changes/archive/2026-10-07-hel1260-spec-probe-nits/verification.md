# Verification — HEL-1302

## 1.2 Red (expected path mutated to .../layout/repairX$), exit 1
```

Running 1 test using 1 worker

[HEL-1260 e2e] throwaway user: hel1260-1791396357862-40288@example.test
  ✘  1 e2e/hel1260-orphan-owner-repair.spec.ts:37:7 › owner open of an orphaned text panel sends one repair POST and stores every breakpoint (light) (3.7s)


  1) e2e/hel1260-orphan-owner-repair.spec.ts:37:7 › owner open of an orphaned text panel sends one repair POST and stores every breakpoint (light) 

    Error: expect(received).toMatch(expected)

    Expected pattern: /\/api\/dashboards\/1d480f00-2b41-477d-aaa8-d8f47a97c6df\/layout\/repairX$/
    Received string:  "http://localhost:6734/api/dashboards/1d480f00-2b41-477d-aaa8-d8f47a97c6df/layout/repair"

      87 |       await expect.poll(() => repairPosts.length, { timeout: 15_000 }).toBe(1);
      88 |       const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    > 89 |       expect(repairPosts[0].url).toMatch(
         |                                  ^
      90 |         new RegExp(`/api/dashboards/${escapeRe(dashboardId)}/layout/repairX$`),
      91 |       );
      92 |       const sent = JSON.parse(repairPosts[0].body) as Record<string, { panelId: string }[]>;
        at /home/matt/Development/helio/.claude/worktrees/task/hel1260-spec-probe-nits/HEL-1302/e2e/hel1260-orphan-owner-repair.spec.ts:89:34

    Error Context: pwout-red/hel1260-orphan-owner-repai-4f1c6-res-every-breakpoint-light-/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    pwout-red/hel1260-orphan-owner-repai-4f1c6-res-every-breakpoint-light-/trace.zip
    Usage:

        npx playwright show-trace pwout-red/hel1260-orphan-owner-repai-4f1c6-res-every-breakpoint-light-/trace.zip
```

## 1.3 Green: full spec, --workers 3 --trace on, exit 0
```

Running 4 tests using 1 worker

[HEL-1260 e2e] throwaway user: hel1260-1791396366408-83598@example.test
  ✓  1 e2e/hel1260-orphan-owner-repair.spec.ts:37:7 › owner open of an orphaned text panel sends one repair POST and stores every breakpoint (light) (5.9s)
[HEL-1260 e2e] throwaway user: hel1260-1791396371997-83820@example.test
  ✓  2 e2e/hel1260-orphan-owner-repair.spec.ts:37:7 › owner open of an orphaned text panel sends one repair POST and stores every breakpoint (dark) (4.0s)
[HEL-1260 e2e] throwaway user: hel1260-1791396376084-83620@example.test
  ✓  3 e2e/hel1260-orphan-owner-repair.spec.ts:121:7 › creating a text panel through the UI stores an item in every breakpoint and the position survives a reload (light) (4.9s)
[HEL-1260 e2e] throwaway user: hel1260-1791396381017-61019@example.test
  ✓  4 e2e/hel1260-orphan-owner-repair.spec.ts:121:7 › creating a text panel through the UI stores an item in every breakpoint and the position survives a reload (dark) (6.3s)

  4 passed (21.9s)
```

## 1.4 Trace title field (real trace.zip)
`context-options` events carry `title` in the per-context `N-trace.trace` files, e.g.
`'hel1260-orphan-owner-repair.spec.ts:37 › owner open of an orphaned text panel sends one repair POST and stores every breakpoint (light)'`.
`test.trace`'s `context-options` has `title: None` (hence C2: title-less events ignored). Matches design Decision 2.

## 1.5 Probe on the real output dir
```
ok  ...4f1c6-res-every-breakpoint-light- [orphan] repairs(+ms after dash goto, status)=[(779.7, 200)]
ok  ...89635-ion-survives-a-reload-dark- [ui] repairs=[]
ok  ...c37ed-ores-every-breakpoint-dark- [orphan] repairs=[(810.6, 200)]
ok  ...cde61-on-survives-a-reload-light- [ui] repairs=[]
4 traces, 0 bad
```

## 1.6 Synthetic traces
```
BAD a ['no title']
BAD b ["conflicting titles=[...(light)', '...(light) X']"]
BAD c ['unclassified title=something else text panel ...']
3 traces, 3 bad
```

## 1.7 `npm run check:openspec` -> "openspec/ is clean"; `check:e2e-types` and prettier pass (exit 0).
